import { Hono } from "hono";
import { db } from "@uni-proxy-manager/database";
import {
  domains,
  backends,
  certificates,
  dnsProviders,
  domainRouteRules,
  domainIpRules,
  domainSecurityHeaders,
  domainBlockedRoutes,
  sharedBackends,
  domainSharedBackends,
} from "@uni-proxy-manager/database/schema";
import { getCertsDir } from "@uni-proxy-manager/shared/config";
import { Queue } from "bullmq";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { QUEUES } from "@uni-proxy-manager/queue";
import type { HaproxyReloadJobData } from "@uni-proxy-manager/queue";
import AdmZip from "adm-zip";
import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { join, resolve, normalize, isAbsolute, relative } from "path";
import { eq } from "drizzle-orm";

const app = new Hono();

const EXPORT_VERSION = "1.0.0";
const CERTIFICATE_PATH_FIELDS = ["certPath", "keyPath", "chainPath", "fullchainPath"] as const;

function normalizeCertificatePath(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue || trimmedValue.includes("\0")) {
    return null;
  }

  const certsDir = resolve(getCertsDir());

  if (isAbsolute(trimmedValue)) {
    const relativePath = relative(certsDir, resolve(trimmedValue)).replace(/\\/g, "/");
    const normalizedRelativePath = normalize(relativePath).replace(/\\/g, "/");
    const segments = normalizedRelativePath.split("/").filter(Boolean);

    if (
      normalizedRelativePath === "." ||
      normalizedRelativePath.startsWith("..") ||
      normalizedRelativePath.includes("/../") ||
      segments.length < 2
    ) {
      return null;
    }

    return normalizedRelativePath;
  }

  const normalizedRelativePath = normalize(trimmedValue).replace(/\\/g, "/");
  const segments = normalizedRelativePath.split("/").filter(Boolean);

  if (
    normalizedRelativePath === "." ||
    normalizedRelativePath.startsWith("..") ||
    normalizedRelativePath.includes("/../") ||
    normalizedRelativePath.startsWith("/") ||
    segments.length < 2
  ) {
    return null;
  }

  const resolvedPath = resolve(certsDir, normalizedRelativePath);
  const relativePath = relative(certsDir, resolvedPath).replace(/\\/g, "/");
  if (
    relativePath === "." ||
    relativePath.startsWith("..") ||
    relativePath.includes("/../")
  ) {
    return null;
  }

  return normalizedRelativePath;
}

function sanitizeImportedCertificate(
  cert: Record<string, unknown>,
  warnings: string[]
): Record<string, unknown> {
  const sanitizedCert: Record<string, unknown> = { ...cert };

  for (const field of CERTIFICATE_PATH_FIELDS) {
    if (sanitizedCert[field] == null) {
      sanitizedCert[field] = null;
      continue;
    }

    const normalizedPath = normalizeCertificatePath(sanitizedCert[field]);
    if (!normalizedPath) {
      warnings.push(
        `Certificate ${String(cert.id ?? "unknown")} imported without ${field}: only managed cert-volume-relative paths are accepted`
      );
      sanitizedCert[field] = null;
      continue;
    }

    sanitizedCert[field] = normalizedPath;
  }

  return sanitizedCert;
}

