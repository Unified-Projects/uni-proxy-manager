import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { nanoid } from "nanoid";
import { db } from "@uni-proxy-manager/database";
import { domains, backends, certificates, dnsProviders, domainRouteRules, pomeriumRoutes } from "@uni-proxy-manager/database/schema";
import { eq, and } from "drizzle-orm";
import { computeDomainStatus, type CertificateForWildcardCheck } from "@uni-proxy-manager/shared/domain-status";
import { Queue } from "bullmq";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { QUEUES, type CertificateIssueJobData } from "@uni-proxy-manager/queue";
import { getAcmeConfig, getCertsDir } from "@uni-proxy-manager/shared/config";
import { validateBypassIPs } from "@uni-proxy-manager/shared";
import { rm } from "fs/promises";
import { join, dirname } from "path";

const app = new Hono();

/**
 * Validate a hostname for security
 * - Allows wildcards like *.example.com (only at start)
 * - No consecutive dots
 * - No trailing/leading hyphens in labels
 * - Must have at least 2 labels (e.g., example.com)
 * - Labels must be 1-63 characters, total max 253
 */
function isValidHostname(hostname: string): { valid: boolean; error?: string } {
  if (!hostname || typeof hostname !== "string") {
    return { valid: false, error: "Hostname is required" };
  }

  // Check total length
  if (hostname.length > 253) {
    return { valid: false, error: "Hostname exceeds maximum length of 253 characters" };
  }

  // Check for wildcard prefix
  let hostnameToCheck = hostname;
  if (hostname.startsWith("*.")) {
    hostnameToCheck = hostname.substring(2);
  } else if (hostname.includes("*")) {
    return { valid: false, error: "Wildcards are only allowed at the beginning (e.g., *.example.com)" };
  }

  // Check for consecutive dots
  if (hostnameToCheck.includes("..")) {
    return { valid: false, error: "Hostname cannot contain consecutive dots" };
  }

  // Split into labels
  const labels = hostnameToCheck.split(".");

  // Must have at least 2 labels (domain.tld)
  if (labels.length < 2) {
    return { valid: false, error: "Hostname must include at least a domain and TLD (e.g., example.com)" };
  }

  // Validate each label
  for (const label of labels) {
    if (label.length === 0) {
      return { valid: false, error: "Hostname cannot have empty labels" };
    }
    if (label.length > 63) {
      return { valid: false, error: `Label "${label}" exceeds maximum length of 63 characters` };
    }
    if (label.startsWith("-") || label.endsWith("-")) {
      return { valid: false, error: `Label "${label}" cannot start or end with a hyphen` };
    }
    if (!/^[a-zA-Z0-9-]+$/.test(label)) {
      return { valid: false, error: `Label "${label}" contains invalid characters (only alphanumeric and hyphens allowed)` };
    }
  }

  // Check TLD is not all-numeric (invalid)
  const tld = labels[labels.length - 1];
  if (tld && /^\d+$/.test(tld)) {
    return { valid: false, error: "TLD cannot be all numeric" };
  }

  return { valid: true };
}

