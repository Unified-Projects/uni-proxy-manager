import type {
  HAProxyConfig,
  HAProxyGlobalConfig,
  HAProxyDefaultsConfig,
  HAProxyFrontend,
  HAProxyBackend,
  HAProxyUseBackend,
  HAProxyClusterPeer,
  DomainConfig,
  BackendConfig,
  SiteConfig,
  SitesExecutorConfig,
  PomeriumConfig,
  PomeriumRouteConfig,
  DomainRouteRuleConfig,
  DomainIpAccessConfig,
  DomainSecurityHeadersConfig,
  DomainBlockedRouteConfig,
  AnalyticsRouteConfig,
  AnalyticsBackendConfig,
  AnalyticsConfig,
} from "./types";
import { getStatsConfig } from "../config/env";
import { generateHAProxyBotPattern } from "../utils/bot-detection";

/**
 * Default global configuration
 */
export function getDefaultGlobalConfig(): HAProxyGlobalConfig {
  return {
    maxConnections: 4096,
    logFormat: "raw",
    statsSocket: "/var/run/haproxy/haproxy.sock mode 666 level admin",
  };
}

/**
 * Default defaults configuration
 */
export function getDefaultDefaultsConfig(): HAProxyDefaultsConfig {
  return {
    mode: "http",
    connectTimeout: "5s",
    clientTimeout: "50s",
    serverTimeout: "50s",
    httpKeepAlive: true,
    logFormat:
      '{"ts":%Ts,"fe":"%ft","host":"%[capture.req.hdr(0)]","path":"%HP","st":%ST,"bo":%B,"bi":%U,"tr":%Tr,"ci":"%ci","ua":%{+Q}[capture.req.hdr(1)]}',
  };
}

/**
 * Sanitize a string for use as an HAProxy identifier
 */
export function sanitizeIdentifier(str: string): string {
  return str.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}

/**
 * Generate the resolvers section for Docker DNS
 * Required for backends using init-addr none (e.g. pomerium_backend)
 */
function renderResolvers(): string {
  return [
    "resolvers docker",
    "    nameserver dns1 127.0.0.11:53",
    "    resolve_retries 3",
    "    timeout resolve 1s",
    "    timeout retry 1s",
    "    hold nx 10s",
    "    hold valid 10s",
  ].join("\n") + "\n";
}

/**
 * Generate the global section
 */
function renderGlobal(config: HAProxyGlobalConfig): string {
  const lines = [
    "global",
    `    log stdout format ${config.logFormat} local0`,
    `    maxconn ${config.maxConnections}`,
    `    stats socket ${config.statsSocket}`,
  ];

  return lines.join("\n") + "\n";
}

/**
 * Generate the stats frontend section with optional authentication
 */
function renderStatsFrontend(): string {
  const statsConfig = getStatsConfig();
  const lines = [
    "frontend stats",
    "    bind *:8404",
    "    mode http",
    "    stats enable",
    "    stats uri /stats",
    "    stats refresh 10s",
  ];

  // Add authentication if password is configured
  if (statsConfig.password) {
    lines.push(`    stats auth ${statsConfig.user}:${statsConfig.password}`);
    lines.push("    stats admin if TRUE");
  } else {
    // Without auth, only allow admin from localhost for safety
    lines.push("    acl is_localhost src 127.0.0.1");
    lines.push("    stats admin if is_localhost");
    // Log warning about unprotected stats
    console.warn("[HAProxy] Stats page has no authentication configured. Set UNI_PROXY_MANAGER_STATS_PASSWORD for production.");
  }

  return lines.join("\n") + "\n";
}

/**
 * Generate the defaults section
 */
function renderDefaults(config: HAProxyDefaultsConfig): string {
  const lines = [
    "defaults",
    "    log global",
    `    mode ${config.mode}`,
    "    option httplog",
    "    option dontlognull",
    "    option forwardfor",
    `    timeout connect ${config.connectTimeout}`,
    `    timeout client ${config.clientTimeout}`,
    `    timeout server ${config.serverTimeout}`,
  ];

  if (config.httpKeepAlive) {
    lines.push("    option http-keep-alive");
  }

  // Add custom log format for structured logging
  // IMPORTANT: Single quotes are required around the log-format value to preserve
  // double quotes in the JSON output. Without them, HAProxy strips the quotes
  // and produces invalid JSON like {ts:123,fe:name} instead of {"ts":123,"fe":"name"}
  if (config.logFormat) {
    lines.push(`    log-format '${config.logFormat}'`);
  }

  return lines.join("\n") + "\n";
}

/**
 * Generate a frontend section
 */
