import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { nanoid } from "nanoid";
import { db } from "@uni-proxy-manager/database";
import { certificates, domains, dnsProviders } from "@uni-proxy-manager/database/schema";
import { eq, and } from "drizzle-orm";
import { Queue } from "bullmq";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { QUEUES, type CertificateIssueJobData, type CertificateRenewalJobData } from "@uni-proxy-manager/queue";
import { getAcmeConfig, getCertsDir } from "@uni-proxy-manager/shared/config";
import { writeFile, mkdir, rm } from "fs/promises";
import { join, dirname } from "path";
import { X509Certificate } from "crypto";

const app = new Hono();

// Validation schemas
const requestCertificateSchema = z.object({
  domainId: z.string().min(1),
  dnsProviderId: z.string().min(1),
  altNames: z.array(z.string()).optional(),
});

const updateCertificateSchema = z.object({
  autoRenew: z.boolean().optional(),
  renewBeforeDays: z.number().int().min(1).max(90).optional(),
  dnsProviderId: z.string().optional(),
});

// List all certificates
app.get("/", async (c) => {
  try {
    const allCertificates = await db.query.certificates.findMany({
      with: {
        domain: true,
        dnsProvider: true,
      },
      orderBy: (certificates, { desc }) => [desc(certificates.createdAt)],
    });

    return c.json({ certificates: allCertificates });
  } catch (error) {
    console.error("[Certificates] Error listing certificates:", error);
    return c.json({ error: "Failed to list certificates" }, 500);
  }
});

// Get single certificate
app.get("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const certificate = await db.query.certificates.findFirst({
      where: eq(certificates.id, id),
      with: {
        domain: true,
        dnsProvider: true,
      },
    });

    if (!certificate) {
      return c.json({ error: "Certificate not found" }, 404);
    }

    return c.json({ certificate });
  } catch (error) {
    console.error("[Certificates] Error getting certificate:", error);
    return c.json({ error: "Failed to get certificate" }, 500);
  }
});

// Request new certificate
app.post("/", zValidator("json", requestCertificateSchema), async (c) => {
  const data = c.req.valid("json");

  try {
    // Check if domain exists
    const domain = await db.query.domains.findFirst({
      where: eq(domains.id, data.domainId),
    });

    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    // Check if DNS provider exists
    const dnsProvider = await db.query.dnsProviders.findFirst({
      where: eq(dnsProviders.id, data.dnsProviderId),
    });

    if (!dnsProvider) {
      return c.json({ error: "DNS provider not found" }, 404);
    }

    // Check if certificate already exists for this domain (non-wildcard)
    const isWildcardRequest = domain.hostname.startsWith("*.");
    const existingCert = await db.query.certificates.findFirst({
      where: and(
        eq(certificates.domainId, data.domainId),
        eq(certificates.isWildcard, isWildcardRequest)
      ),
    });

    if (existingCert) {
      // If cert exists and is active, queue renewal instead of error
      if (existingCert.status === "active" && existingCert.dnsProviderId) {
        try {
          const redis = getRedisClient();
          const renewalQueue = new Queue<CertificateRenewalJobData>(
            QUEUES.CERTIFICATE_RENEWAL,
            { connection: redis }
          );

          await renewalQueue.add(`renewal-${existingCert.id}`, {
            certificateId: existingCert.id,
            domainId: data.domainId,
            hostname: domain.hostname,
            dnsProviderId: data.dnsProviderId,
            forceRenewal: true,
          });

          return c.json({
            id: existingCert.id,
            message: "Certificate renewal queued",
            renewalQueued: true,
          });
        } catch (queueError) {
          console.error("[Certificates] Failed to queue renewal:", queueError);
          return c.json({ error: "Certificate exists but renewal failed to queue" }, 500);
        }
      } else {
        return c.json({ error: "Certificate already exists for this domain" }, 409);
      }
    }

    const id = nanoid();
    const acmeConfig = getAcmeConfig();

    const [newCertificate] = await db
      .insert(certificates)
      .values({
        id,
        domainId: data.domainId,
        commonName: domain.hostname,
        altNames: data.altNames || [],
        dnsProviderId: data.dnsProviderId,
        status: "pending",
        isWildcard: isWildcardRequest,
        source: "letsencrypt",
      })
      .returning();

    // Update domain to reference this certificate
    await db
      .update(domains)
      .set({
        certificateId: id,
        updatedAt: new Date(),
      })
      .where(eq(domains.id, data.domainId));

    // Queue certificate issuance job
    try {
      const redis = getRedisClient();
      const queue = new Queue<CertificateIssueJobData>(QUEUES.CERTIFICATE_ISSUE, {
        connection: redis,
      });

      await queue.add(
        `issue-${id}`,
        {
          certificateId: id,
          domainId: data.domainId,
          hostname: domain.hostname,
          altNames: data.altNames,
          dnsProviderId: data.dnsProviderId,
          acmeEmail: acmeConfig.email || "",
          staging: acmeConfig.staging,
        },
        { jobId: `cert-issue-${id}` }
      );
    } catch (queueError) {
      console.error("[Certificates] Failed to queue certificate job:", queueError);
      // Don't fail the request, the job can be retried manually
    }

    return c.json({ certificate: newCertificate }, 201);
  } catch (error) {
    console.error("[Certificates] Error requesting certificate:", error);
    return c.json({ error: "Failed to request certificate" }, 500);
  }
});