// Legacy regex for backward compatibility in schema
const hostnameRegex = /^(\*\.)?[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$/;

const createDomainSchema = z.object({
  hostname: z.string().min(1).regex(hostnameRegex, "Invalid hostname format"),
  displayName: z.string().optional(),
  sslEnabled: z.boolean().default(false),
  forceHttps: z.boolean().default(false),
  acmeVerificationMethod: z.enum(["dns-01", "http-01", "none"]).default("none"),
  acmeDnsProviderId: z.string().optional(),
});

const updateDomainSchema = z.object({
  displayName: z.string().optional(),
  sslEnabled: z.boolean().optional(),
  forceHttps: z.boolean().optional(),
  acmeVerificationMethod: z.enum(["dns-01", "http-01", "none"]).optional(),
  acmeDnsProviderId: z.string().nullable().optional(),
  maintenanceEnabled: z.boolean().optional(),
  maintenanceBypassIps: z.array(z.string()).optional(),
  errorPageId: z.string().nullable().optional(),
  maintenancePageId: z.string().nullable().optional(),
  wwwRedirectEnabled: z.boolean().optional(),
  subdomainAliases: z.array(z.string()).optional(),
});

// List all domains
app.get("/", async (c) => {
  try {
    const allDomains = await db.query.domains.findMany({
      with: {
        backends: true,
        certificate: true,
      },
      orderBy: (domains, { desc }) => [desc(domains.createdAt)],
    });

    // Build list of all certificates for wildcard matching
    const allCertificates: CertificateForWildcardCheck[] = allDomains
      .filter((d) => d.certificate)
      .map((d) => ({
        status: d.certificate!.status as CertificateForWildcardCheck["status"],
        altNames: d.certificate!.altNames ?? undefined,
      }));

    // Fetch domain IDs that have enabled redirect route rules
    const redirectRuleDomainIds = new Set(
      (await db.query.domainRouteRules.findMany({
        where: and(eq(domainRouteRules.actionType, "redirect"), eq(domainRouteRules.enabled, true)),
        columns: { domainId: true },
      })).map(r => r.domainId)
    );

    // Fetch domain IDs that have pomerium routes
    const pomeriumRouteDomainIds = new Set(
      (await db.query.pomeriumRoutes.findMany({
        columns: { domainId: true },
      })).map(r => r.domainId)
    );

    // Add computed status to each domain
    const domainsWithStatus = allDomains.map((domain) => ({
      ...domain,
      statusComputed: computeDomainStatus({
        ...domain,
        hasRedirectRoutes: redirectRuleDomainIds.has(domain.id),
        hasPomeriumRoutes: pomeriumRouteDomainIds.has(domain.id),
      }, allCertificates),
    }));

    return c.json({ domains: domainsWithStatus });
  } catch (error) {
    console.error("[Domains] Error listing domains:", error);
    return c.json({ error: "Failed to list domains" }, 500);
  }
});

// Get single domain
app.get("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const domain = await db.query.domains.findFirst({
      where: eq(domains.id, id),
      with: {
        backends: true,
        certificate: true,
      },
    });

    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    // Fetch all certificates for wildcard matching
    const allCerts = await db.query.certificates.findMany();
    const allCertificates: CertificateForWildcardCheck[] = allCerts.map((cert) => ({
      status: cert.status as CertificateForWildcardCheck["status"],
      altNames: cert.altNames ?? undefined,
    }));

    // Check for redirect route rules and pomerium routes for this domain
    const [redirectRuleCount, pomeriumRouteCount] = await Promise.all([
      db.query.domainRouteRules.findMany({
        where: and(eq(domainRouteRules.domainId, id), eq(domainRouteRules.actionType, "redirect"), eq(domainRouteRules.enabled, true)),
        columns: { id: true },
      }),
      db.query.pomeriumRoutes.findMany({
        where: eq(pomeriumRoutes.domainId, id),
        columns: { id: true },
      }),
    ]);

    // Add computed status
    const domainWithStatus = {
      ...domain,
      statusComputed: computeDomainStatus({
        ...domain,
        hasRedirectRoutes: redirectRuleCount.length > 0,
        hasPomeriumRoutes: pomeriumRouteCount.length > 0,
      }, allCertificates),
    };

    return c.json({ domain: domainWithStatus });
  } catch (error) {
    console.error("[Domains] Error getting domain:", error);
    return c.json({ error: "Failed to get domain" }, 500);
  }
});

