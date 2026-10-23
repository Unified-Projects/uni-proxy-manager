import { type Job, Queue } from "bullmq";
import { type CertificateIssueJobData, type CertificateResult, QUEUES, getQueueConfig, type HaproxyReloadJobData } from "@uni-proxy-manager/queue";
import { db } from "@uni-proxy-manager/database";
import { certificates, dnsProviders, domains } from "@uni-proxy-manager/database/schema";
import { eq } from "drizzle-orm";
import { getAcmeConfig, getCertsDir } from "@uni-proxy-manager/shared/config";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { mkdir, writeFile, readFile } from "fs/promises";
import { join } from "path";
import * as acme from "acme-client";
import {
  createCloudflareChallengeRecord,
  deleteCloudflareChallengeRecord,
  waitForDnsPropagation,
  type DnsChallengeRecord,
} from "../lib/dns-01";

const ACME_ACCOUNT_KEY_PATH = "/data/acme/account.key";

type DnsProvider = typeof dnsProviders.$inferSelect;
type AcmeChallenge = acme.Authorization["challenges"][number];

interface PendingChallenge {
  identifier: string;
  challenge: AcmeChallenge;
  keyAuthorization: string;
}

// Check if we're using Pebble test server (auto-validates all challenges)
function isUsingPebble(): boolean {
  const directoryUrl = process.env.ACME_DIRECTORY_URL || "";
  return directoryUrl.includes("pebble") || directoryUrl.includes(":14000");
}

