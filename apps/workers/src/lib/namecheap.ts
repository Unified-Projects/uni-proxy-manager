import type { NamecheapCredentials } from "@uni-proxy-manager/database/schema";

export function buildNamecheapParams(
  credentials: NamecheapCredentials,
  hostname: string,
  action: "set" | "clear"
): URLSearchParams {
  const parts = hostname.split(".");
  const [sld, tld] = parts.slice(-2); // Second-level and top-level domains

  if (!sld || !tld) {
    throw new Error(`Invalid hostname for Namecheap: ${hostname}`);
  }

  return new URLSearchParams({
    ApiUser: credentials.apiUser,
    ApiKey: credentials.apiKey,
    UserName: credentials.username || credentials.apiUser,
    ClientIp: credentials.clientIp,
    Command: action === "set" ? "namecheap.domains.dns.setHosts" : "namecheap.domains.dns.getHosts",
    SLD: sld,
    TLD: tld,
  });
}