// Update certificate settings
app.put("/:id", zValidator("json", updateCertificateSchema), async (c) => {
  const { id } = c.req.param();
  const data = c.req.valid("json");

  try {
    const existing = await db.query.certificates.findFirst({
      where: eq(certificates.id, id),
    });

    if (!existing) {
      return c.json({ error: "Certificate not found" }, 404);
    }

    const [updated] = await db
      .update(certificates)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(certificates.id, id))
      .returning();

    return c.json({ certificate: updated });
  } catch (error) {
    console.error("[Certificates] Error updating certificate:", error);
    return c.json({ error: "Failed to update certificate" }, 500);
  }
});

// Force renewal
app.post("/:id/renew", async (c) => {
  const { id } = c.req.param();

  try {
    const certificate = await db.query.certificates.findFirst({
      where: eq(certificates.id, id),
      with: {
        domain: true,
      },
    });

    if (!certificate) {
      return c.json({ error: "Certificate not found" }, 404);
    }

    if (!certificate.dnsProviderId) {
      return c.json({ error: "No DNS provider configured for this certificate" }, 400);
    }

    // Update status to pending renewal
    await db
      .update(certificates)
      .set({
        status: "pending",
        lastRenewalAttempt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(certificates.id, id));

    // Queue renewal job
    try {
      const redis = getRedisClient();
      const queue = new Queue(QUEUES.CERTIFICATE_RENEWAL, {
        connection: redis,
      });

      await queue.add(
        `renew-${id}`,
        {
          certificateId: id,
          domainId: certificate.domainId,
          hostname: certificate.domain.hostname,
          dnsProviderId: certificate.dnsProviderId,
          forceRenewal: true,
        },
        { jobId: `cert-renew-${id}-${Date.now()}` }
      );
    } catch (queueError) {
      console.error("[Certificates] Failed to queue renewal job:", queueError);
    }

    return c.json({ success: true, message: "Renewal queued" });
  } catch (error) {
    console.error("[Certificates] Error forcing renewal:", error);
    return c.json({ error: "Failed to force renewal" }, 500);
  }
});

// Upload manual certificate
app.post("/upload", async (c) => {
  try {
    const body = await c.req.parseBody();

    const certFile = body.cert;
    const keyFile = body.key;
    const chainFile = body.chain;
    const domainId = body.domainId as string | undefined;

    // Validate required files
    if (!certFile || !(certFile instanceof File)) {
      return c.json({ error: "Certificate file is required" }, 400);
    }

    if (!keyFile || !(keyFile instanceof File)) {
      return c.json({ error: "Private key file is required" }, 400);
    }

    // Read file contents
    const certContent = await certFile.text();
    const keyContent = await keyFile.text();
    const chainContent = chainFile && chainFile instanceof File ? await chainFile.text() : null;

    // Validate PEM format
    if (!certContent.includes("BEGIN CERTIFICATE")) {
      return c.json({ error: "Invalid certificate format. Expected PEM format." }, 400);
    }

    if (!keyContent.includes("BEGIN PRIVATE KEY") && !keyContent.includes("BEGIN RSA PRIVATE KEY")) {
      return c.json({ error: "Invalid private key format. Expected PEM format." }, 400);
    }

    // Parse certificate to extract metadata
    let parsedCert: X509Certificate;
    let commonName: string;
    let altNames: string[] = [];
    let expiresAt: Date;
    let issuedAt: Date;
    let issuer: string;
    let isWildcard: boolean;

    try {
      parsedCert = new X509Certificate(certContent);

      // Extract common name from subject
      const subjectMatch = parsedCert.subject.match(/CN=([^,]+)/);
      commonName = subjectMatch?.[1] ?? "";

      // Detect wildcard certificate
      isWildcard = commonName.startsWith("*.");

      // Extract issuer
      issuer = parsedCert.issuer;

      // Extract alternative names
      const san = parsedCert.subjectAltName;
      if (san) {
        altNames = san
          .split(", ")
          .filter(name => name.startsWith("DNS:"))
          .map(name => name.replace("DNS:", ""));
      }

      // Extract dates
      expiresAt = new Date(parsedCert.validTo);
      issuedAt = new Date(parsedCert.validFrom);

    } catch (parseError) {
      console.error("[Certificates] Error parsing certificate:", parseError);
      return c.json({ error: "Failed to parse certificate" }, 400);
    }

    // Auto-detect domain if not provided
    let targetDomainId = domainId;
    let domain;

    if (!targetDomainId) {
      // Try to find matching domain
      const allDomains = await db.query.domains.findMany();

      // Match CN or SANs against existing domain hostnames
      const matchedDomain = allDomains.find(d =>
        d.hostname === commonName ||
        altNames.includes(d.hostname) ||
        (isWildcard && d.hostname.endsWith(commonName.substring(1)))
      );

      if (matchedDomain) {
        targetDomainId = matchedDomain.id;
        domain = matchedDomain;
      } else {
        return c.json({
          error: "No matching domain found. Please select domain manually.",
          availableDomains: allDomains.map(d => ({ id: d.id, hostname: d.hostname }))
        }, 400);
      }
    } else {
      // Check if domain exists
      domain = await db.query.domains.findFirst({
        where: eq(domains.id, targetDomainId),
      });

      if (!domain) {
        return c.json({ error: "Domain not found" }, 404);
      }
    }

    // Determine source (manual upload is always preferred)
    const source = issuer.includes("Let's Encrypt")
      ? "letsencrypt"
      : issuer.toLowerCase().includes("acme")
        ? "acme_other"
        : "manual";

    // Create fullchain (cert + chain)
    const fullchainContent = chainContent ? `${certContent}\n${chainContent}` : certContent;

    // Save certificate files
    const certsDir = getCertsDir();
    const certDir = join(certsDir, targetDomainId);
    await mkdir(certDir, { recursive: true });

    const certPath = `${targetDomainId}/cert.pem`;
    const keyPath = `${targetDomainId}/key.pem`;
    const fullchainPath = `${targetDomainId}/fullchain.pem`;
    const chainPath = chainContent ? `${targetDomainId}/chain.pem` : null;
    const haproxyPemPath = `${targetDomainId}.pem`;

    await writeFile(join(certsDir, certPath), certContent, "utf-8");
    await writeFile(join(certsDir, keyPath), keyContent, "utf-8");
    await writeFile(join(certsDir, fullchainPath), fullchainContent, "utf-8");
    if (chainContent) {
      await writeFile(join(certsDir, chainPath!), chainContent, "utf-8");
    }
    await writeFile(join(certsDir, haproxyPemPath), `${keyContent}\n${fullchainContent}`, "utf-8");

    // Check if certificate already exists for this domain with same type
    const existingCert = await db.query.certificates.findFirst({
      where: and(
        eq(certificates.domainId, targetDomainId),
        eq(certificates.isWildcard, isWildcard)
      ),
    });

    let newCertificate;
    if (existingCert) {
      // Only update if manually uploaded cert is being used, or if existing is not manual
      if (source === "manual" || existingCert.source !== "manual") {
        const [updated] = await db
          .update(certificates)
          .set({
            commonName,
            altNames,
            isWildcard,
            source: source as "manual" | "letsencrypt" | "acme_other",
            issuer,
            status: "active",
            certPath,
            keyPath,
            chainPath,
            fullchainPath,
            issuedAt,
            expiresAt,
            updatedAt: new Date(),
          })
          .where(eq(certificates.id, existingCert.id))
          .returning();
        newCertificate = updated;
      } else {
        return c.json({
          error: "Manual certificate already exists. Delete it first to use Let's Encrypt."
        }, 409);
      }
    } else {
      // Create new certificate
      const id = nanoid();
      const [created] = await db
        .insert(certificates)
        .values({
          id,
          domainId: targetDomainId,
          commonName,
          altNames,
          isWildcard,
          source: source as "manual" | "letsencrypt" | "acme_other",
          issuer,
          status: "active",
          certPath,
          keyPath,
          chainPath,
          fullchainPath,
          issuedAt,
          expiresAt,
        })
        .returning();
      newCertificate = created;
    }

    if (!newCertificate) {
      throw new Error("Failed to create certificate record");
    }

    // Update domain to reference this certificate
    await db
      .update(domains)
      .set({
        certificateId: newCertificate.id,
        updatedAt: new Date(),
      })
      .where(eq(domains.id, targetDomainId));

    return c.json({
      success: true,
      message: "Certificate uploaded successfully",
      certificate: newCertificate,
    }, 201);
  } catch (error) {
    console.error("[Certificates] Error uploading certificate:", error);
    return c.json({ error: "Failed to upload certificate" }, 500);
  }
});

// Delete certificate
app.delete("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const existing = await db.query.certificates.findFirst({
      where: eq(certificates.id, id),
    });

    if (!existing) {
      return c.json({ error: "Certificate not found" }, 404);
    }

    // Clean up certificate files before deleting from database
    if (existing.certPath) {
      const certDir = dirname(existing.certPath);
      try {
        await rm(certDir, { recursive: true, force: true });
        console.log(`[Certificates] Deleted certificate directory: ${certDir}`);
      } catch (cleanupError) {
        console.error("[Certificates] Failed to delete certificate directory:", cleanupError);
      }
    }

    // Also delete the HAProxy PEM file
    if (existing.domainId) {
      const certsDir = getCertsDir();
      const haproxyPemPath = join(certsDir, `${existing.domainId}.pem`);
      try {
        await rm(haproxyPemPath, { force: true });
        console.log(`[Certificates] Deleted HAProxy PEM: ${haproxyPemPath}`);
      } catch {
        // Ignore if PEM doesn't exist
      }
    }

    // Clear certificateId from domain before deleting
    if (existing.domainId) {
      await db
        .update(domains)
        .set({ certificateId: null, updatedAt: new Date() })
        .where(eq(domains.id, existing.domainId));
    }

    await db.delete(certificates).where(eq(certificates.id, id));

    return c.json({ success: true });
  } catch (error) {
    console.error("[Certificates] Error deleting certificate:", error);
    return c.json({ error: "Failed to delete certificate" }, 500);
  }
});

export default app;
