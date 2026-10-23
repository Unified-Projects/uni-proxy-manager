import type { Job } from "bullmq";
import type { DnsChallengeJobData, DnsChallengeResult } from "@uni-proxy-manager/queue";
import { db } from "@uni-proxy-manager/database";
import { dnsProviders } from "@uni-proxy-manager/database/schema";
import { eq } from "drizzle-orm";
import type {
  CloudflareCredentials,
  NamecheapCredentials,
} from "@uni-proxy-manager/database/schema";
import { buildNamecheapParams } from "../lib/namecheap";
import {
  createCloudflareChallengeRecord,
  deleteCloudflareChallengeRecordsByValue,
  getChallengeRecordName,
  txtRecordSetContains,
} from "../lib/dns-01";

export async function processDnsChallenge(
  job: Job<DnsChallengeJobData>
): Promise<DnsChallengeResult> {
  const { certificateId, hostname, dnsProviderId, challengeToken, action } = job.data;

  console.log(`[DNS Challenge] ${action} TXT record for ${hostname}`);

  try {
    // Get DNS provider
    const provider = await db.query.dnsProviders.findFirst({
      where: eq(dnsProviders.id, dnsProviderId),
    });

    if (!provider) {
      throw new Error("DNS provider not found");
    }

    const recordName = getChallengeRecordName(hostname);

    if (provider.type === "cloudflare") {
      await handleCloudflareChallenge(
        provider.credentials as CloudflareCredentials,
        hostname,
        recordName,
        challengeToken,
        action
      );
    } else if (provider.type === "namecheap") {
      await handleNamecheapChallenge(
        provider.credentials as NamecheapCredentials,
        hostname,
        recordName,
        challengeToken,
        action
      );
    } else {
      throw new Error(`Unsupported DNS provider type: ${provider.type}`);
    }

    // If setting, verify propagation
    if (action === "set") {
      const verified = await txtRecordSetContains(recordName, [challengeToken]);

      if (!verified) {
        // Requeue for retry
        const attempts = (job.data.verificationAttempts || 0) + 1;

        if (attempts < 10) {
          throw new Error(`DNS propagation not complete (attempt ${attempts})`);
        }
      }

      return {
        success: true,
        hostname,
        action,
        verified,
      };
    }

    return {
      success: true,
      hostname,
      action,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[DNS Challenge] Failed for ${hostname}:`, errorMessage);

    return {
      success: false,
      hostname,
      action,
      error: errorMessage,
    };
  }
}

async function handleCloudflareChallenge(
  credentials: CloudflareCredentials,
  hostname: string,
  recordName: string,
  token: string,
  action: "set" | "clear"
): Promise<void> {
  if (action === "set") {
    await createCloudflareChallengeRecord(credentials, hostname, token);
    return;
  }

  // Only the record holding this token is removed, so challenges for other
  // identifiers at the same name keep their values.
  const deleted = await deleteCloudflareChallengeRecordsByValue(credentials, hostname, token);
  console.log(`[Cloudflare] Deleted ${deleted} TXT record(s) for ${recordName}`);
}

async function handleNamecheapChallenge(
  credentials: NamecheapCredentials,
  hostname: string,
  recordName: string,
  token: string,
  action: "set" | "clear"
): Promise<void> {
  const params = buildNamecheapParams(credentials, hostname, action);
  console.log(`[Namecheap] ${action} TXT record for ${recordName}`);
}
