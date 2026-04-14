import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { nanoid } from "nanoid";
import { db } from "@uni-proxy-manager/database";
import { errorPages, domains } from "@uni-proxy-manager/database/schema";
import { eq } from "drizzle-orm";
import { getErrorPagesDir } from "@uni-proxy-manager/shared/config";
import {
  mkdir,
  rm,
  writeFile,
  stat,
  readdir,
  access,
  readFile,
} from "fs/promises";
import { join, normalize, resolve } from "path";
import { generatePreview } from "../services/preview-generator";
import { compileMaintenancePage } from "../services/maintenance-page-compiler";
import AdmZip from "adm-zip";

/**
 * Maximum allowed file size for ZIP uploads (50MB)
 */
const MAX_ZIP_SIZE = 50 * 1024 * 1024;

/**
 * Maximum number of files allowed in a ZIP archive
 */
const MAX_ZIP_ENTRIES = 100;

/**
 * Safely extract a ZIP file, preventing path traversal attacks (Zip Slip)
 * @throws Error if any entry attempts path traversal or exceeds limits
 */
async function safeExtractZip(
  zipBuffer: Buffer,
  targetDir: string,
): Promise<{ extractedCount: number; totalSize: number }> {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  // Validate ZIP size
  if (zipBuffer.length > MAX_ZIP_SIZE) {
    throw new Error(
      `ZIP file exceeds maximum size of ${MAX_ZIP_SIZE / 1024 / 1024}MB`,
    );
  }

  // Validate entry count
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error(
      `ZIP contains too many files (${entries.length}). Maximum allowed: ${MAX_ZIP_ENTRIES}`,
    );
  }

  const resolvedTargetDir = resolve(targetDir);

  // Validate all entries before extraction
  let totalSize = 0;
  for (const entry of entries) {
    // Skip directories
    if (entry.isDirectory) {
      continue;
    }

    const entryName = entry.entryName;

    if (entryName.includes("\0")) {
      throw new Error(`Invalid entry name containing null byte: ${entryName}`);
    }

    const normalizedPath = normalize(entryName);
    if (
      normalizedPath.startsWith("..") ||
      normalizedPath.includes("/../") ||
      normalizedPath.startsWith("/")
    ) {
      throw new Error(`Path traversal detected in ZIP entry: ${entryName}`);
    }

    // Compute the full resolved path
    const fullPath = resolve(resolvedTargetDir, normalizedPath);

    // Verify the resolved path is within the target directory
    if (
      !fullPath.startsWith(resolvedTargetDir + "/") &&
      fullPath !== resolvedTargetDir
    ) {
      throw new Error(`Path traversal detected in ZIP entry: ${entryName}`);
    }

    // Accumulate size for limit checking
    totalSize += entry.header.size;
  }

  // Check total uncompressed size (100MB limit)
  const MAX_UNCOMPRESSED_SIZE = 100 * 1024 * 1024;
  if (totalSize > MAX_UNCOMPRESSED_SIZE) {
    throw new Error(
      `Total uncompressed size exceeds ${MAX_UNCOMPRESSED_SIZE / 1024 / 1024}MB limit`,
    );
  }

  // All validations passed, now extract safely
  let extractedCount = 0;
  for (const entry of entries) {
    if (entry.isDirectory) {
      continue;
    }

    const normalizedPath = normalize(entry.entryName);
    const fullPath = resolve(resolvedTargetDir, normalizedPath);

    // Create parent directory if needed
    const parentDir = join(fullPath, "..");
    await mkdir(parentDir, { recursive: true });

    // Write file
    const content = entry.getData();
    await writeFile(fullPath, content);
    extractedCount++;
  }

  return { extractedCount, totalSize };
}

const app = new Hono();

/**
 * Check if preview exists, and generate if missing
 */
async function ensurePreview(
  errorPageId: string,
  directoryPath: string,
  entryFile: string,
): Promise<string | null> {
  const errorPagesDir = getErrorPagesDir();
  const previewPath = join(errorPagesDir, errorPageId, "preview.png");

  try {
    // Check if preview already exists
    await access(previewPath);
    return `${errorPageId}/preview.png`;
  } catch {
    // Preview doesn't exist, try to generate it
    try {
      const entryFilePath = join(directoryPath, entryFile);
      // Check if entry file exists
      await access(entryFilePath);

      console.log(
        `[Error Pages] Generating missing preview for ${errorPageId}`,
      );
      const generatedPath = await generatePreview(errorPageId, entryFilePath);

      // Update database with new preview path
      await db
        .update(errorPages)
        .set({ previewImagePath: generatedPath, updatedAt: new Date() })
        .where(eq(errorPages.id, errorPageId));

      return generatedPath;
    } catch (genError) {
      console.error(
        `[Error Pages] Failed to generate preview for ${errorPageId}:`,
        genError,
      );
      return null;
    }
  }
}