function renderFrontend(frontend: HAProxyFrontend): string {
  const lines = [`frontend ${frontend.name}`, `    mode ${frontend.mode}`];

  // Binds
  for (const bind of frontend.binds) {
    let bindLine = `    bind ${bind.address}:${bind.port}`;
    if (bind.ssl && bind.certPath) {
      bindLine += ` ssl crt ${bind.certPath}`;
    }
    lines.push(bindLine);
  }

  // ACLs
  for (const acl of frontend.acls) {
    lines.push(`    acl ${acl.name} ${acl.condition}`);
  }

  // Capture rules (before ACLs and request rules)
  if (frontend.captures) {
    for (const capture of frontend.captures) {
      lines.push(`    capture ${capture}`);
    }
  }

  // HTTP request rules
  if (frontend.httpRequestRules) {
    for (const rule of frontend.httpRequestRules) {
      lines.push(`    http-request ${rule}`);
    }
  }

  // Use backends
  for (const useBackend of frontend.useBackends) {
    if (useBackend.condition) {
      lines.push(`    use_backend ${useBackend.backendName} if ${useBackend.condition}`);
    } else {
      lines.push(`    use_backend ${useBackend.backendName}`);
    }
  }

  // Default backend
  lines.push(`    default_backend ${frontend.defaultBackend}`);

  // HTTP response rules
  if (frontend.httpResponseRules) {
    for (const rule of frontend.httpResponseRules) {
      lines.push(`    http-response ${rule}`);
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Generate a backend section
 */
function renderBackend(backend: HAProxyBackend): string {
  const lines = [
    `backend ${backend.name}`,
    `    mode ${backend.mode}`,
    `    balance ${backend.loadBalanceMethod}`,
  ];

  // Tunnel timeout for WebSocket / long-lived connections
  if (backend.timeoutTunnel) {
    lines.push(`    timeout tunnel ${backend.timeoutTunnel}`);
  }

  // Backend-level maximum concurrent connections
  if (backend.maxconn != null) {
    lines.push(`    maxconn ${backend.maxconn}`);
  }

  // HTTP health check
  if (backend.httpCheck) {
    lines.push(`    option httpchk`);
    if (backend.httpCheck.host) {
      lines.push(`    http-check send meth GET uri ${backend.httpCheck.path} ver HTTP/1.1 hdr Host ${backend.httpCheck.host}`);
    } else {
      lines.push(`    http-check send meth GET uri ${backend.httpCheck.path} ver HTTP/1.0`);
    }
    lines.push(`    http-check expect status ${backend.httpCheck.expectStatus}`);
  }

  // Error file
  if (backend.errorFilePath) {
    lines.push(`    errorfile 503 ${backend.errorFilePath}`);
  }

  // HTTP request rules (used for setting headers, etc.)
  if (backend.httpRequestRules) {
    for (const rule of backend.httpRequestRules) {
      lines.push(`    http-request ${rule}`);
    }
  }

  // Servers
  for (const server of backend.servers) {
    // Strip trailing colon from address if present (IPv6 addresses use brackets, not colons)
    const cleanAddress = server.address.replace(/:+$/, "");
    let serverLine = `    server ${server.name} ${cleanAddress}:${server.port}`;
    serverLine += ` weight ${server.weight}`;

    if (server.maxConnections) {
      serverLine += ` maxconn ${server.maxConnections}`;
    }

    if (server.backup) {
      serverLine += ` backup`;
    }

    // SSL options for HTTPS backends
    if (server.ssl) {
      serverLine += ` ssl verify none`;
      if (server.sniHost) {
        // Use specific SNI hostname (when hostRewrite is configured)
        serverLine += ` sni str(${server.sniHost})`;
      } else if (server.sni) {
        // Use request Host header as SNI
        serverLine += ` sni req.hdr(host)`;
      }
    }

    if (server.healthCheck.enabled) {
      serverLine += ` check`;
      if (server.ssl) {
        serverLine += ` check-ssl`;
      }
      serverLine += ` inter ${server.healthCheck.interval}s`;
      serverLine += ` fall ${server.healthCheck.fall}`;
      serverLine += ` rise ${server.healthCheck.rise}`;
    }

    // For optional backends like Pomerium that may not be running,
    // use init-addr none + Docker DNS resolver to defer DNS resolution until runtime
    if (backend.name === "pomerium_backend" || backend.name === "sites_lookup_backend" || backend.name === "analytics_backend") {
      serverLine += ` init-addr none resolvers docker resolve-opts allow-dup-ip`;
    }

    lines.push(serverLine);
  }

  return lines.join("\n") + "\n";
}

/**
 * Generate maintenance backend for a domain
 */
function generateMaintenanceBackend(domain: DomainConfig): HAProxyBackend | null {
  if (!domain.maintenancePagePath) {
    return null;
  }

  const backendName = `maintenance_${sanitizeIdentifier(domain.hostname)}`;

  return {
    name: backendName,
    mode: "http",
    loadBalanceMethod: "roundrobin",
    servers: [],
    // We'll use http-request return for maintenance pages
  };
}

/**
 * Check if a hostname matches a wildcard pattern
 * e.g., "sub.example.com" matches "*.example.com"
 */
function hostnameMatchesWildcard(hostname: string, pattern: string): boolean {
  if (!pattern.startsWith("*.")) return false;

  const wildcardBase = pattern.substring(2); // Remove "*."
  const hostParts = hostname.split(".");
  const baseParts = wildcardBase.split(".");

  // For *.example.com to match sub.example.com:
  // - hostname must have exactly one more part than the wildcard base
  // - the base parts must match
  if (hostParts.length !== baseParts.length + 1) return false;

  // Check that the base matches (e.g., "example.com" === "example.com")
  const hostBase = hostParts.slice(1).join(".");
  return hostBase.toLowerCase() === wildcardBase.toLowerCase();
}

/**
 * Find the certificate path that covers a domain
 * Checks both direct match and wildcard coverage from other domains
 */
function findCertificateForDomain(
  hostname: string,
  domains: DomainConfig[]
): string | null {
  // First check if domain has its own certificate
  const ownDomain = domains.find(d => d.hostname === hostname);
  if (ownDomain?.certificatePath) {
    return ownDomain.certificatePath;
  }

  // Check if any other domain's certificate covers this hostname via wildcard
  for (const domain of domains) {
    if (!domain.certificatePath || !domain.certificateAltNames) continue;

    for (const altName of domain.certificateAltNames) {
      // Direct match
      if (altName.toLowerCase() === hostname.toLowerCase()) {
        return domain.certificatePath;
      }
      // Wildcard match
      if (altName.startsWith("*.") && hostnameMatchesWildcard(hostname, altName)) {
        return domain.certificatePath;
      }
    }
  }

  return null;
}

/**
 * Check if a domain has SSL coverage (either its own cert or covered by wildcard)
 */
function domainHasSSLCoverage(hostname: string, domains: DomainConfig[]): boolean {
  return findCertificateForDomain(hostname, domains) !== null;
}

/**
 * Generate HAProxy configuration from domain configs
 * Note: Site backends are handled by sites-lookup proxy service
 */
export function generateHAProxyConfig(
  domains: DomainConfig[],
  options: {
    certsDir?: string;
    errorPagesDir?: string;
    executorEndpoint?: string;
    executorPort?: number;
  } = {}
): HAProxyConfig {
  const certsDir = options.certsDir || "/etc/haproxy/certs";
  const errorPagesDir = options.errorPagesDir || "/etc/haproxy/errors";

  const config: HAProxyConfig = {
    global: getDefaultGlobalConfig(),
    defaults: getDefaultDefaultsConfig(),
    frontends: [],
    backends: [],
  };

  // Collect all domains with SSL coverage (own cert or covered by wildcard)
  const sslDomains = domains.filter(d => d.sslEnabled && domainHasSSLCoverage(d.hostname, domains));

  // HTTP Frontend (port 80)
  const httpFrontend: HAProxyFrontend = {
    name: "http_front",
    mode: "http",
    binds: [{ address: "*", port: 80 }],
    acls: [],
    useBackends: [],
    defaultBackend: "fallback_backend",
    captures: ["request header Host len 64"],
    httpRequestRules: [],
  };

  // Add ACME challenge bypass ACL - allows Let's Encrypt HTTP-01 challenges through
  // This must be checked before any redirects to allow certificate issuance
  httpFrontend.acls.push({
    name: "is_acme_challenge",
    condition: "path_beg /.well-known/acme-challenge/",
  });

  // HTTPS redirect rule for domains with forceHttps (must have SSL coverage)
  const forceHttpsDomains = domains.filter(d => d.forceHttps && d.sslEnabled && domainHasSSLCoverage(d.hostname, domains));
  if (forceHttpsDomains.length > 0) {
    // Use ACL-based approach to avoid HAProxy line length limits
    // Add ACL for each force-https domain
    for (const domain of forceHttpsDomains) {
      const domainId = sanitizeIdentifier(domain.hostname);
      httpFrontend.acls.push({
        name: `force_https_${domainId}`,
        condition: `hdr(host) -i ${domain.hostname}`,
      });
    }
    // Add redirect rules in batches to avoid line length issues
    // Each redirect can handle ~10 ACL references safely
    const batchSize = 10;
    for (let i = 0; i < forceHttpsDomains.length; i += batchSize) {
      const batch = forceHttpsDomains.slice(i, i + batchSize);
      const aclConditions = batch
        .map(d => `force_https_${sanitizeIdentifier(d.hostname)}`)
        .join(" || ");
      // Exclude ACME challenges from HTTPS redirect to allow certificate issuance
      httpFrontend.httpRequestRules!.push(
        `redirect scheme https code 301 if !{ ssl_fc } !is_acme_challenge ${aclConditions}`
      );
    }
  }

  config.frontends.push(httpFrontend);

  // Only create HTTPS Frontend if there are SSL-enabled domains with certificates
  let httpsFrontend: HAProxyFrontend | null = null;
  if (sslDomains.length > 0) {
    httpsFrontend = {
      name: "https_front",
      mode: "http",
      binds: [{
        address: "*",
        port: 443,
        ssl: true,
        certPath: `${certsDir}/`,
      }],
      acls: [],
      useBackends: [],
      defaultBackend: "fallback_backend",
      captures: ["request header Host len 64", "request header User-Agent len 256"],
    };

    // Add ACME challenge bypass ACL to HTTPS frontend for consistency with route rules
    httpsFrontend.acls.push({
      name: "is_acme_challenge",
      condition: "path_beg /.well-known/acme-challenge/",
    });
  }

  // Generate ACLs and backends for each domain
  for (const domain of domains) {
    const domainId = sanitizeIdentifier(domain.hostname);
    const backendName = `backend_${domainId}`;
    const maintenanceBackendName = `maintenance_${domainId}`;

    // First, check if we have valid backends for this domain
    const enabledBackends = domain.backends.filter(b => b.enabled);
    const staticBackends = enabledBackends.filter(b => b.backendType === "static" && b.address && b.port);
    const siteBackends = enabledBackends.filter(b => b.backendType === "site" && b.siteRuntimeId);
    const hasValidBackends = staticBackends.length > 0 || siteBackends.length > 0;

    // Check if domain has redirect rules (these don't require backends)
    const hasRedirectRules = domain.routeRules?.some(
      r => r.enabled && r.actionType === "redirect" && r.redirectUrl
    ) ?? false;

    // Skip domain if no valid backends AND no redirect rules (unless maintenance mode)
    if (!hasValidBackends && !domain.maintenanceEnabled && !hasRedirectRules) {
      console.warn(`[HAProxy] Skipping domain ${domain.hostname}: no valid backends or redirect rules configured`);
      continue;
    }

    // Add to HTTP frontend (all domains with valid backends)
    httpFrontend.acls.push({
      name: `host_${domainId}`,
      condition: `hdr(host) -i ${domain.hostname}`,
    });

    // Add ACLs and routing for subdomain aliases (www toggle etc.) on HTTP
    if (domain.subdomainAliases && domain.subdomainAliases.length > 0) {
      for (const alias of domain.subdomainAliases) {
        const aliasId = sanitizeIdentifier(alias);
        httpFrontend.acls.push({
          name: `host_alias_${aliasId}`,
          condition: `hdr(host) -i ${alias}`,
        });
        // Force HTTPS redirect for alias if domain has forceHttps
        if (domain.forceHttps && domain.sslEnabled && domainHasSSLCoverage(domain.hostname, domains)) {
          httpFrontend.httpRequestRules!.push(
            `redirect scheme https code 301 if !{ ssl_fc } !is_acme_challenge host_alias_${aliasId}`
          );
        }
        // Route alias to same backend if we have valid backends
        if (hasValidBackends) {
          httpFrontend.useBackends.push({
            backendName,
            condition: `host_alias_${aliasId}`,
          });
        }
      }
    }

    // Maintenance mode handling for HTTP frontend
    if (domain.maintenanceEnabled && domain.maintenancePagePath) {
      // Maintenance mode ACL
      httpFrontend.acls.push({
        name: `maintenance_${domainId}`,
        condition: `var(txn.maintenance_${domainId}) -m bool`,
      });

      // Set maintenance variable (always true when maintenance is enabled)
      httpFrontend.httpRequestRules!.push(
        `set-var(txn.maintenance_${domainId}) bool(true) if host_${domainId}`
      );

      // Bypass IPs ACL
      if (domain.maintenanceBypassIps.length > 0) {
        httpFrontend.acls.push({
          name: `bypass_${domainId}`,
          condition: `src ${domain.maintenanceBypassIps.join(" ")}`,
        });

        // Route to maintenance backend unless bypass IP
        httpFrontend.useBackends.push({
          backendName: maintenanceBackendName,
          condition: `host_${domainId} maintenance_${domainId} !bypass_${domainId}`,
        });
      } else {
        // Route to maintenance backend
        httpFrontend.useBackends.push({
          backendName: maintenanceBackendName,
          condition: `host_${domainId} maintenance_${domainId}`,
        });
      }

      // Create maintenance backend that returns the maintenance page (only once)
      config.backends.push({
        name: maintenanceBackendName,
        mode: "http",
        loadBalanceMethod: "roundrobin",
        servers: [],
      });
    }

    // Only add routing to backend if we have valid backends
    if (hasValidBackends) {
      // Normal routing to backend for HTTP
      httpFrontend.useBackends.push({
        backendName,
        condition: `host_${domainId}`,
      });
    }

    // Add to HTTPS frontend if SSL is enabled and domain has certificate coverage (own or wildcard)
    if (domain.sslEnabled && httpsFrontend && domainHasSSLCoverage(domain.hostname, domains)) {
      // Host ACL
      httpsFrontend.acls.push({
        name: `host_${domainId}`,
        condition: `hdr(host) -i ${domain.hostname}`,
      });

      // Add ACLs and routing for subdomain aliases on HTTPS
      if (domain.subdomainAliases && domain.subdomainAliases.length > 0) {
        for (const alias of domain.subdomainAliases) {
          const aliasId = sanitizeIdentifier(alias);
          // Only add to HTTPS if the alias is covered by the cert (wildcard or SAN match)
          const aliasCovered =
            domainHasSSLCoverage(alias, domains) ||
            (domain.certificateAltNames &&
              domain.certificateAltNames.some(
                (an) =>
                  an.toLowerCase() === alias.toLowerCase() ||
                  (an.startsWith("*.") && hostnameMatchesWildcard(alias, an))
              ));
          if (aliasCovered) {
            httpsFrontend.acls.push({
              name: `host_alias_${aliasId}`,
              condition: `hdr(host) -i ${alias}`,
            });
            if (hasValidBackends) {
              httpsFrontend.useBackends.push({
                backendName,
                condition: `host_alias_${aliasId}`,
              });
            }
          }
        }
      }

      // Maintenance mode handling for HTTPS frontend
      if (domain.maintenanceEnabled && domain.maintenancePagePath) {
        // Maintenance mode ACL
        httpsFrontend.acls.push({
          name: `maintenance_${domainId}`,
          condition: `var(txn.maintenance_${domainId}) -m bool`,
        });

        // Set maintenance variable (always true when maintenance is enabled)
        httpsFrontend.httpRequestRules!.push(
          `set-var(txn.maintenance_${domainId}) bool(true) if host_${domainId}`
        );

        // Bypass IPs ACL
        if (domain.maintenanceBypassIps.length > 0) {
          httpsFrontend.acls.push({
            name: `bypass_${domainId}`,
            condition: `src ${domain.maintenanceBypassIps.join(" ")}`,
          });

          // Route to maintenance backend unless bypass IP
          httpsFrontend.useBackends.push({
            backendName: maintenanceBackendName,
            condition: `host_${domainId} maintenance_${domainId} !bypass_${domainId}`,
          });
        } else {
          // Route to maintenance backend
          httpsFrontend.useBackends.push({
            backendName: maintenanceBackendName,
            condition: `host_${domainId} maintenance_${domainId}`,
          });
        }
        // Note: maintenance backend already created above for HTTP frontend
      }

      // Only add routing to backend if we have valid backends
      if (hasValidBackends) {
        // Normal routing to backend for HTTPS
        httpsFrontend.useBackends.push({
          backendName,
          condition: `host_${domainId}`,
        });
      }
    }

    // Generate backend for this domain (only if we have valid servers)
    if (hasValidBackends) {

      // Create servers for static backends
      // Include sanitized backend name in server name for route backend matching
      const staticServers = staticBackends.map((b, idx) => ({
        name: `${domainId}_${sanitizeIdentifier(b.name)}_srv${idx + 1}`,
        address: b.address!,
        port: b.port!,
        weight: b.weight,
        maxConnections: b.maxConnections,
        backup: b.isBackup,
        // Enable SSL for HTTPS backends
        ssl: b.protocol === "https",
        sni: b.protocol === "https",
        healthCheck: {
          enabled: b.healthCheckEnabled,
          path: b.healthCheckPath,
          interval: b.healthCheckInterval,
          timeout: b.healthCheckTimeout,
          fall: b.healthCheckFall,
          rise: b.healthCheckRise,
        },
      }));

      // Note: Site backends are handled by sites-lookup proxy service
      // Only static backends are added to the backend server list

      const backend: HAProxyBackend = {
        name: backendName,
        mode: "http",
        loadBalanceMethod: "roundrobin",
        servers: staticServers,
        httpRequestRules: [],
      };

      // Add request modification rules from backend config
      // Note: Uses first backend's settings if multiple backends have different configs
      const firstBackendWithRewrite = staticBackends.find(b => b.hostRewrite || b.pathPrefixAdd || b.pathPrefixStrip);
      if (firstBackendWithRewrite) {
        // Host header rewrite
        if (firstBackendWithRewrite.hostRewrite) {
          backend.httpRequestRules!.push(`set-header Host ${firstBackendWithRewrite.hostRewrite}`);
          // Also update SNI for SSL backends to use the rewritten host
          for (const server of backend.servers) {
            if (server.ssl && server.sni) {
              server.sniHost = firstBackendWithRewrite.hostRewrite;
            }
          }
        }
        // Path prefix strip (must come before add)
        if (firstBackendWithRewrite.pathPrefixStrip) {
          backend.httpRequestRules!.push(`replace-path ^${firstBackendWithRewrite.pathPrefixStrip}(.*) \\1`);
        }
        // Path prefix add
        if (firstBackendWithRewrite.pathPrefixAdd) {
          backend.httpRequestRules!.push(`replace-path ^/(.*) ${firstBackendWithRewrite.pathPrefixAdd}/\\1`);
        }
      }

      // Add error file if configured
      if (domain.errorPagePath) {
        backend.errorFilePath = domain.errorPagePath;
      }

      // Add HTTP health check for static backends
      const firstStaticBackendWithHealthCheck = staticBackends.find(b => b.healthCheckEnabled);
      if (firstStaticBackendWithHealthCheck) {
        backend.httpCheck = {
          path: firstStaticBackendWithHealthCheck.healthCheckPath,
          expectStatus: 200,
        };
      }

      config.backends.push(backend);
    }
  }

  // Only add HTTPS frontend if it was created (i.e., if there are SSL domains)
  if (httpsFrontend) {
    config.frontends.push(httpsFrontend);
  }

  // Fallback backend
  config.backends.push({
    name: "fallback_backend",
    mode: "http",
    loadBalanceMethod: "roundrobin",
    servers: [],
  });

  return config;
}

/**
 * Render the full HAProxy configuration as a string
 */
/**
 * Generate the peers section for HAProxy stick-table replication.
 * Only emitted when cluster peers are provided.
 */
function renderPeers(peers: HAProxyClusterPeer[]): string {
  if (peers.length === 0) return "";
  const peersPort = parseInt(process.env.UNI_PROXY_MANAGER_HAPROXY_PEERS_PORT || "1024", 10);
  const lines = ["peers upm_cluster"];
  for (const peer of peers) {
    lines.push(`    peer ${sanitizeIdentifier(peer.name)} ${peer.address}:${peer.port || peersPort}`);
  }
  return lines.join("\n") + "\n";
}

export function renderHAProxyConfig(config: HAProxyConfig): string {
  const sections: string[] = [];

  sections.push(renderGlobal(config.global));
  sections.push(renderResolvers());
  sections.push(renderStatsFrontend());
  sections.push(renderDefaults(config.defaults));

  if (config.clusterPeers && config.clusterPeers.length > 0) {
    sections.push(renderPeers(config.clusterPeers));
  }

  for (const frontend of config.frontends) {
    sections.push(renderFrontend(frontend));
  }

  for (const backend of config.backends) {
    sections.push(renderBackend(backend));
  }

  return sections.join("\n");
}

/**
 * Generate and render HAProxy config from domain configs
 */
export function generateHAProxyConfigString(
  domains: DomainConfig[],
  options?: {
    certsDir?: string;
    errorPagesDir?: string;
  }
): string {
  const config = generateHAProxyConfig(domains, options);
  return renderHAProxyConfig(config);
}

/**
 * Generate Pomerium forward-auth backend
 * Protected routes are proxied through Pomerium for authentication
 */
export function generatePomeriumBackend(pomeriumUrl: string = "pomerium"): HAProxyBackend {
  // Parse the URL to get host and port
  let host = pomeriumUrl;
  let port = 80;

  if (pomeriumUrl.startsWith("http://")) {
    const url = new URL(pomeriumUrl);
    host = url.hostname;
    port = url.port ? parseInt(url.port, 10) : 80;
  } else if (pomeriumUrl.startsWith("https://")) {
    const url = new URL(pomeriumUrl);
    host = url.hostname;
    port = url.port ? parseInt(url.port, 10) : 443;
  }

  return {
    name: "pomerium_backend",
    mode: "http",
    loadBalanceMethod: "roundrobin",
    servers: [
      {
        name: "pomerium",
        address: host,
        port,
        weight: 100,
        healthCheck: {
          enabled: true,
          path: "/.pomerium/ping",
          interval: 5,
          timeout: 3,
          fall: 3,
          rise: 2,
        },
      },
    ],
    httpCheck: {
      path: "/.pomerium/ping",
      // Accept any non-5xx: Pomerium returns 404 when not fully configured
      // (no authenticate_service_url) but the service IS running.
      expectStatus: "200-499",
    },
  };
}

/**
 * Convert glob pattern to HAProxy path matching regex
 * Supports:
 * - Glob patterns: /api/*, /dashboard/**
 * - Multiple paths (comma-separated): /login,/signup,/recover
 * - Direct regex: ^/api/(v1|v2)/.*
 * - Catch-all: /*, /**
 */
function globToHAProxyPath(pattern: string): string {
  if (pattern === "/*" || pattern === "/**" || pattern === "/") {
    return ""; // Match all paths - no ACL needed
  }

  // Check if it's already a regex (starts with ^ or contains unescaped regex chars like |, (), [])
  // but not escaped versions like \| or \(
  if (pattern.startsWith("^") || /(?<!\\)[|()]/.test(pattern)) {
    return pattern; // Return as-is, it's already regex
  }

  // Handle comma-separated multiple paths
  const paths = pattern.split(",").map((p) => p.trim()).filter(Boolean);

  const regexPaths = paths.map((path) => {
    // Handle exact root path "/" - must match exactly, not as prefix
    if (path === "/") {
      return "/$";
    }

    // Check if path contains wildcards
    const hasWildcard = path.includes("*");

    // Escape special regex characters except * and **
    let regex = path
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "{{DOUBLE_STAR}}")
      .replace(/\*/g, "[^/]*")
      .replace(/{{DOUBLE_STAR}}/g, ".*");

    // If no wildcards, make it an exact match (add $ at end)
    // e.g., /driver matches only /driver, not /driver-routes
    if (!hasWildcard) {
      regex = regex + "$";
    }

    return regex;
  });

  // If multiple paths, wrap in alternation group
  if (regexPaths.length > 1) {
    return `^(${regexPaths.join("|")})`;
  }

  return `^${regexPaths[0]}`;
}

/**
 * Convert glob pattern to HAProxy path matching regex for Pomerium routes
 * Unlike globToHAProxyPath, this treats all wildcards as matching nested paths
 * because Pomerium protection patterns like /wp-* should match /wp-admin/plugins/foo
 */
function globToHAProxyPathForPomerium(pattern: string): string {
  if (pattern === "/*" || pattern === "/**" || pattern === "/") {
    return ""; // Match all paths - no ACL needed
  }

  // If it's a fully-formed regex (starts with ^), return as-is
  if (pattern.startsWith("^")) {
    return pattern;
  }

  // If it contains regex operators (|, (), []) but no leading ^, treat it as a
  // regex-like glob: convert glob wildcards but leave the regex structure intact
  if (/(?<!\\)[|()]/.test(pattern)) {
    return pattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*");
  }

  // Handle comma-separated multiple paths
  const paths = pattern.split(",").map((p) => p.trim()).filter(Boolean);

  const regexPaths = paths.map((path) => {
    if (path === "/") {
      return "/$";
    }

    const hasWildcard = path.includes("*");

    // Escape special regex characters except * and **
    // For Pomerium, ALL wildcards match nested paths (use .* instead of [^/]*)
    let regex = path
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*+/g, ".*"); // Both * and ** become .* for Pomerium

    // If no wildcards, make it an exact match
    if (!hasWildcard) {
      regex = regex + "$";
    }

    return regex;
  });

  if (regexPaths.length > 1) {
    return `^(${regexPaths.join("|")})`;
  }

  return `^${regexPaths[0]}`;
}

/**
 * Generate route rules ACLs for URI-based routing to different backends
 */
function applyRouteRules(
  frontend: HAProxyFrontend,
  domainId: string,
  hostname: string,
  routeRules: DomainRouteRuleConfig[]
): void {
  // Sort by priority (lower number = higher priority, checked first in HAProxy)
  const sortedRules = routeRules
    .filter((r) => r.enabled)
    .sort((a, b) => a.priority - b.priority);

  if (sortedRules.length === 0) return;

  const sanitizedDomain = sanitizeIdentifier(hostname);
  const hostAclName = `host_${sanitizedDomain}`;

  // Ensure host ACL exists (may not exist for Pomerium-only domains without backends)
  const hostAclExists = frontend.acls.some((acl) => acl.name === hostAclName);
  if (!hostAclExists) {
    frontend.acls.push({
      name: hostAclName,
      condition: `hdr(host) -i ${hostname}`,
    });
  }

  // Collect backend routing rules to insert in correct order
  const backendRoutingRules: { backendName: string; condition: string }[] = [];

  for (const rule of sortedRules) {
    const ruleId = sanitizeIdentifier(rule.id);
    const pathAclName = `route_path_${sanitizedDomain}_${ruleId}`;
    const pathRegex = globToHAProxyPath(rule.pathPattern);

    // For routes with specific paths, we need BOTH host AND path ACLs
    // HAProxy ACLs can only have one criterion, so we need two separate ACLs
    let routeCondition: string;

    if (pathRegex) {
      // Create path-specific ACL (case-insensitive for URL paths)
      frontend.acls.push({
        name: pathAclName,
        condition: `path_reg -i ${pathRegex}`,
      });
      // Combine host ACL (already exists) with path ACL
      routeCondition = `${hostAclName} ${pathAclName}`;
    } else {
      // Match all paths for this domain - just use host ACL
      routeCondition = hostAclName;
    }

    // Handle based on action type
    if (rule.actionType === "redirect" && rule.redirectUrl) {
      // Generate redirect rule
      const statusCode = rule.redirectStatusCode || 302;
      let redirectTarget = rule.redirectUrl;

      // Build the redirect location
      if (rule.redirectPreservePath) {
        // Append the original path to the redirect URL
        // Use HAProxy's %[path] fetch to get the original path
        if (redirectTarget.endsWith("/")) {
          redirectTarget = redirectTarget.slice(0, -1);
        }
        redirectTarget = `${redirectTarget}%[path]`;
      }

      if (rule.redirectPreserveQuery) {
        // Append query string if present (trailing ? is harmless if empty)
        redirectTarget = `${redirectTarget}?%[query]`;
      }

      // Add http-request redirect rule (exclude ACME challenges to allow certificate issuance)
      frontend.httpRequestRules = frontend.httpRequestRules || [];
      frontend.httpRequestRules.push(
        `redirect location ${redirectTarget} code ${statusCode} if !is_acme_challenge ${routeCondition}`
      );
    } else if (rule.actionType === "backend" || !rule.actionType) {
      // Route to backend (default behavior)
      const backendName = `backend_${sanitizedDomain}_route_${ruleId}`;

      // Collect for later insertion in correct priority order
      backendRoutingRules.push({
        backendName,
        condition: routeCondition,
      });
    }
  }

  // Insert all backend routing rules at the beginning in correct priority order
  // (lower priority number = checked first in HAProxy)
  if (backendRoutingRules.length > 0) {
    frontend.useBackends.unshift(...backendRoutingRules);
  }
}

/**
 * Generate backends for route rules
 * Routes traffic to specific backend servers based on path patterns
 */
function generateRouteRuleBackends(
  domainId: string,
  hostname: string,
  routeRules: DomainRouteRuleConfig[],
  backends: HAProxyBackend[],
  domainBackends?: BackendConfig[]
): HAProxyBackend[] {
  const sanitizedDomain = sanitizeIdentifier(hostname);
  const newBackends: HAProxyBackend[] = [];

  // Find the domain's main backend to use as a template
  const domainBackend = backends.find(
    (b) => b.name === `backend_${sanitizedDomain}`
  );

  // Only process backend-type rules (skip redirects)
  const backendRules = routeRules.filter(
    (r) => r.enabled && (r.actionType === "backend" || !r.actionType) && r.backendId
  );

  for (const rule of backendRules) {
    const ruleId = sanitizeIdentifier(rule.id);
    const backendName = `backend_${sanitizedDomain}_route_${ruleId}`;

    // Find the specific backend config for this route using backendId
    const targetBackendConfig = domainBackends?.find(
      (b) => b.id === rule.backendId
    );

    if (targetBackendConfig && domainBackend) {
      // Create route-specific backend with servers matching the target backend.
      // Name match is tried first; address+port is only a fallback when no name
      // match is found (prevents multiple backends sharing the same upstream
      // address from bleeding into each other's route backends).
      const targetName = sanitizeIdentifier(targetBackendConfig.name);
      const nameMatched = domainBackend.servers.filter((s) =>
        s.name.includes(targetName)
      );
      const servers =
        nameMatched.length > 0
          ? nameMatched
          : domainBackend.servers.filter(
              (s) =>
                targetBackendConfig.address &&
                targetBackendConfig.port &&
                s.address === targetBackendConfig.address &&
                s.port === targetBackendConfig.port
            );

      // Build httpRequestRules for the route backend
      const httpRequestRules: string[] = [];

      // Apply host rewrite from the target backend config
      if (targetBackendConfig.hostRewrite) {
        httpRequestRules.push(`set-header Host ${targetBackendConfig.hostRewrite}`);
      }
      // Apply path prefix strip (must come before add)
      if (targetBackendConfig.pathPrefixStrip) {
        httpRequestRules.push(`replace-path ^${targetBackendConfig.pathPrefixStrip}(.*) \\1`);
      }
      // Apply path prefix add
      if (targetBackendConfig.pathPrefixAdd) {
        httpRequestRules.push(`replace-path ^/(.*) ${targetBackendConfig.pathPrefixAdd}/\\1`);
      }

      if (servers.length > 0) {
        // Clone servers and update sniHost based on this route's target backend.
        // Always explicitly set or clear sniHost so the cloned server doesn't
        // inherit a stale value baked into the main domain backend.
        const clonedServers = servers.map((s) => {
          const cloned = { ...s };
          if (cloned.ssl && cloned.sni) {
            cloned.sniHost = targetBackendConfig.hostRewrite || undefined;
          }
          return cloned;
        });

        newBackends.push({
          name: backendName,
          mode: domainBackend.mode,
          loadBalanceMethod: domainBackend.loadBalanceMethod,
          servers: clonedServers,
          httpRequestRules: httpRequestRules.length > 0 ? httpRequestRules : undefined,
          httpCheck: domainBackend.httpCheck,
          errorFilePath: domainBackend.errorFilePath,
        });
      } else {
        // If no servers match by name/address, create backend with this specific server
        if (targetBackendConfig.address && targetBackendConfig.port && targetBackendConfig.enabled) {
          newBackends.push({
            name: backendName,
            mode: domainBackend.mode,
            loadBalanceMethod: domainBackend.loadBalanceMethod,
            servers: [
              {
                name: `${sanitizedDomain}_${targetName}`,
                address: targetBackendConfig.address,
                port: targetBackendConfig.port,
                weight: targetBackendConfig.weight,
                maxConnections: targetBackendConfig.maxConnections,
                backup: targetBackendConfig.isBackup,
                ssl: targetBackendConfig.protocol === "https",
                sni: targetBackendConfig.protocol === "https",
                sniHost: targetBackendConfig.hostRewrite || undefined,
                healthCheck: {
                  enabled: targetBackendConfig.healthCheckEnabled,
                  path: targetBackendConfig.healthCheckPath,
                  interval: targetBackendConfig.healthCheckInterval,
                  timeout: targetBackendConfig.healthCheckTimeout,
                  fall: targetBackendConfig.healthCheckFall,
                  rise: targetBackendConfig.healthCheckRise,
                },
              },
            ],
            httpRequestRules: httpRequestRules.length > 0 ? httpRequestRules : undefined,
            httpCheck: targetBackendConfig.healthCheckEnabled
              ? {
                  path: targetBackendConfig.healthCheckPath,
                  expectStatus: 200,
                }
              : undefined,
            errorFilePath: domainBackend.errorFilePath,
          });
        }
      }
    } else if (domainBackend) {
      // Fallback: use all domain servers for the route when backend not found
      // This maintains backwards compatibility
      newBackends.push({
        name: backendName,
        mode: domainBackend.mode,
        loadBalanceMethod: domainBackend.loadBalanceMethod,
        servers: domainBackend.servers.map((s) => ({ ...s })), // Clone servers
        httpRequestRules: domainBackend.httpRequestRules, // Copy from main backend
        httpCheck: domainBackend.httpCheck,
        errorFilePath: domainBackend.errorFilePath,
      });
    }
  }

  return newBackends;
}

/**
 * Generate IP access control ACLs (whitelist/blacklist)
 */
function applyIpAccessControl(
  frontend: HAProxyFrontend,
  domainId: string,
  hostname: string,
  ipConfig: DomainIpAccessConfig
): void {
  if (!ipConfig.enabled || ipConfig.ipAddresses.length === 0) return;

  const sanitizedDomain = sanitizeIdentifier(hostname);
  const ipAclName = `ip_access_${sanitizedDomain}`;
  const hostAclName = `host_${sanitizedDomain}`;

  // Ensure host ACL exists (may not exist for Pomerium-only domains without backends)
  const hostAclExists = frontend.acls.some((acl) => acl.name === hostAclName);
  if (!hostAclExists) {
    frontend.acls.push({
      name: hostAclName,
      condition: `hdr(host) -i ${hostname}`,
    });
  }

  // Create ACL for matching IPs (supports CIDR)
  frontend.acls.push({
    name: ipAclName,
    condition: `src ${ipConfig.ipAddresses.join(" ")}`,
  });

  // Initialize httpRequestRules if needed
  frontend.httpRequestRules = frontend.httpRequestRules || [];

  if (ipConfig.mode === "whitelist") {
    // Block if host matches AND IP does NOT match (whitelist mode)
    frontend.httpRequestRules.push(
      `deny deny_status 403 if ${hostAclName} !${ipAclName}`
    );
  } else {
    // Block if host matches AND IP matches (blacklist mode)
    frontend.httpRequestRules.push(
      `deny deny_status 403 if ${hostAclName} ${ipAclName}`
    );
  }
}

/**
 * Generate security headers (X-Frame-Options, CSP, CORS)
 *
 * Note: http-response rules cannot use request-time fetches like hdr(host).
 * We store the host match in a transaction variable during request processing,
 * then use that variable in response rules.
 */
function applySecurityHeaders(
  frontend: HAProxyFrontend,
  domainId: string,
  hostname: string,
  headers: DomainSecurityHeadersConfig
): void {
  const sanitizedDomain = sanitizeIdentifier(hostname);
  // HAProxy variable names can't contain hyphens, only underscores
  const sanitizedVarName = sanitizedDomain.replace(/-/g, "_");
  const hostAclName = `host_${sanitizedDomain}`;
  const hostVarName = `txn.sechdrs_${sanitizedVarName}`;
  const hostVarAclName = `sechdrs_host_${sanitizedDomain}`;

  // Ensure host ACL exists (may not exist for Pomerium-only domains without backends)
  const hostAclExists = frontend.acls.some((acl) => acl.name === hostAclName);
  if (!hostAclExists) {
    frontend.acls.push({
      name: hostAclName,
      condition: `hdr(host) -i ${hostname}`,
    });
  }

  // Initialize arrays if needed
  frontend.httpRequestRules = frontend.httpRequestRules || [];
  frontend.httpResponseRules = frontend.httpResponseRules || [];

  // Stash host match into a txn var -- hdr(host) isn't available in http-response rules
  frontend.httpRequestRules.push(
    `set-var(${hostVarName}) bool(true) if ${hostAclName}`
  );

  // Create ACL for checking the host variable in response rules
  // var() works in both request and response contexts
  frontend.acls.push({
    name: hostVarAclName,
    condition: `var(${hostVarName}) -m bool`,
  });

  // X-Frame-Options
  if (headers.xFrameOptions?.enabled && headers.xFrameOptions.value !== "disabled") {
    let value = headers.xFrameOptions.value.toUpperCase();
    if (value === "ALLOW-FROM" && headers.xFrameOptions.allowFrom) {
      value = `ALLOW-FROM ${headers.xFrameOptions.allowFrom}`;
    }
    frontend.httpResponseRules.push(
      `set-header X-Frame-Options "${value}" if ${hostVarAclName}`
    );
  }

  // CSP frame-ancestors
  if (headers.cspFrameAncestors?.enabled && headers.cspFrameAncestors.values.length > 0) {
    const ancestors = headers.cspFrameAncestors.values
      .map((a) => (a === "self" ? "'self'" : a))
      .join(" ");
    frontend.httpResponseRules.push(
      `set-header Content-Security-Policy "frame-ancestors ${ancestors}" if ${hostVarAclName}`
    );
  }

  // CORS headers
  if (headers.cors?.enabled) {
    const cors = headers.cors;

    // Access-Control-Allow-Origin
    if (cors.allowOrigins.length > 0) {
      if (cors.allowOrigins.includes("*")) {
        frontend.httpResponseRules.push(
          `set-header Access-Control-Allow-Origin "*" if ${hostVarAclName}`
        );
      } else if (cors.allowOrigins.length === 1) {
        // Single origin - set directly
        frontend.httpResponseRules.push(
          `set-header Access-Control-Allow-Origin "${cors.allowOrigins[0]}" if ${hostVarAclName}`
        );
      } else {
        // Multiple origins - reflect the request origin if it matches
        // Store each origin match in a transaction variable for response-time access
        for (const origin of cors.allowOrigins) {
          const sanitizedOrigin = sanitizeIdentifier(origin);
          // HAProxy variable names can't contain hyphens
          const sanitizedOriginVarName = sanitizedOrigin.replace(/-/g, "_");
          const originVarName = `txn.cors_origin_${sanitizedVarName}_${sanitizedOriginVarName}`;
          const originVarAclName = `cors_origin_var_${sanitizedDomain}_${sanitizedOrigin}`;

          // Store origin match during request processing
          frontend.httpRequestRules.push(
            `set-var(${originVarName}) str(%[req.hdr(Origin)]) if ${hostAclName} { req.hdr(Origin) -i ${origin} }`
          );

          // Create ACL for response-time checking
          frontend.acls.push({
            name: originVarAclName,
            condition: `var(${originVarName}) -m found`,
          });

          frontend.httpResponseRules.push(
            `set-header Access-Control-Allow-Origin %[var(${originVarName})] if ${hostVarAclName} ${originVarAclName}`
          );
        }
      }
    }

    // Access-Control-Allow-Methods
    if (cors.allowMethods.length > 0) {
      frontend.httpResponseRules.push(
        `set-header Access-Control-Allow-Methods "${cors.allowMethods.join(", ")}" if ${hostVarAclName}`
      );
    }

    // Access-Control-Allow-Headers
    if (cors.allowHeaders.length > 0) {
      frontend.httpResponseRules.push(
        `set-header Access-Control-Allow-Headers "${cors.allowHeaders.join(", ")}" if ${hostVarAclName}`
      );
    }

    // Access-Control-Expose-Headers
    if (cors.exposeHeaders.length > 0) {
      frontend.httpResponseRules.push(
        `set-header Access-Control-Expose-Headers "${cors.exposeHeaders.join(", ")}" if ${hostVarAclName}`
      );
    }

    // Access-Control-Allow-Credentials
    if (cors.allowCredentials) {
      frontend.httpResponseRules.push(
        `set-header Access-Control-Allow-Credentials "true" if ${hostVarAclName}`
      );
    }

    // Access-Control-Max-Age
    if (cors.maxAge > 0) {
      frontend.httpResponseRules.push(
        `set-header Access-Control-Max-Age "${cors.maxAge}" if ${hostVarAclName}`
      );
    }

    // Handle CORS preflight (OPTIONS) requests
    // Must include CORS headers in the preflight response since http-response rules don't apply to http-request return
    const preflightAclName = `cors_preflight_${sanitizedDomain}`;
    frontend.acls.push({
      name: preflightAclName,
      condition: `method OPTIONS`,
    });

    // Build preflight response with all CORS headers
    const preflightHeaders: string[] = [];

    // Access-Control-Allow-Origin for preflight
    if (cors.allowOrigins.length > 0) {
      if (cors.allowOrigins.includes("*")) {
        preflightHeaders.push(`hdr Access-Control-Allow-Origin "*"`);
      } else if (cors.allowOrigins.length === 1) {
        preflightHeaders.push(`hdr Access-Control-Allow-Origin "${cors.allowOrigins[0]}"`);
      } else {
        // For multiple origins in preflight, we need to use a different approach
        // Since we can't dynamically set headers in http-request return, use the first origin
        // and rely on Vary: Origin to handle caching properly
        preflightHeaders.push(`hdr Access-Control-Allow-Origin "%[req.hdr(Origin)]"`);
        preflightHeaders.push(`hdr Vary "Origin"`);
      }
    }

    if (cors.allowMethods.length > 0) {
      preflightHeaders.push(`hdr Access-Control-Allow-Methods "${cors.allowMethods.join(", ")}"`);
    }

    if (cors.allowHeaders.length > 0) {
      preflightHeaders.push(`hdr Access-Control-Allow-Headers "${cors.allowHeaders.join(", ")}"`);
    }

    if (cors.allowCredentials) {
      preflightHeaders.push(`hdr Access-Control-Allow-Credentials "true"`);
    }

    if (cors.maxAge > 0) {
      preflightHeaders.push(`hdr Access-Control-Max-Age "${cors.maxAge}"`);
    }

    const preflightHeadersStr = preflightHeaders.length > 0 ? ` ${preflightHeaders.join(" ")}` : "";
    frontend.httpRequestRules.push(
      `return status 204${preflightHeadersStr} if ${hostAclName} ${preflightAclName}`
    );
  }
}

/**
 * Generate blocked routes ACLs (HAProxy-level path blocking)
 */
function applyBlockedRoutes(
  frontend: HAProxyFrontend,
  domainId: string,
  hostname: string,
  blockedRoutes: DomainBlockedRouteConfig[]
): void {
  const enabledRoutes = blockedRoutes.filter((r) => r.enabled);
  if (enabledRoutes.length === 0) return;

  const sanitizedDomain = sanitizeIdentifier(hostname);
  const hostAclName = `host_${sanitizedDomain}`;

  // Ensure host ACL exists (may not exist for Pomerium-only domains without backends)
  const hostAclExists = frontend.acls.some((acl) => acl.name === hostAclName);
  if (!hostAclExists) {
    frontend.acls.push({
      name: hostAclName,
      condition: `hdr(host) -i ${hostname}`,
    });
  }

  // Initialize httpRequestRules if needed
  frontend.httpRequestRules = frontend.httpRequestRules || [];

  for (const route of enabledRoutes) {
    const routeId = sanitizeIdentifier(route.id);
    const aclName = `blocked_${sanitizedDomain}_${routeId}`;
    const pathRegex = globToHAProxyPath(route.pathPattern);

    // Create ACL for path matching
    if (pathRegex) {
      frontend.acls.push({
        name: aclName,
        condition: `path_reg ${pathRegex}`,
      });
    } else {
      // Exact path match
      frontend.acls.push({
        name: aclName,
        condition: `path ${route.pathPattern}`,
      });
    }

    // Add deny rule with status code
    frontend.httpRequestRules.push(
      `deny deny_status ${route.httpStatusCode} if ${hostAclName} ${aclName}`
    );
  }
}

/**
 * Apply bot blocking at HAProxy level
 */
function applyBotBlocking(
  frontend: HAProxyFrontend,
  domainId: string,
  hostname: string,
  blockBots: boolean
): void {
  if (!blockBots) return;

  const sanitizedDomain = sanitizeIdentifier(hostname);
  const hostAclName = `host_${sanitizedDomain}`;
  const botAclName = `bot_${sanitizedDomain}`;

  // Ensure host ACL exists (may not exist for Pomerium-only domains without backends)
  const hostAclExists = frontend.acls.some((acl) => acl.name === hostAclName);
  if (!hostAclExists) {
    frontend.acls.push({
      name: hostAclName,
      condition: `hdr(host) -i ${hostname}`,
    });
  }

  // Generate bot user agent pattern
  const botPattern = generateHAProxyBotPattern();

  // Create ACL for bot user agents
  // Using -i for case-insensitive matching and -m reg for regex matching
  frontend.acls.push({
    name: botAclName,
    condition: `req.hdr(User-Agent) -i -m reg "${botPattern}"`,
  });

  // Initialize httpRequestRules if needed
  frontend.httpRequestRules = frontend.httpRequestRules || [];

  // Deny bot requests for this domain with 403 status
  frontend.httpRequestRules.push(
    `deny deny_status 403 if ${hostAclName} ${botAclName}`
  );
}

/**
 * Apply all advanced domain configuration to frontends
 */
function applyAdvancedDomainConfig(
  frontend: HAProxyFrontend,
  domain: DomainConfig
): void {
  const domainId = sanitizeIdentifier(domain.hostname);

  // Apply bot blocking first (before other rules)
  if (domain.blockBots) {
    applyBotBlocking(frontend, domain.id, domain.hostname, domain.blockBots);
  }

  // Apply blocked routes (high priority - deny before routing)
  if (domain.blockedRoutes && domain.blockedRoutes.length > 0) {
    applyBlockedRoutes(frontend, domain.id, domain.hostname, domain.blockedRoutes);
  }

  // Apply IP access control
  if (domain.ipAccessControl) {
    applyIpAccessControl(frontend, domain.id, domain.hostname, domain.ipAccessControl);
  }

  // Apply route rules (URI-based routing)
  if (domain.routeRules && domain.routeRules.length > 0) {
    applyRouteRules(frontend, domain.id, domain.hostname, domain.routeRules);
  }

  // Apply security headers
  if (domain.securityHeaders) {
    applySecurityHeaders(frontend, domain.id, domain.hostname, domain.securityHeaders);
  }
}

/**
 * Add ACL + use_backend rules for the Pomerium authenticate service URL hostname.
 * Traffic arriving at auth.example.com (for any path) must reach pomerium_backend
 * so that Pomerium can serve its own authenticate flow.
 */
function applyPomeriumAuthenticateRoute(
  httpFrontend: HAProxyFrontend | undefined,
  httpsFrontend: HAProxyFrontend | undefined,
  authenticateServiceUrl: string
): void {
  let hostname: string;
  try {
    hostname = new URL(authenticateServiceUrl).hostname;
  } catch {
    return; // Malformed URL — skip silently
  }
  if (!hostname) return;

  const aclName = `pomerium_auth_host_${sanitizeIdentifier(hostname)}`;
  const acl: HAProxyACL = { name: aclName, condition: `hdr(host) -i ${hostname}` };
  const useBackend: HAProxyUseBackend = { backendName: "pomerium_backend", condition: aclName };

  if (httpFrontend) {
    httpFrontend.acls.push({ ...acl });
    httpFrontend.useBackends.unshift({ ...useBackend });
  }
  if (httpsFrontend) {
    httpsFrontend.acls.push({ ...acl });
    httpsFrontend.useBackends.unshift({ ...useBackend });
  }
}

/**
 * Apply Pomerium protection to frontends
 */
function applyPomeriumProtection(
  frontend: HAProxyFrontend,
  pomeriumConfig: PomeriumConfig,
  domainId: string,
  hostname: string
): void {
  if (!pomeriumConfig.enabled) return;

  // Get routes for this domain, sorted by priority (highest first)
  const domainRoutes = pomeriumConfig.routes
    .filter(r => r.domainId === domainId && r.enabled)
    .sort((a, b) => b.priority - a.priority);

  if (domainRoutes.length === 0) return;

  const sanitizedDomain = sanitizeIdentifier(hostname);
  const hasProtectedRoutes = domainRoutes.some(r => r.protection === "protected");

  // Only add /.pomerium/* catch-all when there are protected routes.
  // Pomerium uses these internal paths (sign_in, callback, etc.) on the
  // protected domain itself during the auth flow.
  if (hasProtectedRoutes) {
    const pomeriumInternalHostAcl = `pomerium_host_${sanitizedDomain}`;
    const pomeriumInternalPathAcl = `pomerium_internal_path_${sanitizedDomain}`;
    frontend.acls.push({ name: pomeriumInternalHostAcl, condition: `hdr(host) -i ${hostname}` });
    frontend.acls.push({ name: pomeriumInternalPathAcl, condition: `path_beg /.pomerium/` });
    frontend.useBackends.unshift({
      backendName: "pomerium_backend",
      condition: `${pomeriumInternalHostAcl} ${pomeriumInternalPathAcl}`,
    });
  }

  for (const route of domainRoutes) {
    const routeId = sanitizeIdentifier(route.id);
    const hostAclName = `pomerium_host_${sanitizedDomain}_${routeId}`;
    const pathAclName = `pomerium_path_${sanitizedDomain}_${routeId}`;

    if (route.protection === "protected") {
      // Use Pomerium-specific path conversion (wildcards match nested paths)
      const pathRegex = globToHAProxyPathForPomerium(route.pathPattern);

      // Host ACL is always needed
      frontend.acls.push({
        name: hostAclName,
        condition: `hdr(host) -i ${hostname}`,
      });

      if (pathRegex) {
        // Specific path pattern - add separate path ACL
        frontend.acls.push({
          name: pathAclName,
          condition: `path_reg ${pathRegex}`,
        });

        // Use both ACLs together
        frontend.useBackends.unshift({
          backendName: "pomerium_backend",
          condition: `${hostAclName} ${pathAclName}`,
        });
      } else {
        // Match all paths for this domain - only need host ACL
        frontend.useBackends.unshift({
          backendName: "pomerium_backend",
          condition: hostAclName,
        });
      }
    }
    // "public" and "passthrough" routes don't need special handling - they use regular backends
  }
}

/**
 * Generate sites-lookup backend
 * All site traffic routes here - sites-lookup handles DB lookup and proxies to executor
 */
export function generateSitesLookupBackend(): HAProxyBackend {
  return {
    name: "sites_lookup_backend",
    mode: "http",
    loadBalanceMethod: "roundrobin",
    servers: [
      {
        name: "lookup",
        address: "sites-lookup",
        port: 3002,
        weight: 100,
        healthCheck: {
          enabled: true,
          path: "/health",
          interval: 5,
          timeout: 3,
          fall: 3,
          rise: 2,
        },
      },
    ],
    httpCheck: {
      path: "/health",
      expectStatus: 200,
    },
  };
}

/**
 * Generate HAProxy configuration including sites
 * Sites route to sites-lookup backend which handles DB lookup and proxying to executor
 */
export function generateHAProxyConfigWithSites(
  domains: DomainConfig[],
  sites: SiteConfig[],
  _executorConfig: SitesExecutorConfig,
  options: {
    certsDir?: string;
    errorPagesDir?: string;
  } = {}
): HAProxyConfig {
  // Collect hostnames that are handled by sites
  const siteHostnames = new Set(sites.map(s => s.hostname.toLowerCase()));

  // Filter out domains whose hostnames are handled by sites
  const filteredDomains = domains.filter(d => !siteHostnames.has(d.hostname.toLowerCase()));

  // Process filtered domains
  const config = generateHAProxyConfig(filteredDomains, options);
  const certsDir = options.certsDir || "/etc/haproxy/certs";

  // Get frontends
  const httpFrontend = config.frontends.find((f) => f.name === "http_front");
  let httpsFrontend = config.frontends.find((f) => f.name === "https_front");

  // Check if any sites need SSL - if so, we need HTTPS frontend
  const sslSites = sites.filter(s => s.sslEnabled);
  if (sslSites.length > 0 && !httpsFrontend) {
    // Create HTTPS frontend for sites
    httpsFrontend = {
      name: "https_front",
      mode: "http",
      binds: [{
        address: "*",
        port: 443,
        ssl: true,
        certPath: `${certsDir}/`,
      }],
      acls: [],
      useBackends: [],
      defaultBackend: "fallback_backend",
      httpRequestRules: [],
    };

    // Add ACME challenge bypass ACL to HTTPS frontend for consistency with route rules
    httpsFrontend.acls.push({
      name: "is_acme_challenge",
      condition: "path_beg /.well-known/acme-challenge/",
    });

    config.frontends.push(httpsFrontend);
  }

  // Add sites-lookup backend (single backend for all sites)
  if (sites.length > 0) {
    config.backends.push(generateSitesLookupBackend());
  }

  // Add HTTPS redirect rules for SSL-enabled sites
  if (httpFrontend && sslSites.length > 0) {
    const siteHostConditions = sslSites
      .map(s => `{ hdr(host) -i ${s.hostname} }`)
      .join(" || ");
    httpFrontend.httpRequestRules = httpFrontend.httpRequestRules || [];
    httpFrontend.httpRequestRules.push(
      `redirect scheme https code 301 if !{ ssl_fc } ${siteHostConditions}`
    );
  }

  // Generate ACLs for each site - all route to sites_lookup_backend
  for (const site of sites) {
    const siteId = sanitizeIdentifier(site.id);
    const maintenanceBackendName = `site_maintenance_${siteId}`;

    // Add host ACL and routing for HTTP frontend
    if (httpFrontend) {
      httpFrontend.acls.push({
        name: `site_host_${siteId}`,
        condition: `hdr(host) -i ${site.hostname}`,
      });

      // Maintenance mode handling
      if (site.maintenanceEnabled && site.maintenancePagePath) {
        httpFrontend.acls.push({
          name: `site_maintenance_${siteId}`,
          condition: `var(txn.site_maintenance_${siteId}) -m bool`,
        });

        httpFrontend.httpRequestRules!.push(
          `set-var(txn.site_maintenance_${siteId}) bool(true) if site_host_${siteId}`
        );

        if (site.maintenanceBypassIps.length > 0) {
          httpFrontend.acls.push({
            name: `site_bypass_${siteId}`,
            condition: `src ${site.maintenanceBypassIps.join(" ")}`,
          });

          httpFrontend.useBackends.push({
            backendName: maintenanceBackendName,
            condition: `site_host_${siteId} site_maintenance_${siteId} !site_bypass_${siteId}`,
          });
        } else {
          httpFrontend.useBackends.push({
            backendName: maintenanceBackendName,
            condition: `site_host_${siteId} site_maintenance_${siteId}`,
          });
        }

        // Create maintenance backend
        config.backends.push({
          name: maintenanceBackendName,
          mode: "http",
          loadBalanceMethod: "roundrobin",
          servers: [],
          errorFilePath: site.maintenancePagePath,
        });
      }

      // Route to sites-lookup backend
      httpFrontend.useBackends.push({
        backendName: "sites_lookup_backend",
        condition: `site_host_${siteId}`,
      });
    }

    // Add to HTTPS frontend if SSL is enabled
    if (site.sslEnabled && httpsFrontend) {
      httpsFrontend.acls.push({
        name: `site_host_${siteId}`,
        condition: `hdr(host) -i ${site.hostname}`,
      });

      // Maintenance mode handling for HTTPS
      if (site.maintenanceEnabled && site.maintenancePagePath) {
        httpsFrontend.acls.push({
          name: `site_maintenance_${siteId}`,
          condition: `var(txn.site_maintenance_${siteId}) -m bool`,
        });

        httpsFrontend.httpRequestRules!.push(
          `set-var(txn.site_maintenance_${siteId}) bool(true) if site_host_${siteId}`
        );

        if (site.maintenanceBypassIps.length > 0) {
          httpsFrontend.acls.push({
            name: `site_bypass_${siteId}`,
            condition: `src ${site.maintenanceBypassIps.join(" ")}`,
          });

          httpsFrontend.useBackends.push({
            backendName: maintenanceBackendName,
            condition: `site_host_${siteId} site_maintenance_${siteId} !site_bypass_${siteId}`,
          });
        } else {
          httpsFrontend.useBackends.push({
            backendName: maintenanceBackendName,
            condition: `site_host_${siteId} site_maintenance_${siteId}`,
          });
        }
      }

      httpsFrontend.useBackends.push({
        backendName: "sites_lookup_backend",
        condition: `site_host_${siteId}`,
      });
    }
  }

  return config;
}

/**
 * Generate and render HAProxy config from domain and site configs
 */
export function generateHAProxyConfigWithSitesString(
  domains: DomainConfig[],
  sites: SiteConfig[],
  executorConfig: SitesExecutorConfig,
  options?: {
    certsDir?: string;
    errorPagesDir?: string;
  }
): string {
  const config = generateHAProxyConfigWithSites(domains, sites, executorConfig, options);
  return renderHAProxyConfig(config);
}

/**
 * Generate HAProxy configuration with Pomerium access control
 * Pomerium protected routes are forwarded to Pomerium for authentication
 */
export function generateHAProxyConfigWithPomerium(
  domains: DomainConfig[],
  pomeriumConfig: PomeriumConfig,
  options: {
    certsDir?: string;
    errorPagesDir?: string;
  } = {}
): HAProxyConfig {
  // Start with base config from domains
  const config = generateHAProxyConfig(domains, options);

  const hasRoutes = pomeriumConfig.routes.length > 0;
  const hasAuthUrl = !!pomeriumConfig.authenticateServiceUrl;

  if (!pomeriumConfig.enabled || (!hasRoutes && !hasAuthUrl)) {
    return config;
  }

  // Add Pomerium backend
  config.backends.push(generatePomeriumBackend(pomeriumConfig.internalUrl));

  // Get frontends
  const httpFrontend = config.frontends.find((f) => f.name === "http_front");
  const httpsFrontend = config.frontends.find((f) => f.name === "https_front");

  // Apply Pomerium protection to each domain that has protected routes
  if (hasRoutes) {
    for (const domain of domains) {
      if (httpFrontend) {
        applyPomeriumProtection(httpFrontend, pomeriumConfig, domain.id, domain.hostname);
      }
      if (httpsFrontend && domain.sslEnabled) {
        applyPomeriumProtection(httpsFrontend, pomeriumConfig, domain.id, domain.hostname);
      }
    }
  }

  // Route authenticate service URL hostname directly to pomerium_backend
  if (hasAuthUrl) {
    applyPomeriumAuthenticateRoute(httpFrontend, httpsFrontend, pomeriumConfig.authenticateServiceUrl!);
  }

  return config;
}

/**
 * Generate and render HAProxy config with Pomerium access control
 */
export function generateHAProxyConfigWithPomeriumString(
  domains: DomainConfig[],
  pomeriumConfig: PomeriumConfig,
  options?: {
    certsDir?: string;
    errorPagesDir?: string;
  }
): string {
  const config = generateHAProxyConfigWithPomerium(domains, pomeriumConfig, options);
  return renderHAProxyConfig(config);
}

/**
 * Generate analytics backend for HAProxy config.
 */
export function generateAnalyticsBackend(
  config: AnalyticsBackendConfig = { host: "analytics", port: 3003 }
): HAProxyBackend {
  return {
    name: "analytics_backend",
    mode: "http",
    loadBalanceMethod: "roundrobin",
    servers: [
      {
        name: "analytics",
        address: config.host,
        port: config.port,
        weight: 100,
        healthCheck: {
          enabled: true,
          path: "/health",
          interval: 5,
          timeout: 3,
          fall: 3,
          rise: 2,
        },
      },
    ],
    httpCheck: {
      path: "/health",
      expectStatus: 200,
      host: config.host,
    },
    timeoutTunnel: "3600s",
    maxconn: 1000,
  };
}

/**
 * Apply analytics routing ACLs to a frontend.
 * Analytics ACLs are inserted before regular domain routing rules.
 *
 * When applied to the HTTP frontend and an HTTPS frontend exists,
 * a redirect rule is added to enforce HTTPS for /_upm/ paths so
 * that analytics beacon and script traffic is always encrypted.
 */
function applyAnalyticsRoutes(
  frontend: HAProxyFrontend,
  analyticsRoutes: AnalyticsRouteConfig[],
  options?: { enforceHttpsRedirect?: boolean }
): void {
  const enabledRoutes = analyticsRoutes.filter((r) => r.enabled);
  if (enabledRoutes.length === 0) return;

  // Enforce HTTPS for analytics paths on the HTTP frontend when SSL is available
  if (options?.enforceHttpsRedirect) {
    const analyticsPathAclName = "analytics_upm_path";
    frontend.acls.push({
      name: analyticsPathAclName,
      condition: "path_beg /_upm/",
    });
    frontend.httpRequestRules = frontend.httpRequestRules || [];
    frontend.httpRequestRules.push(
      `redirect scheme https code 301 if !{ ssl_fc } ${analyticsPathAclName}`
    );
  }

  const analyticsUseBackends: HAProxyUseBackend[] = [];

  for (const route of enabledRoutes) {
    // Validate trackingUuid format to prevent ACL injection.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(route.trackingUuid)) {
      console.warn(`[HAProxy] Skipping analytics route for ${route.hostname}: invalid tracking UUID`);
      continue;
    }

    const sanitizedDomain = sanitizeIdentifier(route.hostname);
    const hostAclName = `analytics_host_${sanitizedDomain}`;
    const pathAclName = `analytics_path_${sanitizedDomain}`;

    frontend.acls.push({
      name: hostAclName,
      condition: `hdr(host) -i ${route.hostname}`,
    });

    frontend.acls.push({
      name: pathAclName,
      condition: `path_beg /_upm/${route.trackingUuid}/`,
    });

    analyticsUseBackends.push({
      backendName: "analytics_backend",
      condition: `${hostAclName} ${pathAclName}`,
    });
  }

  frontend.useBackends.unshift(...analyticsUseBackends);
}

