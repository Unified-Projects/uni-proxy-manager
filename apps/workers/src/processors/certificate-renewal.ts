import type { Job } from "bullmq";
import type {
  CertificateRenewalJobData,
  CertificateRenewalCheckJobData,
  CertificateRenewalCheckResult,
  CertificateResult,
} from "@uni-proxy-manager/queue";
import { db } from "@uni-proxy-manager/database";
import { certificates } from "@uni-proxy-manager/database/schema";
import { eq, and, lte } from "drizzle-orm";
import { Queue } from "bullmq";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { QUEUES, getQueueConfig, type CertificateIssueJobData } from "@uni-proxy-manager/queue";
import { getAcmeConfig } from "@uni-proxy-manager/shared/config";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const RENEWAL_RETRY_BASE_MS = 6 * HOUR_MS;
const RENEWAL_RETRY_MAX_MS = DAY_MS;

/**
 * Delay before a certificate is eligible for another renewal attempt,
 * doubling from 6 hours per consecutive attempt up to 24 hours.
 */
export function getRenewalRetryDelayMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(RENEWAL_RETRY_BASE_MS * 2 ** exponent, RENEWAL_RETRY_MAX_MS);
}

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
        (cert.expiresAt.getTime() - Date.now()) / DAY_MS
      );

      if (daysUntilExpiry > cert.renewBeforeDays) {
        console.log(
          `[CertRenewal] Certificate for ${hostname} not due for renewal (${daysUntilExpiry} days left)`
        );

        await db
          .update(certificates)
          .set({
            nextRenewalCheck: new Date(cert.expiresAt.getTime() - cert.renewBeforeDays * DAY_MS),
            updatedAt: new Date(),
          })
          .where(eq(certificates.id, certificateId));

        return {
          success: true,
          certificateId,
        };
      }
    }

    // Record the attempt and push the next check out so a failing renewal is
    // retried with backoff instead of on every scheduled check. A successful
    // issue overwrites nextRenewalCheck based on the new expiry. The status is
    // left unchanged so HAProxy keeps serving the current certificate.
    const attempt = (cert.renewalAttempts || 0) + 1;
    const now = new Date();
    await db
      .update(certificates)
      .set({
        lastRenewalAttempt: now,
        renewalAttempts: attempt,
        nextRenewalCheck: new Date(now.getTime() + getRenewalRetryDelayMs(attempt)),
        updatedAt: now,
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
        isRenewal: true,
      },
      {
        ...getQueueConfig(QUEUES.CERTIFICATE_ISSUE),
        jobId: `cert-renew-issue-${certificateId}-${Date.now()}`,
      }
    );

    console.log(`[CertRenewal] Renewal queued for ${hostname} (attempt ${attempt})`);

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
 * Queue renewal jobs for every auto-renewing active certificate whose next
 * renewal check is due, including certificates that have already expired.
 * Returns the number of renewal jobs queued.
 */
export async function checkCertificatesForRenewal(): Promise<number> {
  console.log("[CertRenewal] Checking certificates for renewal...");

  const now = new Date();

  const dueForRenewal = await db.query.certificates.findMany({
    where: and(
      eq(certificates.autoRenew, true),
      eq(certificates.status, "active"),
      lte(certificates.nextRenewalCheck, now)
    ),
  });

  console.log(`[CertRenewal] Found ${dueForRenewal.length} certificates due for renewal`);

  if (dueForRenewal.length === 0) {
    return 0;
  }

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
      {
        ...getQueueConfig(QUEUES.CERTIFICATE_RENEWAL),
        jobId: `cert-renewal-${cert.id}-${now.getTime()}`,
      }
    );
  }

  return dueForRenewal.length;
}

/**
 * Recurring job processor for the certificate renewal scan
 */
export async function processCertificateRenewalCheck(
  job: Job<CertificateRenewalCheckJobData>
): Promise<CertificateRenewalCheckResult> {
  console.log(`[CertRenewal] Running scheduled renewal check (job ${job.id})`);

  const queued = await checkCertificatesForRenewal();

  return {
    success: true,
    queued,
  };
}