export async function processCertificateIssue(
  job: Job<CertificateIssueJobData>
): Promise<CertificateResult> {
  const { certificateId, domainId, hostname, altNames, dnsProviderId, acmeEmail, staging, isRenewal } = job.data;

  console.log(`[CertIssue] Processing certificate for ${hostname} (staging: ${staging}, renewal: ${Boolean(isRenewal)})`);

  try {
    // A renewal keeps the current certificate active so HAProxy continues to serve it
    if (!isRenewal) {
      await db
        .update(certificates)
        .set({ status: "issuing", updatedAt: new Date() })
        .where(eq(certificates.id, certificateId));
    }

    // Get DNS provider credentials
    const provider = await db.query.dnsProviders.findFirst({
      where: eq(dnsProviders.id, dnsProviderId),
    });

    if (!provider) {
      throw new Error("DNS provider not found");
    }

    // Setup certificate directory
    const certsDir = getCertsDir();
    const certDir = join(certsDir, domainId);
    await mkdir(certDir, { recursive: true });

    const certPath = join(certDir, "cert.pem");
    const keyPath = join(certDir, "key.pem");
    const chainPath = join(certDir, "chain.pem");
    const fullchainPath = join(certDir, "fullchain.pem");
    const haproxyPemPath = join(certsDir, `${domainId}.pem`);

    // Get or create ACME account key
    const accountKey = await getOrCreateAccountKey();

    // Create ACME client
    // Use custom directory URL if provided (e.g., Pebble for testing)
    const customDirectoryUrl = process.env.ACME_DIRECTORY_URL;
    const directoryUrl = customDirectoryUrl || (staging
      ? acme.directory.letsencrypt.staging
      : acme.directory.letsencrypt.production);

    const client = new acme.Client({
      directoryUrl,
      accountKey,
    });

    // Register account (will reuse existing if already registered)
    const account = await client.createAccount({
      termsOfServiceAgreed: true,
      contact: acmeEmail ? [`mailto:${acmeEmail}`] : [],
    });

    console.log(`[CertIssue] Using ACME account: ${account.status}`);

    // Create certificate private key
    const [certificateKey, certificateCsr] = await acme.crypto.createCsr({
      commonName: hostname,
      altNames: altNames || [],
    });

    // Create order
    const order = await client.createOrder({
      identifiers: [
        { type: "dns", value: hostname },
        ...(altNames || []).map((name) => ({ type: "dns" as const, value: name })),
      ],
    });

    console.log(`[CertIssue] Created order for ${hostname}`);

    const authorizations = await client.getAuthorizations(order);
    const usingPebble = isUsingPebble();

    const pendingChallenges: PendingChallenge[] = [];
    for (const authz of authorizations) {
      const challenge = authz.challenges.find((c) => c.type === "dns-01");

      if (!challenge) {
        throw new Error(`No DNS-01 challenge found for ${authz.identifier.value}`);
      }

      pendingChallenges.push({
        identifier: authz.wildcard ? `*.${authz.identifier.value}` : authz.identifier.value,
        challenge,
        keyAuthorization: await client.getChallengeKeyAuthorization(challenge),
      });
    }

    // Every TXT record for the order is published before any challenge is
    // completed, because an apex and its wildcard share one record name.
    const challengeRecords: DnsChallengeRecord[] = [];
    let certificate: string;

    try {
      if (usingPebble) {
        console.log(`[CertIssue] Using Pebble - skipping DNS operations (auto-validated)`);
      } else {
        for (const { identifier, keyAuthorization } of pendingChallenges) {
          console.log(`[CertIssue] Setting DNS challenge for ${identifier}`);
          challengeRecords.push(await createChallengeRecord(provider, identifier, keyAuthorization));
        }

        await waitForDnsPropagation(challengeRecords, getAcmeConfig().dnsPropagation);
      }

      for (const { identifier, challenge } of pendingChallenges) {
        await completeChallenge(client, challenge, identifier);
      }

      for (const { identifier, challenge } of pendingChallenges) {
        await client.waitForValidStatus(challenge);
        console.log(`[CertIssue] Challenge validated for ${identifier}`);
      }

      // Finalize order and wait for a valid, certificate-ready order resource.
      let finalizedOrder = await client.finalizeOrder(order, certificateCsr);
      finalizedOrder = await client.waitForValidStatus(finalizedOrder);
      certificate = await client.getCertificate(finalizedOrder);
    } finally {
      await removeChallengeRecords(provider, challengeRecords);
    }

    // Split certificate chain
    const certs = certificate.split(/(?=-----BEGIN CERTIFICATE-----)/);
    const cert = certs[0] || "";
    const chain = certs.slice(1).join("");

    // Write certificate files
    const keyContent = certificateKey.toString();
    await writeFile(certPath, cert);
    await writeFile(keyPath, keyContent);
    await writeFile(chainPath, chain);
    await writeFile(fullchainPath, certificate);
    await writeFile(haproxyPemPath, `${keyContent}\n${certificate}`);

    console.log(`[CertIssue] Certificate files written to ${certDir}`);

    // Calculate expiry (90 days for Let's Encrypt)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);

    // Update certificate record
    await db
      .update(certificates)
      .set({
        status: "active",
        source: staging ? "letsencrypt" : "letsencrypt",
        issuer: staging ? "Let's Encrypt (Staging)" : "Let's Encrypt",
        certPath,
        keyPath,
        chainPath,
        fullchainPath,
        issuedAt: new Date(),
        expiresAt,
        nextRenewalCheck: new Date(expiresAt.getTime() - 30 * 24 * 60 * 60 * 1000),
        renewalAttempts: 0,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(certificates.id, certificateId));

    // Link certificate to domain
    await db
      .update(domains)
      .set({
        certificateId,
        updatedAt: new Date(),
      })
      .where(eq(domains.id, domainId));

    console.log(`[CertIssue] Certificate issued and linked for ${hostname}`);

    // Queue HAProxy reload to pick up the new certificate
    try {
      const redis = getRedisClient();
      const reloadQueue = new Queue<HaproxyReloadJobData>(QUEUES.HAPROXY_RELOAD, {
        connection: redis,
      });
      await reloadQueue.add(
        `reload-cert-${certificateId}`,
        {
          reason: `Certificate issued for ${hostname}`,
          triggeredBy: "certificate",
          affectedDomainIds: [domainId],
        },
        {
          ...getQueueConfig(QUEUES.HAPROXY_RELOAD),
          jobId: `haproxy-reload-cert-${certificateId}-${Date.now()}`,
        }
      );
      console.log(`[CertIssue] Queued HAProxy reload for certificate ${certificateId}`);
    } catch (reloadError) {
      console.warn("[CertIssue] Failed to queue HAProxy reload:", reloadError);
      // Don't fail the certificate issuance if reload fails
    }

    return {
      success: true,
      certificateId,
      certPath,
      keyPath,
      fullchainPath,
      expiresAt,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // A failed renewal leaves the existing certificate active; the renewal
    // processor has already recorded the attempt and scheduled the retry.
    await db
      .update(certificates)
      .set(
        isRenewal
          ? { lastError: errorMessage, updatedAt: new Date() }
          : {
              status: "failed",
              lastError: errorMessage,
              renewalAttempts: (job.attemptsMade || 0) + 1,
              updatedAt: new Date(),
            }
      )
      .where(eq(certificates.id, certificateId));

    console.error(`[CertIssue] Failed to issue certificate for ${hostname}:`, errorMessage);

    return {
      success: false,
      certificateId,
      error: errorMessage,
    };
  }
}

async function getOrCreateAccountKey(): Promise<Buffer> {
  const accountDir = "/data/acme";

  try {
    // Try to read existing account key
    const existingKey = await readFile(ACME_ACCOUNT_KEY_PATH);
    console.log("[CertIssue] Using existing ACME account key");
    return existingKey;
  } catch {
    // Create new account key
    console.log("[CertIssue] Creating new ACME account key");
    await mkdir(accountDir, { recursive: true });
    const accountKey = await acme.crypto.createPrivateKey();
    await writeFile(ACME_ACCOUNT_KEY_PATH, accountKey);
    return accountKey;
  }
}

async function completeChallenge(
  client: acme.Client,
  challenge: AcmeChallenge,
  identifier: string
): Promise<void> {
  // Pebble can auto-validate quickly, especially with SAN orders.
  // Skip completing already-valid challenges and tolerate valid-race errors.
  if (challenge.status === "valid") {
    console.log(`[CertIssue] Challenge already valid for ${identifier}`);
    return;
  }

  try {
    await client.completeChallenge(challenge);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("status valid")) {
      throw error;
    }
    console.log(`[CertIssue] Challenge became valid before completion for ${identifier}`);
  }
}

async function createChallengeRecord(
  provider: DnsProvider,
  identifier: string,
  value: string
): Promise<DnsChallengeRecord> {
  if (provider.type === "cloudflare") {
    return createCloudflareChallengeRecord(provider.credentials, identifier, value);
  }

  if (provider.type === "namecheap") {
    throw new Error("Namecheap DNS challenge not yet implemented");
  }

  throw new Error(`Unsupported DNS provider type: ${provider.type}`);
}

/**
 * Deletes the records created for this order by id. A failed deletion is
 * logged and does not change the outcome of the order.
 */
async function removeChallengeRecords(
  provider: DnsProvider,
  records: readonly DnsChallengeRecord[]
): Promise<void> {
  if (provider.type !== "cloudflare") {
    return;
  }

  for (const record of records) {
    try {
      await deleteCloudflareChallengeRecord(provider.credentials, record);
    } catch (error) {
      console.warn(
        `[CertIssue] Failed to delete TXT record ${record.recordId} for ${record.recordName}:`,
        error
      );
    }
  }
}
