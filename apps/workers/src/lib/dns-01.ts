import type { CloudflareCredentials } from "@uni-proxy-manager/database/schema";

const CLOUDFLARE_API_URL = "https://api.cloudflare.com/client/v4";
const DOH_RESOLVER_URL = "https://cloudflare-dns.com/dns-query";
const CHALLENGE_RECORD_TTL = 60;

/** A DNS-01 TXT record created for one ACME challenge. */
export interface DnsChallengeRecord {
  recordName: string;
  value: string;
  zoneId: string;
  recordId: string;
}

export interface DnsPropagationOptions {
  maxChecks: number;
  intervalMs: number;
}

interface CloudflareResponse<T> {
  success: boolean;
  result: T;
  errors?: Array<{ code: number; message: string }>;
}

interface CloudflareDnsRecord {
  id: string;
  name: string;
  content: string;
}

/**
 * Returns the `_acme-challenge` name for an ACME identifier. A wildcard
 * identifier is validated at its base domain.
 */
export function getChallengeRecordName(identifier: string): string {
  const baseDomain = identifier.startsWith("*.") ? identifier.substring(2) : identifier;
  return `_acme-challenge.${baseDomain}`;
}

/**
 * Converts the presentation form of TXT data (one or more quoted
 * character-strings) into the value they encode.
 */
export function parseTxtData(data: string): string {
  const segments = [...data.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) =>
    (match[1] ?? "").replace(/\\(.)/g, "$1")
  );
  return segments.length > 0 ? segments.join("") : data;
}

export function getCloudflareHeaders(credentials: CloudflareCredentials): Record<string, string> {
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

  return headers;
}

/**
 * Finds the Cloudflare zone for a hostname by trying progressively shorter
 * domain segments, which handles multi-part TLDs such as .co.uk.
 */
export async function findCloudflareZone(
  hostname: string,
  headers: Record<string, string>
): Promise<{ zoneId: string; zoneName: string } | null> {
  const cleanHostname = hostname.startsWith("*.") ? hostname.substring(2) : hostname;
  const parts = cleanHostname.split(".");

  for (let i = 0; i < parts.length - 1; i++) {
    const candidateZone = parts.slice(i).join(".");

    try {
      const response = await fetch(
        `${CLOUDFLARE_API_URL}/zones?name=${encodeURIComponent(candidateZone)}`,
        { headers }
      );
      const data = (await response.json()) as CloudflareResponse<Array<{ id: string; name: string }>>;
      const zone = data.success ? data.result?.[0] : undefined;

      if (zone?.id) {
        return { zoneId: zone.id, zoneName: zone.name };
      }
    } catch (error) {
      console.warn(`[Cloudflare] Failed to check zone ${candidateZone}:`, error);
    }
  }

  return null;
}

async function requireCloudflareZone(
  hostname: string,
  headers: Record<string, string>
): Promise<string> {
  const zone = await findCloudflareZone(hostname, headers);

  if (!zone) {
    throw new Error(`Zone not found for ${hostname} (tried all parent domains)`);
  }

  console.log(`[Cloudflare] Using zone ${zone.zoneName} (${zone.zoneId}) for ${hostname}`);
  return zone.zoneId;
}

/**
 * Adds a TXT record for a DNS-01 challenge. Existing TXT records at the same
 * name are left in place, since another challenge may still need them.
 */