// GET /export — export settings as ZIP
app.get("/export", async (c) => {
  const includeCertificates = c.req.query("includeCertificates") !== "false";
  const includeSensitive = c.req.query("includeSensitive") === "true";

  try {
    const zip = new AdmZip();
    const manifest: Record<string, unknown> = {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      includedCertFiles: includeCertificates,
      includedSensitiveData: includeSensitive,
      tables: [] as string[],
    };

    const tables: string[] = [];

    // Export domains
    const allDomains = await db.query.domains.findMany();
    zip.addFile("data/domains.json", Buffer.from(JSON.stringify(allDomains, null, 2)));
    tables.push("domains");

    // Export backends
    const allBackends = await db.query.backends.findMany();
    zip.addFile("data/backends.json", Buffer.from(JSON.stringify(allBackends, null, 2)));
    tables.push("backends");

    // Export shared backends
    const allSharedBackends = await db.query.sharedBackends.findMany();
    zip.addFile("data/shared_backends.json", Buffer.from(JSON.stringify(allSharedBackends, null, 2)));
    tables.push("shared_backends");

    // Export domain shared backend links
    const allDomainSharedBackends = await db.query.domainSharedBackends.findMany();
    zip.addFile("data/domain_shared_backends.json", Buffer.from(JSON.stringify(allDomainSharedBackends, null, 2)));
    tables.push("domain_shared_backends");

    // Export certificates (metadata only, not the actual cert files by default)
    const allCertificates = await db.query.certificates.findMany();
    zip.addFile("data/certificates.json", Buffer.from(JSON.stringify(allCertificates, null, 2)));
    tables.push("certificates");

    // Export DNS providers (strip credentials unless includeSensitive)
    const allDnsProviders = await db.query.dnsProviders.findMany();
    const dnsProvidersData = includeSensitive
      ? allDnsProviders
      : allDnsProviders.map((p) => ({ ...p, credentials: null }));
    zip.addFile("data/dns_providers.json", Buffer.from(JSON.stringify(dnsProvidersData, null, 2)));
    tables.push("dns_providers");

    // Export route rules
    const allRouteRules = await db.query.domainRouteRules.findMany();
    zip.addFile("data/domain_route_rules.json", Buffer.from(JSON.stringify(allRouteRules, null, 2)));
    tables.push("domain_route_rules");

    // Export IP rules
    const allIpRules = await db.query.domainIpRules.findMany();
    zip.addFile("data/domain_ip_rules.json", Buffer.from(JSON.stringify(allIpRules, null, 2)));
    tables.push("domain_ip_rules");

    // Export security headers
    const allSecurityHeaders = await db.query.domainSecurityHeaders.findMany();
    zip.addFile("data/domain_security_headers.json", Buffer.from(JSON.stringify(allSecurityHeaders, null, 2)));
    tables.push("domain_security_headers");

    // Export blocked routes
    const allBlockedRoutes = await db.query.domainBlockedRoutes.findMany();
    zip.addFile("data/domain_blocked_routes.json", Buffer.from(JSON.stringify(allBlockedRoutes, null, 2)));
    tables.push("domain_blocked_routes");

    // Include certificate files if requested
    const includedCertFiles: string[] = [];
    if (includeCertificates) {
      const certsDir = getCertsDir();
      try {
        const certDirs = await readdir(certsDir);
        for (const certDirName of certDirs) {
          const certDirPath = join(certsDir, certDirName);
          try {
            const files = await readdir(certDirPath);
            for (const file of files) {
              const filePath = join(certDirPath, file);
              const content = await readFile(filePath);
              const zipPath = `certs/${certDirName}/${file}`;
              zip.addFile(zipPath, content);
              includedCertFiles.push(zipPath);
            }
          } catch {
            // Skip unreadable cert dirs
          }
        }
      } catch {
        // Certs dir may not exist
      }
    }

    manifest.tables = tables;
    manifest.includedCertFiles = includedCertFiles.length > 0 ? includedCertFiles : false;
    zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));

    const zipBuffer = zip.toBuffer();
    const dateStr = new Date().toISOString().slice(0, 10);

    return new Response(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="upm-export-${dateStr}.zip"`,
        "Content-Length": String(zipBuffer.length),
      },
    });
  } catch (error) {
    console.error("[SettingsExport] Error exporting settings:", error);
    return c.json({ error: "Failed to export settings" }, 500);
  }
});

// POST /import — import settings from ZIP
app.post("/import", async (c) => {
  try {
    // Parse multipart form — params come as form fields, not query params
    const formData = await c.req.formData();
    const file = formData.get("file");

    const overwriteExisting = formData.get("overwriteExisting") === "true";
    const importCertFiles = formData.get("importCertFiles") !== "false";
    const importSensitiveData = formData.get("importSensitiveData") !== "false";

    if (!file || typeof file === "string") {
      return c.json({ error: "No file provided. Send the ZIP as a 'file' field in multipart/form-data." }, 400);
    }

    const arrayBuffer = await file.arrayBuffer();
    const zipBuffer = Buffer.from(arrayBuffer);

    let zip: AdmZip;
    try {
      zip = new AdmZip(zipBuffer);
    } catch {
      return c.json({ error: "Invalid ZIP file. Provide a valid UPM export archive." }, 400);
    }

    // Validate manifest
    const manifestEntry = zip.getEntry("manifest.json");
    if (!manifestEntry) {
      return c.json({ error: "Invalid export file: manifest.json not found" }, 400);
    }

    const manifest = JSON.parse(manifestEntry.getData().toString("utf-8"));
    if (!manifest.version) {
      return c.json({ error: "Invalid manifest: missing version" }, 400);
    }

    const warnings: string[] = [];
    const imported: Record<string, number> = {};
    const skipped: Record<string, number> = {};

    // Helper to read table data from zip
    function readTable(name: string): unknown[] {
      const entry = zip.getEntry(`data/${name}.json`);
      if (!entry) return [];
      try {
        return JSON.parse(entry.getData().toString("utf-8")) as unknown[];
      } catch {
        warnings.push(`Failed to parse data/${name}.json`);
        return [];
      }
    }

    // ISO timestamp string fields that drizzle/postgres.js needs as Date objects
    const TIMESTAMP_FIELDS = [
      "createdAt", "updatedAt", "lastSyncAt", "lastSeenAt",
      "lastHealthCheck", "lastConfigUpdate", "lastHealthCheck",
    ];

    function coerceDates(row: Record<string, unknown>): Record<string, unknown> {
      const out: Record<string, unknown> = { ...row };
      for (const field of TIMESTAMP_FIELDS) {
        if (typeof out[field] === "string") {
          const d = new Date(out[field] as string);
          out[field] = isNaN(d.getTime()) ? null : d;
        }
      }
      return out;
    }

    // Import in FK-safe order
    // 1. Domains
    const domainsData = readTable("domains") as Array<Record<string, unknown>>;
    let domainImported = 0;
    let domainSkipped = 0;
    for (const _domain of domainsData) {
      const domain = coerceDates(_domain);
      try {
        const existing = await db.query.domains.findFirst({
          where: (t, { eq }) => eq(t.id, domain.id as string),
        });
        if (existing) {
          if (overwriteExisting) {
            await db.update(domains).set({ ...domain, updatedAt: new Date() } as never).where(eq(domains.id, domain.id as string));
          } else {
            domainSkipped++;
            continue;
          }
        } else {
          await db.insert(domains).values(domain as never).onConflictDoNothing();
        }
        domainImported++;
      } catch (e) {
        warnings.push(`Domain ${domain.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    imported.domains = domainImported;
    skipped.domains = domainSkipped;

    // 2. DNS Providers
    const dnsProvidersData = readTable("dns_providers") as Array<Record<string, unknown>>;
    let dnsImported = 0;
    let dnsSkipped = 0;
    for (const _provider of dnsProvidersData) {
      const provider = coerceDates(_provider);
      try {
        const row = importSensitiveData ? provider : { ...provider, credentials: null };
        await db.insert(dnsProviders).values(row as never).onConflictDoNothing();
        dnsImported++;
      } catch {
        dnsSkipped++;
      }
    }
    imported.dnsProviders = dnsImported;
    skipped.dnsProviders = dnsSkipped;

    // 3. Certificates (metadata)
    const certificatesData = readTable("certificates") as Array<Record<string, unknown>>;
    let certImported = 0;
    let certSkipped = 0;
    for (const _cert of certificatesData) {
      const cert = sanitizeImportedCertificate(coerceDates(_cert), warnings);
      try {
        await db.insert(certificates).values(cert as never).onConflictDoNothing();
        certImported++;
      } catch {
        certSkipped++;
      }
    }
    imported.certificates = certImported;
    skipped.certificates = certSkipped;

    // 4. Backends
    const backendsData = readTable("backends") as Array<Record<string, unknown>>;
    let backendImported = 0;
    let backendSkipped = 0;
    for (const _backend of backendsData) {
      const backend = coerceDates(_backend);
      try {
        await db.insert(backends).values(backend as never).onConflictDoNothing();
        backendImported++;
      } catch {
        backendSkipped++;
      }
    }
    imported.backends = backendImported;
    skipped.backends = backendSkipped;

    // 5. Shared Backends
    const sharedBackendsData = readTable("shared_backends") as Array<Record<string, unknown>>;
    let sharedBackendImported = 0;
    for (const _sb of sharedBackendsData) {
      const sb = coerceDates(_sb);
      try {
        await db.insert(sharedBackends).values(sb as never).onConflictDoNothing();
        sharedBackendImported++;
      } catch {
        // skip
      }
    }
    imported.sharedBackends = sharedBackendImported;

    // 6. Domain Shared Backend links
    const domainSharedBackendsData = readTable("domain_shared_backends") as Array<Record<string, unknown>>;
    let dsbImported = 0;
    for (const _dsb of domainSharedBackendsData) {
      const dsb = coerceDates(_dsb);
      try {
        await db.insert(domainSharedBackends).values(dsb as never).onConflictDoNothing();
        dsbImported++;
      } catch {
        // skip
      }
    }
    imported.domainSharedBackends = dsbImported;

    // 7. Domain Route Rules
    const routeRulesData = readTable("domain_route_rules") as Array<Record<string, unknown>>;
    let routeImported = 0;
    for (const _rule of routeRulesData) {
      const rule = coerceDates(_rule);
      try {
        await db.insert(domainRouteRules).values(rule as never).onConflictDoNothing();
        routeImported++;
      } catch {
        // skip
      }
    }
    imported.domainRouteRules = routeImported;

    // 8. Domain IP Rules
    const ipRulesData = readTable("domain_ip_rules") as Array<Record<string, unknown>>;
    let ipImported = 0;
    for (const _rule of ipRulesData) {
      const rule = coerceDates(_rule);
      try {
        await db.insert(domainIpRules).values(rule as never).onConflictDoNothing();
        ipImported++;
      } catch {
        // skip
      }
    }
    imported.domainIpRules = ipImported;

    // 9. Domain Security Headers
    const securityHeadersData = readTable("domain_security_headers") as Array<Record<string, unknown>>;
    let headersImported = 0;
    for (const _headers of securityHeadersData) {
      const headers = coerceDates(_headers);
      try {
        await db.insert(domainSecurityHeaders).values(headers as never).onConflictDoNothing();
        headersImported++;
      } catch {
        // skip
      }
    }
    imported.domainSecurityHeaders = headersImported;

    // 10. Domain Blocked Routes
    const blockedRoutesData = readTable("domain_blocked_routes") as Array<Record<string, unknown>>;
    let blockedImported = 0;
    for (const _route of blockedRoutesData) {
      const route = coerceDates(_route);
      try {
        await db.insert(domainBlockedRoutes).values(route as never).onConflictDoNothing();
        blockedImported++;
      } catch {
        // skip
      }
    }
    imported.domainBlockedRoutes = blockedImported;

    // Restore certificate files if requested
    let certFilesRestored = 0;
    if (importCertFiles) {
      const certsDir = getCertsDir();
      const resolvedCertsDir = resolve(certsDir);
      const entries = zip.getEntries().filter((e) => e.entryName.startsWith("certs/") && !e.isDirectory);
      for (const entry of entries) {
        try {
          const relPath = entry.entryName.substring("certs/".length);

          // Path traversal protection (Zip Slip)
          if (relPath.includes("\0")) {
            warnings.push(`Cert file skipped (null byte in name): ${entry.entryName}`);
            continue;
          }

          const normalizedPath = normalize(relPath);
          if (normalizedPath.startsWith("..") || normalizedPath.includes("/../") || normalizedPath.startsWith("/")) {
            warnings.push(`Cert file skipped (path traversal detected): ${entry.entryName}`);
            continue;
          }

          const targetPath = resolve(resolvedCertsDir, normalizedPath);
          if (!targetPath.startsWith(resolvedCertsDir + "/") && targetPath !== resolvedCertsDir) {
            warnings.push(`Cert file skipped (path traversal detected): ${entry.entryName}`);
            continue;
          }

          const targetDir = join(targetPath, "..");
          await mkdir(targetDir, { recursive: true });
          await writeFile(targetPath, entry.getData());
          certFilesRestored++;
        } catch (e) {
          warnings.push(`Cert file restore failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    imported.certFiles = certFilesRestored;

    // Trigger HAProxy reload after import
    try {
      const redis = getRedisClient();
      const queue = new Queue<HaproxyReloadJobData>(QUEUES.HAPROXY_RELOAD, { connection: redis });
      await queue.add("import-reload", {
        reason: "Settings import",
        triggeredBy: "api",
      });
    } catch {
      warnings.push("Could not queue HAProxy reload — you may need to reload manually.");
    }

    return c.json({ imported, skipped, warnings });
  } catch (error) {
    console.error("[SettingsImport] Error importing settings:", error);
    return c.json({ error: "Failed to import settings" }, 500);
  }
});

export default app;