// Validation schemas
const createErrorPageSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["503", "404", "500", "502", "504", "maintenance", "custom"]),
  httpStatusCode: z.number().int().min(400).max(599).optional(),
  description: z.string().optional(),
  entryFile: z.string().default("index.html"),
});

const updateErrorPageSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  entryFile: z.string().optional(),
});

// List all error pages
app.get("/", async (c) => {
  try {
    const pages = await db.query.errorPages.findMany({
      orderBy: (errorPages, { desc }) => [desc(errorPages.createdAt)],
    });

    // Auto-generate missing previews for pages with uploaded files
    const pagesWithPreviews = await Promise.all(
      pages.map(async (page) => {
        if (!page.previewImagePath && page.uploadedAt) {
          const generatedPreviewPath = await ensurePreview(
            page.id,
            page.directoryPath,
            page.entryFile,
          );
          if (generatedPreviewPath) {
            return { ...page, previewImagePath: generatedPreviewPath };
          }
        }
        return page;
      }),
    );

    return c.json({ errorPages: pagesWithPreviews });
  } catch (error) {
    console.error("[Error Pages] Error listing pages:", error);
    return c.json({ error: "Failed to list error pages" }, 500);
  }
});

// Serve preview image
app.get("/:id/preview.png", async (c) => {
  const { id } = c.req.param();

  const errorPagesDir = getErrorPagesDir();
  const previewPath = join(errorPagesDir, id, "preview.png");

  try {
    const file = await readFile(previewPath);
    return new Response(file, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    const transparentPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    );
    return new Response(transparentPng, {
      status: 404,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-cache",
      },
    });
  }
});

// Download error page files as ZIP
app.get("/:id/download", async (c) => {
  const { id } = c.req.param();

  try {
    const errorPage = await db.query.errorPages.findFirst({
      where: eq(errorPages.id, id),
    });

    if (!errorPage) {
      return c.json({ error: "Error page not found" }, 404);
    }

    if (!errorPage.uploadedAt) {
      return c.json({ error: "No files uploaded for this error page" }, 400);
    }

    const errorPagesDir = getErrorPagesDir();
    const errorPagePath = join(errorPagesDir, id);

    // Create ZIP archive of all files
    const zip = new AdmZip();
    zip.addLocalFolder(errorPagePath);
    const zipBuffer = zip.toBuffer();

    return new Response(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${errorPage.name}.zip"`,
      },
    });
  } catch (error) {
    console.error("[Error Pages] Error creating download:", error);
    return c.json({ error: "Failed to create download" }, 500);
  }
});

// Get single error page
app.get("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const page = await db.query.errorPages.findFirst({
      where: eq(errorPages.id, id),
    });

    if (!page) {
      return c.json({ error: "Error page not found" }, 404);
    }

    // Auto-generate preview if missing and files are uploaded
    if (!page.previewImagePath && page.uploadedAt) {
      const generatedPreviewPath = await ensurePreview(
        id,
        page.directoryPath,
        page.entryFile,
      );
      if (generatedPreviewPath) {
        // Return updated page data with new preview
        page.previewImagePath = generatedPreviewPath;
      }
    }

    return c.json({ errorPage: page });
  } catch (error) {
    console.error("[Error Pages] Error getting page:", error);
    return c.json({ error: "Failed to get error page" }, 500);
  }
});

// Create error page (metadata only, files uploaded separately)
app.post("/", zValidator("json", createErrorPageSchema), async (c) => {
  const data = c.req.valid("json");

  try {
    const id = nanoid();
    const errorPagesDir = getErrorPagesDir();
    const directoryPath = join(errorPagesDir, id);

    // Create directory for this error page
    await mkdir(directoryPath, { recursive: true });

    const [newPage] = await db
      .insert(errorPages)
      .values({
        id,
        name: data.name,
        type: data.type,
        httpStatusCode: data.httpStatusCode,
        description: data.description,
        directoryPath,
        entryFile: data.entryFile,
      })
      .returning();

    return c.json({ errorPage: newPage }, 201);
  } catch (error) {
    console.error("[Error Pages] Error creating page:", error);
    return c.json({ error: "Failed to create error page" }, 500);
  }
});