/**
 * Generate complete HAProxy configuration with all extensions
 * Combines domains, sites, and Pomerium access control
 */
export function generateCompleteHAProxyConfig(
  domains: DomainConfig[],
  options: {
    certsDir?: string;
    errorPagesDir?: string;
    sites?: SiteConfig[];
    executorConfig?: SitesExecutorConfig;
    pomerium?: PomeriumConfig;
    analytics?: {
      routes: AnalyticsRouteConfig[];
      backend?: AnalyticsBackendConfig;
    };
  } = {}
): HAProxyConfig {
  const { sites, executorConfig, pomerium } = options;
  const certsDir = options.certsDir || "/etc/haproxy/certs";

  // Start with sites if available, otherwise base domains
  let config: HAProxyConfig;
  if (sites && sites.length > 0 && executorConfig) {
    config = generateHAProxyConfigWithSites(domains, sites, executorConfig, options);
  } else {
    config = generateHAProxyConfig(domains, options);
  }

  // Get frontends for advanced config
  const httpFrontend = config.frontends.find((f) => f.name === "http_front");
  const httpsFrontend = config.frontends.find((f) => f.name === "https_front");

  // Apply advanced domain configuration (route rules, IP access, security headers, blocked routes)
  for (const domain of domains) {
    const hasAdvancedConfig =
      domain.routeRules?.length ||
      domain.ipAccessControl?.enabled ||
      domain.securityHeaders ||
      domain.blockedRoutes?.length;

    if (hasAdvancedConfig) {
      if (httpFrontend) {
        applyAdvancedDomainConfig(httpFrontend, domain);
      }
      if (httpsFrontend && domain.sslEnabled) {
        applyAdvancedDomainConfig(httpsFrontend, domain);
      }

      // Generate route rule backends if needed
      if (domain.routeRules?.length) {
        const routeBackends = generateRouteRuleBackends(
          domain.id,
          domain.hostname,
          domain.routeRules,
          config.backends,
          domain.backends // Pass domain backend configs for proper backend lookup
        );
        config.backends.push(...routeBackends);
      }
    }
  }

  // Apply Pomerium protection if enabled
  const pomeriumHasRoutes = pomerium?.enabled && pomerium.routes.length > 0;
  const pomeriumHasAuthUrl = pomerium?.enabled && !!pomerium.authenticateServiceUrl;

  if (pomeriumHasRoutes || pomeriumHasAuthUrl) {
    // Add Pomerium backend
    config.backends.push(generatePomeriumBackend(pomerium!.internalUrl));

    // Get frontends
    const httpFrontend = config.frontends.find((f) => f.name === "http_front");
    const httpsFrontend = config.frontends.find((f) => f.name === "https_front");

    if (pomeriumHasRoutes) {
      // Apply Pomerium protection to domains
      for (const domain of domains) {
        if (httpFrontend) {
          applyPomeriumProtection(httpFrontend, pomerium!, domain.id, domain.hostname);
        }
        if (httpsFrontend && domain.sslEnabled) {
          applyPomeriumProtection(httpsFrontend, pomerium!, domain.id, domain.hostname);
        }
      }

      // Apply Pomerium protection to sites (if they have routes configured)
      if (sites) {
        for (const site of sites) {
          // Find any Pomerium routes that match this site's hostname
          const siteRoutes = pomerium!.routes.filter(r =>
            r.hostname === site.hostname && r.enabled
          );

          if (siteRoutes.length > 0 && httpFrontend) {
            // Create temporary domain ID for the site
            const siteDomainId = `site_${site.id}`;
            const siteConfig: PomeriumConfig = {
              ...pomerium!,
              routes: siteRoutes.map(r => ({ ...r, domainId: siteDomainId })),
            };
            applyPomeriumProtection(httpFrontend, siteConfig, siteDomainId, site.hostname);
          }

          if (siteRoutes.length > 0 && httpsFrontend && site.sslEnabled) {
            const siteDomainId = `site_${site.id}`;
            const siteConfig: PomeriumConfig = {
              ...pomerium!,
              routes: siteRoutes.map(r => ({ ...r, domainId: siteDomainId })),
            };
            applyPomeriumProtection(httpsFrontend, siteConfig, siteDomainId, site.hostname);
          }
        }
      }
    }

    // Route authenticate service URL hostname directly to pomerium_backend
    if (pomeriumHasAuthUrl) {
      applyPomeriumAuthenticateRoute(httpFrontend, httpsFrontend, pomerium!.authenticateServiceUrl!);
    }
  }

  // Apply analytics routes if enabled
  if (options.analytics?.routes && options.analytics.routes.length > 0) {
    config.backends.push(generateAnalyticsBackend(options.analytics.backend));

    const httpFrontend = config.frontends.find((f) => f.name === "http_front");
    const httpsFrontend = config.frontends.find((f) => f.name === "https_front");

    // On the HTTP frontend, enforce HTTPS redirect for /_upm/ paths
    // when an HTTPS frontend is available, ensuring analytics traffic
    // is always encrypted.
    if (httpFrontend) {
      applyAnalyticsRoutes(httpFrontend, options.analytics.routes, {
        enforceHttpsRedirect: !!httpsFrontend,
      });
    }
    if (httpsFrontend) applyAnalyticsRoutes(httpsFrontend, options.analytics.routes);
  }

  return config;
}

/**
 * Generate and render complete HAProxy config with all extensions
 */
export function generateCompleteHAProxyConfigString(
  domains: DomainConfig[],
  options?: {
    certsDir?: string;
    errorPagesDir?: string;
    sites?: SiteConfig[];
    executorConfig?: SitesExecutorConfig;
    pomerium?: PomeriumConfig;
    analytics?: {
      routes: AnalyticsRouteConfig[];
      backend?: AnalyticsBackendConfig;
    };
  }
): string {
  const config = generateCompleteHAProxyConfig(domains, options);
  return renderHAProxyConfig(config);
}