// Create domain
app.post("/", zValidator("json", createDomainSchema), async (c) => {
  const data = c.req.valid("json");

  try {
    // Enhanced hostname validation
    const hostnameValidation = isValidHostname(data.hostname);
    if (!hostnameValidation.valid) {
      return c.json({ error: hostnameValidation.error }, 400);
    }

    // Check if hostname already exists
    const existing = await db.query.domains.findFirst({
      where: eq(domains.hostname, data.hostname),
    });

    if (existing) {
      return c.json({ error: "Domain with this hostname already exists" }, 409);
    }

    // Validate DNS provider if DNS-01 verification is selected
    if (data.acmeVerificationMethod === "dns-01" && data.sslEnabled) {
      if (!data.acmeDnsProviderId) {
        return c.json({ error: "DNS provider is required for DNS-01 verification" }, 400);
      }

      const dnsProvider = await db.query.dnsProviders.findFirst({
        where: eq(dnsProviders.id, data.acmeDnsProviderId),
      });

      if (!dnsProvider) {
        return c.json({ error: "DNS provider not found" }, 404);
      }
    }

    const id = nanoid();
    const [newDomain] = await db
      .insert(domains)
      .values({
        id,
        hostname: data.hostname,
        displayName: data.displayName,
        sslEnabled: data.sslEnabled,
        forceHttps: data.forceHttps,
        acmeVerificationMethod: data.acmeVerificationMethod,
        acmeDnsProviderId: data.acmeDnsProviderId,
        status: "pending",
      })
      .returning();

    // Auto-request certificate if SSL is enabled and ACME verification is not "none"
    let certificateCreated = false;
    if (data.sslEnabled && data.acmeVerificationMethod !== "none") {
      try {
        const certId = nanoid();
        const acmeConfig = getAcmeConfig();

        // Create certificate record
        await db.insert(certificates).values({
          id: certId,
          domainId: id,
          commonName: data.hostname,
          altNames: [],
          isWildcard: data.hostname.startsWith("*."),
          dnsProviderId: data.acmeDnsProviderId,
          status: "pending",
        });

        // Queue certificate issuance job
        try {
          const redis = getRedisClient();
          const queue = new Queue<CertificateIssueJobData>(QUEUES.CERTIFICATE_ISSUE, {
            connection: redis,
          });

          await queue.add(
            `issue-${certId}`,
            {
              certificateId: certId,
              domainId: id,
              hostname: data.hostname,
              altNames: [],
              dnsProviderId: data.acmeDnsProviderId!,
              acmeEmail: acmeConfig.email || "",
              staging: acmeConfig.staging,
            },
            { jobId: `cert-issue-${certId}-auto` }
          );

          certificateCreated = true;
        } catch (queueError) {
          console.error("[Domains] Failed to queue certificate job:", queueError);
          // Mark domain as error since auto-cert failed
          await db
            .update(domains)
            .set({
              status: "error",
              updatedAt: new Date(),
            })
            .where(eq(domains.id, id));
        }
      } catch (certError) {
        console.error("[Domains] Failed to create certificate:", certError);
        // Mark domain as error
        await db
          .update(domains)
          .set({
            status: "error",
            updatedAt: new Date(),
          })
          .where(eq(domains.id, id));
      }
    }
    // Note: Domain stays in "pending" status until explicitly activated via PUT /api/domains/:id

    // Fetch with backends and certificate to compute status
    const domainWithBackends = await db.query.domains.findFirst({
      where: eq(domains.id, id),
      with: {
        backends: true,
        certificate: true,
      },
    });

    // Safety check - domain should exist since we just created it
    if (!domainWithBackends) {
      console.error("[Domains] Domain not found after creation - this should not happen", { id });
      // Return the basic domain data we have from the insert
      return c.json({
        domain: {
          ...newDomain,
          backends: [],
          certificate: null,
          statusComputed: "pending",
        },
        certificateCreated,
        message: certificateCreated
          ? "Domain created. Certificate issuance in progress."
          : "Domain created successfully.",
      }, 201);
    }

    // Fetch all certificates for wildcard matching
    const allCerts = await db.query.certificates.findMany();
    const allCertificates: CertificateForWildcardCheck[] = allCerts.map((cert) => ({
      status: cert.status as CertificateForWildcardCheck["status"],
      altNames: cert.altNames ?? undefined,
    }));

    const domainWithStatus = {
      ...domainWithBackends,
      statusComputed: computeDomainStatus(domainWithBackends, allCertificates),
    };

    return c.json({
      domain: domainWithStatus,
      certificateCreated,
      message: certificateCreated
        ? "Domain created. Certificate issuance in progress."
        : "Domain created successfully.",
    }, 201);
  } catch (error) {
    console.error("[Domains] Error creating domain:", error);
    return c.json({ error: "Failed to create domain" }, 500);
  }
});