app.post("/:id/upload", async (c) => {
  const { id } = c.req.param();

  try {
    const page = await db.query.errorPages.findFirst({
      where: eq(errorPages.id, id),
    });

    if (!page) {
      return c.json({ error: "Error page not found" }, 404);
    }

    const body = await c.req.parseBody();
    const file = body.file;

    if (!file || !(file instanceof File)) {
      return c.json({ error: "No file uploaded" }, 400);
    }

    if (!file.name.endsWith(".zip")) {
      return c.json({ error: "Only ZIP files are supported" }, 400);
    }

    // Safely extract the zip file with path traversal protection
    const zipBuffer = Buffer.from(await file.arrayBuffer());

    // Verify ZIP magic bytes (PK\x03\x04) to confirm the file is actually a ZIP archive
    if (
      zipBuffer.length < 4 ||
      zipBuffer[0] !== 0x50 ||
      zipBuffer[1] !== 0x4b ||
      zipBuffer[2] !== 0x03 ||
      zipBuffer[3] !== 0x04
    ) {
      return c.json(
        {
          error:
            "File does not appear to be a valid ZIP archive (invalid magic bytes)",
        },
        400,
      );
    }

    let extractedCount: number;
    let totalSize: number;

    try {
      const result = await safeExtractZip(zipBuffer, page.directoryPath);
      extractedCount = result.extractedCount;
      totalSize = result.totalSize;
    } catch (extractError) {
      console.error("[Error Pages] ZIP extraction failed:", extractError);
      const message =
        extractError instanceof Error
          ? extractError.message
          : "Invalid ZIP file";
      return c.json({ error: message }, 400);
    }

    // Count extracted files for response
    const extractedFiles = await readdir(page.directoryPath, {
      recursive: true,
    });
    const fileCount = extractedCount;

    // Auto-detect entry file
    let actualEntryFile = page.entryFile;
    const rootFiles = extractedFiles.filter((f) => !f.includes("/"));

    // Check if the default entry file exists
    const entryFilePath = join(page.directoryPath, page.entryFile);
    try {
      await stat(entryFilePath);
    } catch {
      // Entry file doesn't exist, try to find an alternative
      // For custom error pages, try status code filename first
      if (page.httpStatusCode) {
        const statusFile = `${page.httpStatusCode}.html`;
        if (rootFiles.includes(statusFile)) {
          actualEntryFile = statusFile;
        } else if (rootFiles.includes(`${page.httpStatusCode}.http`)) {
          actualEntryFile = `${page.httpStatusCode}.http`;
        }
      }

      // If still not found, use first HTML file
      if (
        actualEntryFile === page.entryFile &&
        !rootFiles.includes(actualEntryFile)
      ) {
        const firstHtml = rootFiles.find(
          (f) => f.endsWith(".html") || f.endsWith(".http"),
        );
        if (firstHtml) {
          actualEntryFile = firstHtml;
        }
      }
    }

    if (page.type === "maintenance") {
      try {
        await compileMaintenancePage(page.directoryPath, actualEntryFile);
      } catch (compileError) {
        console.error(
          "[Error Pages] Failed to compile maintenance page:",
          compileError,
        );
        return c.json(
          { error: "Failed to compile maintenance page for HAProxy serving" },
          500,
        );
      }
    }

    // Generate preview image
    let previewImagePath: string | undefined;
    try {
      const finalEntryFilePath = join(page.directoryPath, actualEntryFile);
      previewImagePath = await generatePreview(id, finalEntryFilePath);
    } catch (previewError) {
      console.error("[Error Pages] Failed to generate preview:", previewError);
      // Continue without preview - not a critical error
    }

    // Update metadata
    const [updatedPage] = await db
      .update(errorPages)
      .set({
        originalZipName: file.name,
        uploadedAt: new Date(),
        fileSize: totalSize,
        fileCount,
        previewImagePath,
        entryFile: actualEntryFile,
        updatedAt: new Date(),
      })
      .where(eq(errorPages.id, id))
      .returning();

    return c.json({
      success: true,
      message: "File uploaded and extracted successfully",
      errorPage: updatedPage,
    });
  } catch (error) {
    console.error("[Error Pages] Error uploading file:", error);
    return c.json({ error: "Failed to upload file" }, 500);
  }
});

