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

    // Strip wildcard prefix for DNS challenge - ACME requires challenge at base domain
    const challengeHostname = hostname.startsWith("*.") ? hostname.substring(2) : hostname;
    const recordName = `_acme-challenge.${challengeHostname}`;

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
      const verified = await verifyDnsPropagation(recordName, challengeToken);

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

/**
 * Find the Cloudflare zone for a hostname by trying progressively shorter domain segments.
 * This handles multi-part TLDs like .co.uk, .com.au, etc.
 *
 * For "sub.example.co.uk", we try:
 * 1. sub.example.co.uk (unlikely to be a zone)
 * 2. example.co.uk (likely the zone)
 * 3. co.uk (not a zone we'd own)
 *
 * We stop at the first match since Cloudflare zones are registered at the apex domain level.
 */
async function findCloudflareZone(
  hostname: string,
  headers: Record<string, string>
): Promise<{ zoneId: string | null; zoneName: string | null }> {
  // Strip wildcard prefix if present
  const cleanHostname = hostname.startsWith("*.") ? hostname.substring(2) : hostname;
  const parts = cleanHostname.split(".");

  // Try from most specific to least specific (but need at least 2 parts for a valid domain)
  // Start from index 0 and work up, e.g., for a.b.c.co.uk: a.b.c.co.uk, b.c.co.uk, c.co.uk, co.uk
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
      // Continue to next candidate on network errors
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
  // For "sub.example.co.uk", we try: sub.example.co.uk, example.co.uk, co.uk
  const { zoneId, zoneName } = await findCloudflareZone(hostname, headers);

  if (!zoneId) {
    throw new Error(`Zone not found for ${hostname} (tried all parent domains)`);
  }

  console.log(`[Cloudflare] Using zone ${zoneName} (${zoneId}) for ${hostname}`);

  if (action === "set") {
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
          ttl: 120,
        }),
      }
    );

    if (!createResponse.ok) {
      const error = await createResponse.text();
      throw new Error(`Failed to create DNS record: ${error}`);
    }

    console.log(`[Cloudflare] Created TXT record for ${recordName}`);
  } else {
    // Find and delete TXT record
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

    console.log(`[Cloudflare] Deleted TXT record for ${recordName}`);
  }
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