// Update domain
app.put("/:id", zValidator("json", updateDomainSchema), async (c) => {
  const { id } = c.req.param();
  const data = c.req.valid("json");

  try {
    const existing = await db.query.domains.findFirst({
      where: eq(domains.id, id),
    });

    if (!existing) {
      return c.json({ error: "Domain not found" }, 404);
    }

    // Validate bypass IPs if provided
    let validatedBypassIps = data.maintenanceBypassIps;
    if (data.maintenanceBypassIps && data.maintenanceBypassIps.length > 0) {
      const ipValidation = validateBypassIPs(data.maintenanceBypassIps);
      if (ipValidation.errors.length > 0) {
        return c.json({
          error: "Invalid bypass IP addresses",
          details: ipValidation.errors
        }, 400);
      }
      validatedBypassIps = ipValidation.valid;
    }

    // Handle www redirect alias management
    let resolvedAliases = data.subdomainAliases ?? (existing.subdomainAliases as string[] | null) ?? [];
    const wwwAlias = `www.${existing.hostname}`;

    if (data.wwwRedirectEnabled === true) {
      // Auto-prepend www alias if not already present
      if (!resolvedAliases.includes(wwwAlias)) {
        resolvedAliases = [wwwAlias, ...resolvedAliases];
      }
    } else if (data.wwwRedirectEnabled === false) {
      // Remove www alias when toggled off
      resolvedAliases = resolvedAliases.filter((a) => a !== wwwAlias);
    }

    await db
      .update(domains)
      .set({
        ...data,
        maintenanceBypassIps: validatedBypassIps,
        subdomainAliases: resolvedAliases,
        updatedAt: new Date(),
        configVersion: existing.configVersion + 1,
        lastConfigUpdate: new Date(),
      })
      .where(eq(domains.id, id));

    // Fetch with backends and certificate to compute status
    const domainWithBackends = await db.query.domains.findFirst({
      where: eq(domains.id, id),
      with: {
        backends: true,
        certificate: true,
      },
    });

    // Fetch all certificates for wildcard matching
    const allCerts = await db.query.certificates.findMany();
    const allCertificatesForUpdate: CertificateForWildcardCheck[] = allCerts.map((cert) => ({
      status: cert.status as CertificateForWildcardCheck["status"],
      altNames: cert.altNames ?? undefined,
    }));

    const domainWithStatus = {
      ...domainWithBackends,
      statusComputed: computeDomainStatus(domainWithBackends!, allCertificatesForUpdate),
    };

    return c.json({ domain: domainWithStatus });
  } catch (error) {
    console.error("[Domains] Error updating domain:", error);
    return c.json({ error: "Failed to update domain" }, 500);
  }
});

// Delete domain
app.delete("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const existing = await db.query.domains.findFirst({
      where: eq(domains.id, id),
      with: {
        certificate: true,
      },
    });

    if (!existing) {
      return c.json({ error: "Domain not found" }, 404);
    }

    // Clean up certificate files before deleting domain
    if (existing.certificate?.certPath) {
      const certDir = dirname(existing.certificate.certPath);
      try {
        await rm(certDir, { recursive: true, force: true });
        console.log(`[Domains] Deleted certificate directory: ${certDir}`);
      } catch (cleanupError) {
        console.error("[Domains] Failed to delete certificate directory:", cleanupError);
      }
    }

    // Also delete the HAProxy PEM file
    const certsDir = getCertsDir();
    const haproxyPemPath = join(certsDir, `${id}.pem`);
    try {
      await rm(haproxyPemPath, { force: true });
      console.log(`[Domains] Deleted HAProxy PEM: ${haproxyPemPath}`);
    } catch {
      // Ignore if PEM doesn't exist
    }

    await db.delete(domains).where(eq(domains.id, id));

    return c.json({ success: true });
  } catch (error) {
    console.error("[Domains] Error deleting domain:", error);
    return c.json({ error: "Failed to delete domain" }, 500);
  }
});

// Get backends for domain
app.get("/:id/backends", async (c) => {
  const { id } = c.req.param();

  try {
    const domainBackends = await db.query.backends.findMany({
      where: eq(backends.domainId, id),
      orderBy: (backends, { asc }) => [asc(backends.createdAt)],
    });

    return c.json({ backends: domainBackends });
  } catch (error) {
    console.error("[Domains] Error listing backends:", error);
    return c.json({ error: "Failed to list backends" }, 500);
  }
});

export default app;
