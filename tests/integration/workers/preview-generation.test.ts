import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { createErrorPageFixture, createTestZipFile } from "../setup/fixtures";
import { generatePreview, closeBrowser } from "../../../apps/api/src/services/preview-generator";
import { checkPlaywrightAvailable } from "../setup/playwright-check";
import { access, readFile, mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { getErrorPagesDir } from "@uni-proxy-manager/shared/config";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";

describe("Preview Generation Worker", () => {
  const errorPagesDir = getErrorPagesDir();
  let testPageId: string;
  let playwrightAvailable = false;

  beforeAll(async () => {
    await clearDatabase();
    playwrightAvailable = await checkPlaywrightAvailable();
  });

  afterAll(async () => {
    await closeBrowser();
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  describe("generatePreview Function", () => {
    it.skipIf(!playwrightAvailable)(
      "should generate PNG preview from HTML file",
      async () => {
        const createRes = await testClient.post<{ errorPage: any }>(
          "/api/error-pages",
          createErrorPageFixture("503")
        );
        testPageId = createRes.body.errorPage.id;

        const zipFile = await createTestZipFile(
          "<html><body style='background:blue;color:white;'><h1>503 Error</h1></body></html>"
        );
        await testClient.uploadFile(`/api/error-pages/${testPageId}/upload`, zipFile);

        const previewPath = join(errorPagesDir, testPageId, "preview.png");
        await access(previewPath);
        const fileContents = await readFile(previewPath);

        // Verify it's a valid PNG (check magic bytes)
        expect(fileContents.length).toBeGreaterThan(0);
        expect(fileContents[0]).toBe(0x89);
        expect(fileContents[1]).toBe(0x50); // P
        expect(fileContents[2]).toBe(0x4e); // N
        expect(fileContents[3]).toBe(0x47); // G
      }
    );

    it.skipIf(!playwrightAvailable)(
      "should update database with preview path after generation",
      async () => {
        const createRes = await testClient.post<{ errorPage: any }>(
          "/api/error-pages",
          createErrorPageFixture("503")
        );
        testPageId = createRes.body.errorPage.id;

        const zipFile = await createTestZipFile(
          "<html><body><h1>Test Page</h1></body></html>"
        );
        await testClient.uploadFile(`/api/error-pages/${testPageId}/upload`, zipFile);

        const errorPage = await testDb.query.errorPages.findFirst({
          where: eq(schema.errorPages.id, testPageId),
        });

        expect(errorPage).toBeDefined();
        expect(errorPage!.previewImagePath).toBeDefined();
        expect(errorPage!.previewImagePath).toContain(testPageId);
        expect(errorPage!.previewImagePath).toContain("preview.png");
      }
    );

    it.skipIf(!playwrightAvailable)(
      "should regenerate preview when requested",
      async () => {
        const createRes = await testClient.post<{ errorPage: any }>(
          "/api/error-pages",
          createErrorPageFixture("503")
        );
        testPageId = createRes.body.errorPage.id;

        const zipFile = await createTestZipFile(
          "<html><body><h1>Original</h1></body></html>"
        );
        await testClient.uploadFile(`/api/error-pages/${testPageId}/upload`, zipFile);

        const regenRes = await testClient.post<{ success: boolean; errorPage: any }>(
          `/api/error-pages/${testPageId}/regenerate-preview`
        );

        expect(regenRes.status).toBe(200);
        expect(regenRes.body.success).toBe(true);
        expect(regenRes.body.errorPage.previewImagePath).toBeDefined();
        expect(regenRes.body.errorPage.previewImagePath).toContain("preview.png");
      }
    );

    it.skipIf(!playwrightAvailable)(
      "should render preview even for malformed HTML (browsers are forgiving)",
      async () => {
        const createRes = await testClient.post<{ errorPage: any }>(
          "/api/error-pages",
          createErrorPageFixture("503")
        );
        testPageId = createRes.body.errorPage.id;

        const pageDir = join(errorPagesDir, testPageId);
        try {
          await mkdir(pageDir, { recursive: true });
          await writeFile(join(pageDir, "index.html"), "not valid html at all <<<>>>>");

          // Browsers render even broken HTML, so this should succeed
          const previewPath = await generatePreview(testPageId, join(pageDir, "index.html"));
          expect(previewPath).toBe(`${testPageId}/preview.png`);

          // Verify the preview file was created
          const previewFile = await readFile(join(errorPagesDir, previewPath));
          expect(previewFile.length).toBeGreaterThan(0);
          expect(previewFile[0]).toBe(0x89); // PNG magic byte
        } finally {
          try {
            await rm(pageDir, { recursive: true });
          } catch {
            // Best-effort cleanup
          }
        }
      }
    );

    it.skipIf(!playwrightAvailable)(
      "should handle missing HTML file with an error",
      async () => {
        const fakePageId = "nonexistent-page-id";
        const fakePath = join(errorPagesDir, fakePageId, "index.html");

        await expect(
          generatePreview(fakePageId, fakePath)
        ).rejects.toThrow("Failed to generate preview");
      }
    );
  });

  describe("Preview API Endpoints", () => {
    it.skipIf(!playwrightAvailable)(
      "should serve preview image via API with 200 status",
      async () => {
        const createRes = await testClient.post<{ errorPage: any }>(
          "/api/error-pages",
          createErrorPageFixture("503")
        );
        testPageId = createRes.body.errorPage.id;

        const zipFile = await createTestZipFile(
          "<html><body style='background:red;'><h1>Error</h1></body></html>"
        );
        await testClient.uploadFile(`/api/error-pages/${testPageId}/upload`, zipFile);

        const previewRes = await testClient.getRaw(`/api/error-pages/${testPageId}/preview.png`);

        expect(previewRes.status).toBe(200);
        expect(previewRes.headers.get("content-type")).toBe("image/png");

        // Verify valid PNG content
        const buffer = await previewRes.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        expect(bytes[0]).toBe(0x89);
        expect(bytes[1]).toBe(0x50);
        expect(bytes[2]).toBe(0x4e);
        expect(bytes[3]).toBe(0x47);
      }
    );

    it("should return transparent PNG for page without preview", async () => {
      const createRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture("503")
      );
      testPageId = createRes.body.errorPage.id;

      const previewRes = await testClient.getRaw(`/api/error-pages/${testPageId}/preview.png`);

      expect(previewRes.status).toBe(404);
      expect(previewRes.headers.get("content-type")).toBe("image/png");

      const buffer = await previewRes.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      expect(bytes[0]).toBe(0x89);
      expect(bytes[1]).toBe(0x50);
    });
  });

  describe("Preview for Different Error Page Types", () => {
    it.skipIf(!playwrightAvailable).each([
      ["503", "<h1>503 Service Unavailable</h1>"],
      ["404", "<h1>404 Not Found</h1>"],
      ["500", "<h1>500 Internal Server Error</h1>"],
      ["maintenance", "<h1>Under Maintenance</h1>"],
    ])("should generate preview for %s error page", async (type, content) => {
      const createRes = await testClient.post<{ errorPage: any }>(
        "/api/error-pages",
        createErrorPageFixture(type as any)
      );
      testPageId = createRes.body.errorPage.id;

      const zipFile = await createTestZipFile(
        `<html><body>${content}</body></html>`
      );
      const uploadRes = await testClient.uploadFile<{ success: boolean; errorPage: any }>(
        `/api/error-pages/${testPageId}/upload`,
        zipFile
      );

      expect(uploadRes.status).toBe(200);
      expect(uploadRes.body.success).toBe(true);

      // Verify preview was actually generated
      const getRes = await testClient.get<{ errorPage: any }>(
        `/api/error-pages/${testPageId}`
      );
      expect(getRes.body.errorPage.uploadedAt).toBeDefined();
      expect(getRes.body.errorPage.previewImagePath).toBeDefined();
      expect(getRes.body.errorPage.previewImagePath).toContain("preview.png");
    });
  });

  describe("Preview Cache Busting", () => {
    it.skipIf(!playwrightAvailable)(
      "should support cache busting query parameter",
      async () => {
        const createRes = await testClient.post<{ errorPage: any }>(
          "/api/error-pages",
          createErrorPageFixture("503")
        );
        testPageId = createRes.body.errorPage.id;

        const zipFile = await createTestZipFile("<html><body>Test</body></html>");
        await testClient.uploadFile(`/api/error-pages/${testPageId}/upload`, zipFile);

        const timestamp = Date.now();
        const previewRes = await testClient.getRaw(
          `/api/error-pages/${testPageId}/preview.png?t=${timestamp}`
        );

        expect(previewRes.status).toBe(200);
        expect(previewRes.headers.get("content-type")).toBe("image/png");
      }
    );
  });

  describe("Concurrent Preview Generation", () => {
    it.skipIf(!playwrightAvailable)(
      "should handle multiple preview generations concurrently",
      async () => {
        const pages: string[] = [];
        for (let i = 0; i < 3; i++) {
          const createRes = await testClient.post<{ errorPage: any }>(
            "/api/error-pages",
            createErrorPageFixture("503")
          );
          pages.push(createRes.body.errorPage.id);
        }

        const uploadPromises = pages.map(async (pageId, i) => {
          const zipFile = await createTestZipFile(
            `<html><body><h1>Page ${i}</h1></body></html>`
          );
          return testClient.uploadFile(`/api/error-pages/${pageId}/upload`, zipFile);
        });

        const results = await Promise.all(uploadPromises);

        for (const result of results) {
          expect(result.status).toBe(200);
        }

        // Verify all pages got previews
        for (const pageId of pages) {
          const getRes = await testClient.get<{ errorPage: any }>(
            `/api/error-pages/${pageId}`
          );
          expect(getRes.body.errorPage.previewImagePath).toBeDefined();
          expect(getRes.body.errorPage.previewImagePath).toContain("preview.png");
        }
      }
    );
  });
});