export async function createCloudflareChallengeRecord(
  credentials: CloudflareCredentials,
  identifier: string,
  value: string
): Promise<DnsChallengeRecord> {
  const headers = getCloudflareHeaders(credentials);
  const zoneId = await requireCloudflareZone(identifier, headers);
  const recordName = getChallengeRecordName(identifier);

  const response = await fetch(`${CLOUDFLARE_API_URL}/zones/${zoneId}/dns_records`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      type: "TXT",
      name: recordName,
      content: value,
      ttl: CHALLENGE_RECORD_TTL,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create DNS record: ${error}`);
  }

  const data = (await response.json()) as CloudflareResponse<CloudflareDnsRecord>;

  if (!data.success || !data.result?.id) {
    const messages = (data.errors ?? []).map((error) => error.message).join(", ");
    throw new Error(`Failed to create DNS record: ${messages || "no record id returned"}`);
  }

  console.log(`[Cloudflare] Created TXT record ${data.result.id} for ${recordName}`);

  return { recordName, value, zoneId, recordId: data.result.id };
}

export async function deleteCloudflareChallengeRecord(
  credentials: CloudflareCredentials,
  record: DnsChallengeRecord
): Promise<void> {
  const headers = getCloudflareHeaders(credentials);
  const response = await fetch(
    `${CLOUDFLARE_API_URL}/zones/${record.zoneId}/dns_records/${record.recordId}`,
    { method: "DELETE", headers }
  );

  if (!response.ok && response.status !== 404) {
    const error = await response.text();
    throw new Error(`Failed to delete DNS record ${record.recordId}: ${error}`);
  }

  console.log(`[Cloudflare] Deleted TXT record ${record.recordId} for ${record.recordName}`);
}

/**
 * Deletes the TXT records at a challenge name whose value matches `value`,
 * leaving records for other challenges in place. Returns the number deleted.
 */
export async function deleteCloudflareChallengeRecordsByValue(
  credentials: CloudflareCredentials,
  identifier: string,
  value: string
): Promise<number> {
  const headers = getCloudflareHeaders(credentials);
  const zoneId = await requireCloudflareZone(identifier, headers);
  const recordName = getChallengeRecordName(identifier);

  const response = await fetch(
    `${CLOUDFLARE_API_URL}/zones/${zoneId}/dns_records?type=TXT&name=${encodeURIComponent(recordName)}`,
    { headers }
  );
  const data = (await response.json()) as CloudflareResponse<CloudflareDnsRecord[]>;
  const matching = (data.result ?? []).filter((record) => parseTxtData(record.content) === value);

  for (const record of matching) {
    await deleteCloudflareChallengeRecord(credentials, {
      recordName,
      value,
      zoneId,
      recordId: record.id,
    });
  }

  return matching.length;
}

/**
 * Checks whether the public TXT RRset at `recordName` contains every value
 * in `expectedValues`. Other values in the RRset are ignored.
 */
export async function txtRecordSetContains(
  recordName: string,
  expectedValues: readonly string[]
): Promise<boolean> {
  try {
    const response = await fetch(
      `${DOH_RESOLVER_URL}?name=${encodeURIComponent(recordName)}&type=TXT`,
      { headers: { Accept: "application/dns-json" } }
    );
    const data = (await response.json()) as { Answer?: Array<{ data: string }> };

    if (!data.Answer) {
      return false;
    }

    const published = new Set(data.Answer.map((answer) => parseTxtData(answer.data)));
    return expectedValues.every((value) => published.has(value));
  } catch (error) {
    console.error("[DNS Verification] Error:", error);
    return false;
  }
}

/**
 * Waits until every challenge value is visible in public DNS. Values sharing
 * a record name, such as an apex and its wildcard, are checked together.
 */
export async function waitForDnsPropagation(
  records: ReadonlyArray<Pick<DnsChallengeRecord, "recordName" | "value">>,
  { maxChecks, intervalMs }: DnsPropagationOptions
): Promise<void> {
  const pending = new Map<string, string[]>();
  for (const { recordName, value } of records) {
    const values = pending.get(recordName) ?? [];
    if (!values.includes(value)) {
      values.push(value);
    }
    pending.set(recordName, values);
  }

  if (pending.size === 0) {
    return;
  }

  console.log(`[DNS Propagation] Waiting for ${[...pending.keys()].join(", ")}`);

  for (let check = 1; check <= maxChecks; check++) {
    for (const [recordName, values] of pending) {
      if (await txtRecordSetContains(recordName, values)) {
        console.log(
          `[DNS Propagation] ${recordName} has all ${values.length} value(s) after check ${check}/${maxChecks}`
        );
        pending.delete(recordName);
      }
    }

    if (pending.size === 0) {
      return;
    }

    if (check < maxChecks) {
      console.log(`[DNS Propagation] Not visible yet (check ${check}/${maxChecks})`);
      await sleep(intervalMs);
    }
  }

  throw new Error(`DNS propagation timeout for ${[...pending.keys()].join(", ")}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