// Update error page
app.put("/:id", zValidator("json", updateErrorPageSchema), async (c) => {
  const { id } = c.req.param();
  const data = c.req.valid("json");

  try {
    const existing = await db.query.errorPages.findFirst({
      where: eq(errorPages.id, id),
    });

    if (!existing) {
      return c.json({ error: "Error page not found" }, 404);
    }

    const nextEntryFile = data.entryFile ?? existing.entryFile;

    if (existing.type === "maintenance" && existing.uploadedAt) {
      try {
        await compileMaintenancePage(existing.directoryPath, nextEntryFile);
      } catch (compileError) {
        console.error(
          "[Error Pages] Failed to recompile maintenance page:",
          compileError,
        );
        return c.json(
          { error: "Failed to compile maintenance page for HAProxy serving" },
          500,
        );
      }
    }

    const [updated] = await db
      .update(errorPages)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(errorPages.id, id))
      .returning();

    return c.json({ errorPage: updated });
  } catch (error) {
    console.error("[Error Pages] Error updating page:", error);
    return c.json({ error: "Failed to update error page" }, 500);
  }
});

// Delete error page
app.delete("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const existing = await db.query.errorPages.findFirst({
      where: eq(errorPages.id, id),
    });

    if (!existing) {
      return c.json({ error: "Error page not found" }, 404);
    }

    // Remove directory and files
    try {
      await rm(existing.directoryPath, { recursive: true, force: true });
    } catch (fsError) {
      console.warn("[Error Pages] Failed to remove directory:", fsError);
    }

    await db.delete(errorPages).where(eq(errorPages.id, id));

    return c.json({ success: true });
  } catch (error) {
    console.error("[Error Pages] Error deleting page:", error);
    return c.json({ error: "Failed to delete error page" }, 500);
  }
});

app.post("/:id/regenerate-preview", async (c) => {
  const { id } = c.req.param();

  try {
    const page = await db.query.errorPages.findFirst({
      where: eq(errorPages.id, id),
    });

    if (!page) {
      return c.json({ error: "Error page not found" }, 404);
    }

    if (!page.uploadedAt) {
      return c.json({ error: "No files uploaded for this error page" }, 400);
    }

    const entryFilePath = join(page.directoryPath, page.entryFile);

    // Generate preview
    try {
      const previewPath = await generatePreview(id, entryFilePath);

      // Update database
      const [updated] = await db
        .update(errorPages)
        .set({
          previewImagePath: previewPath,
          updatedAt: new Date(),
        })
        .where(eq(errorPages.id, id))
        .returning();

      return c.json({
        success: true,
        message: "Preview regenerated successfully",
        errorPage: updated,
      });
    } catch (previewError) {
      console.error(
        "[Error Pages] Failed to regenerate preview:",
        previewError,
      );
      return c.json({ error: "Failed to generate preview" }, 500);
    }
  } catch (error) {
    console.error("[Error Pages] Error regenerating preview:", error);
    return c.json({ error: "Failed to regenerate preview" }, 500);
  }
});

app.post("/:id/assign/:domainId", async (c) => {
  const { id, domainId } = c.req.param();
  const pageType = c.req.query("type") || "503"; // "503" or "maintenance"

  try {
    const page = await db.query.errorPages.findFirst({
      where: eq(errorPages.id, id),
    });

    if (!page) {
      return c.json({ error: "Error page not found" }, 404);
    }

    const domain = await db.query.domains.findFirst({
      where: eq(domains.id, domainId),
    });

    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
      configVersion: domain.configVersion + 1,
      lastConfigUpdate: new Date(),
    };

    if (pageType === "maintenance") {
      updateData.maintenancePageId = id;
    } else {
      updateData.errorPageId = id;
    }

    await db.update(domains).set(updateData).where(eq(domains.id, domainId));

    return c.json({ success: true });
  } catch (error) {
    console.error("[Error Pages] Error assigning page:", error);
    return c.json({ error: "Failed to assign error page" }, 500);
  }
});

// Unassign error page from domain
app.delete("/:id/assign/:domainId", async (c) => {
  const { id, domainId } = c.req.param();
  const pageType = c.req.query("type") || "503"; // "503" or "maintenance"

  try {
    const page = await db.query.errorPages.findFirst({
      where: eq(errorPages.id, id),
    });

    if (!page) {
      return c.json({ error: "Error page not found" }, 404);
    }

    const domain = await db.query.domains.findFirst({
      where: eq(domains.id, domainId),
    });

    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
      configVersion: domain.configVersion + 1,
      lastConfigUpdate: new Date(),
    };

    if (pageType === "maintenance") {
      updateData.maintenancePageId = null;
    } else {
      updateData.errorPageId = null;
    }

    await db.update(domains).set(updateData).where(eq(domains.id, domainId));

    return c.json({ success: true });
  } catch (error) {
    console.error("[Error Pages] Error unassigning page:", error);
    return c.json({ error: "Failed to unassign error page" }, 500);
  }
});

export default app;
