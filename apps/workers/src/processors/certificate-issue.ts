import { type Job, Queue } from "bullmq";
import { type CertificateIssueJobData, type CertificateResult, QUEUES, type HaproxyReloadJobData } from "@uni-proxy-manager/queue";
import { db } from "@uni-proxy-manager/database";
import { certificates, dnsProviders, domains } from "@uni-proxy-manager/database/schema";
import { eq } from "drizzle-orm";
import { getAcmeConfig, getCertsDir } from "@uni-proxy-manager/shared/config";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import { mkdir, writeFile, readFile } from "fs/promises";
import { join } from "path";
import * as acme from "acme-client";
import type {
  CloudflareCredentials,
  NamecheapCredentials,
} from "@uni-proxy-manager/database/schema";

const ACME_ACCOUNT_KEY_PATH = "/data/acme/account.key";

// Check if we're using Pebble test server (auto-validates all challenges)
function isUsingPebble(): boolean {
  const directoryUrl = process.env.ACME_DIRECTORY_URL || "";
  return directoryUrl.includes("pebble") || directoryUrl.includes(":14000");
}

export async function processCertificateIssue(
  job: Job<CertificateIssueJobData>
): Promise<CertificateResult> {
  const { certificateId, domainId, hostname, altNames, dnsProviderId, acmeEmail, staging } = job.data;

  console.log(`[CertIssue] Processing certificate for ${hostname} (staging: ${staging})`);

  try {
    // Update certificate status to issuing
    await db
      .update(certificates)
      .set({ status: "issuing", updatedAt: new Date() })
      .where(eq(certificates.id, certificateId));

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

    // Get authorizations
    const authorizations = await client.getAuthorizations(order);

    // Process each authorization with DNS-01 challenge
    const usingPebble = isUsingPebble();

    for (const authz of authorizations) {
      const challenge = authz.challenges.find((c) => c.type === "dns-01");

      if (!challenge) {
        throw new Error(`No DNS-01 challenge found for ${authz.identifier.value}`);
      }

      const keyAuthorization = await client.getChallengeKeyAuthorization(challenge);

      console.log(`[CertIssue] Setting DNS challenge for ${authz.identifier.value}`);

      // Skip actual DNS operations when using Pebble (it auto-validates)
      if (!usingPebble) {
        // Set DNS TXT record via provider
        await setDnsChallenge(provider, authz.identifier.value, keyAuthorization);

        // Wait for DNS propagation
        await waitForDnsPropagation(`_acme-challenge.${authz.identifier.value}`, keyAuthorization);
      } else {
        console.log(`[CertIssue] Using Pebble - skipping DNS operations (auto-validated)`);
      }

      // Notify ACME server challenge is ready
      await client.completeChallenge(challenge);

      // Wait for challenge to be validated
      await client.waitForValidStatus(challenge);

      console.log(`[CertIssue] Challenge validated for ${authz.identifier.value}`);

      // Clean up DNS record
      if (!usingPebble) {
        await clearDnsChallenge(provider, authz.identifier.value);
      }
    }

    // Finalize order and get certificate
    await client.finalizeOrder(order, certificateCsr);
    const certificate = await client.getCertificate(order);

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
        { jobId: `haproxy-reload-cert-${certificateId}` }
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

    // Update certificate with error
    await db
      .update(certificates)
      .set({
        status: "failed",
        lastError: errorMessage,
        renewalAttempts: (job.attemptsMade || 0) + 1,
        updatedAt: new Date(),
      })
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

async function setDnsChallenge(
  provider: { type: string; credentials: unknown },
  hostname: string,
  token: string
): Promise<void> {
  // Strip wildcard prefix for DNS challenge - ACME requires challenge at base domain
  const challengeHostname = hostname.startsWith("*.") ? hostname.substring(2) : hostname;
  const recordName = `_acme-challenge.${challengeHostname}`;

  if (provider.type === "cloudflare") {
    await handleCloudflareChallenge(
      provider.credentials as CloudflareCredentials,
      hostname,
      recordName,
      token,
      "set"
    );
  } else if (provider.type === "namecheap") {
    throw new Error("Namecheap DNS challenge not yet implemented");
  } else {
    throw new Error(`Unsupported DNS provider type: ${provider.type}`);
  }
}

async function clearDnsChallenge(
  provider: { type: string; credentials: unknown },
  hostname: string
): Promise<void> {
  // Strip wildcard prefix for DNS challenge - ACME requires challenge at base domain
  const challengeHostname = hostname.startsWith("*.") ? hostname.substring(2) : hostname;
  const recordName = `_acme-challenge.${challengeHostname}`;

  if (provider.type === "cloudflare") {
    await handleCloudflareChallenge(
      provider.credentials as CloudflareCredentials,
      hostname,
      recordName,
      "",
      "clear"
    );
  }
  // Silently skip for other providers
}

/**
 * Find the Cloudflare zone for a hostname by trying progressively shorter domain segments.
 * This handles multi-part TLDs like .co.uk, .com.au, etc.
 */
async function findCloudflareZone(
  hostname: string,
  headers: Record<string, string>
): Promise<{ zoneId: string | null; zoneName: string | null }> {
  // Strip wildcard prefix if present
  const cleanHostname = hostname.startsWith("*.") ? hostname.substring(2) : hostname;
  const parts = cleanHostname.split(".");

  // Try from most specific to least specific (but need at least 2 parts for a valid domain)
  for (let i = 0; i < parts.length - 1; i++) {
    const candidateZone = parts.slice(i).join(".");

    try {
      const zonesResponse = await fetch(
        `https://api.cloudflare.com/client/v4/zones?name=${candidateZone}`,
        { headers }
      );

      const zonesData = (await zonesResponse.json()) as {
        result: Array<{ id: string; name: string }>;
        success: boolean;
      };

      if (zonesData.success && zonesData.result?.[0]?.id) {
        return {
          zoneId: zonesData.result[0].id,
          zoneName: zonesData.result[0].name,
        };
      }
    } catch (error) {
      console.warn(`[Cloudflare] Failed to check zone ${candidateZone}:`, error);
    }
  }

  return { zoneId: null, zoneName: null };
}

async function handleCloudflareChallenge(
  credentials: CloudflareCredentials,
  hostname: string,
  recordName: string,
  token: string,
  action: "set" | "clear"
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (credentials.apiToken) {
    headers["Authorization"] = `Bearer ${credentials.apiToken}`;
  } else if (credentials.email && credentials.apiKey) {
    headers["X-Auth-Email"] = credentials.email;
    headers["X-Auth-Key"] = credentials.apiKey;
  } else {
    throw new Error("Invalid Cloudflare credentials");
  }

  // Find the zone by trying progressively shorter domain segments
  // This handles multi-part TLDs like .co.uk, .com.au, etc.
  const { zoneId, zoneName } = await findCloudflareZone(hostname, headers);

  if (!zoneId) {
    throw new Error(`Zone not found for ${hostname} (tried all parent domains)`);
  }

  console.log(`[Cloudflare] Using zone ${zoneName} (${zoneId}) for ${hostname}`);

  if (action === "set") {
    // First, clear any existing records
    await deleteExistingRecords(headers, zoneId, recordName);

    // Create TXT record
    const createResponse = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "TXT",
          name: recordName,
          content: token,
          ttl: 60,
        }),
      }
    );

    if (!createResponse.ok) {
      const error = await createResponse.text();
      throw new Error(`Failed to create DNS record: ${error}`);
    }

    console.log(`[Cloudflare] Created TXT record for ${recordName}`);
  } else {
    await deleteExistingRecords(headers, zoneId, recordName);
    console.log(`[Cloudflare] Deleted TXT record for ${recordName}`);
  }
}

