import type { Job } from "bullmq";
import type { CertificateRenewalJobData, CertificateResult } from "@uni-proxy-manager/queue";
import { db } from "@uni-proxy-manager/database";
import { certificates } from "@uni-proxy-manager/database/schema";
import { eq, and, lte } from "drizzle-orm";
import { Queue } from "bullmq";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { QUEUES, type CertificateIssueJobData } from "@uni-proxy-manager/queue";
import { getAcmeConfig } from "@uni-proxy-manager/shared/config";

export async function processCertificateRenewal(
  job: Job<CertificateRenewalJobData>
): Promise<CertificateResult> {
  const { certificateId, domainId, hostname, dnsProviderId, forceRenewal } = job.data;

  console.log(`[CertRenewal] Processing renewal for ${hostname}`);

  try {
    // Get certificate
    const cert = await db.query.certificates.findFirst({
      where: eq(certificates.id, certificateId),
      with: {
        domain: true,
      },
    });

    if (!cert) {
      throw new Error("Certificate not found");
    }

    // Check if renewal is needed
    if (!forceRenewal && cert.expiresAt) {
      const daysUntilExpiry = Math.floor(
        (cert.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );

      if (daysUntilExpiry > cert.renewBeforeDays) {
        console.log(
          `[CertRenewal] Certificate for ${hostname} not due for renewal (${daysUntilExpiry} days left)`
        );

        return {
          success: true,
          certificateId,
        };
      }
    }

    // Update status
    await db
      .update(certificates)
      .set({
        status: "issuing",
        lastRenewalAttempt: new Date(),
        renewalAttempts: (cert.renewalAttempts || 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(certificates.id, certificateId));

    // Queue a new certificate issue job (renewal uses same flow)
    const redis = getRedisClient();
    const queue = new Queue<CertificateIssueJobData>(QUEUES.CERTIFICATE_ISSUE, {
      connection: redis,
    });

    const acmeConfig = getAcmeConfig();

    await queue.add(
      `renew-issue-${certificateId}`,
      {
        certificateId,
        domainId,
        hostname,
        altNames: (cert.altNames as string[]) || [],
        dnsProviderId: dnsProviderId || cert.dnsProviderId || "",
        acmeEmail: acmeConfig.email || "",
        staging: acmeConfig.staging,
      },
      { jobId: `cert-renew-issue-${certificateId}-${Date.now()}` }
    );

    console.log(`[CertRenewal] Renewal queued for ${hostname}`);

    return {
      success: true,
      certificateId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    console.error(`[CertRenewal] Failed to renew certificate for ${hostname}:`, errorMessage);

    return {
      success: false,
      certificateId,
      error: errorMessage,
    };
  }
}

/**
 * Check all certificates for renewal (called by scheduler)
 */
export async function checkCertificatesForRenewal(): Promise<void> {
  console.log("[CertRenewal] Checking certificates for renewal...");

  try {
    const now = new Date();

    // Find certificates due for renewal
    const dueForRenewal = await db.query.certificates.findMany({
      where: and(
        eq(certificates.autoRenew, true),
        eq(certificates.status, "active"),
        lte(certificates.nextRenewalCheck, now)
      ),
      with: {
        domain: true,
      },
    });

    console.log(`[CertRenewal] Found ${dueForRenewal.length} certificates due for renewal`);

    const redis = getRedisClient();
    const queue = new Queue<CertificateRenewalJobData>(QUEUES.CERTIFICATE_RENEWAL, {
      connection: redis,
    });

    for (const cert of dueForRenewal) {
      await queue.add(
        `renewal-check-${cert.id}`,
        {
          certificateId: cert.id,
          domainId: cert.domainId,
          hostname: cert.commonName,
          dnsProviderId: cert.dnsProviderId || "",
        },
        { jobId: `cert-renewal-${cert.id}-${Date.now()}` }
      );
    }
  } catch (error) {
    console.error("[CertRenewal] Error checking certificates:", error);
  }
}