async function deleteExistingRecords(
  headers: Record<string, string>,
  zoneId: string,
  recordName: string
): Promise<void> {
  const recordsResponse = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=TXT&name=${recordName}`,
    { headers }
  );

  const recordsData = await recordsResponse.json() as { result: Array<{ id: string }> };

  for (const record of recordsData.result || []) {
    await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${record.id}`,
      {
        method: "DELETE",
        headers,
      }
    );
  }
}

async function waitForDnsPropagation(
  recordName: string,
  expectedValue: string,
  maxAttempts = 30,
  delayMs = 5000
): Promise<void> {
  console.log(`[CertIssue] Waiting for DNS propagation of ${recordName}...`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const verified = await verifyDnsPropagation(recordName, expectedValue);

    if (verified) {
      console.log(`[CertIssue] DNS propagation verified after ${attempt} attempts`);
      return;
    }

    console.log(`[CertIssue] DNS not propagated yet (attempt ${attempt}/${maxAttempts})`);
    await sleep(delayMs);
  }

  throw new Error(`DNS propagation timeout for ${recordName}`);
}

async function verifyDnsPropagation(
  recordName: string,
  expectedValue: string
): Promise<boolean> {
  try {
    // Use Cloudflare DNS-over-HTTPS for verification
    const response = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${recordName}&type=TXT`,
      {
        headers: {
          Accept: "application/dns-json",
        },
      }
    );

    const data = await response.json() as {
      Answer?: Array<{ data: string }>;
    };

    if (!data.Answer) {
      return false;
    }

    // Check if any TXT record matches
    return data.Answer.some(
      (record) => record.data.replace(/"/g, "") === expectedValue
    );
  } catch (error) {
    console.error("[DNS Verification] Error:", error);
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
