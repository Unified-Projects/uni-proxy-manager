import { type Job, Queue } from "bullmq";
import { db } from "@uni-proxy-manager/database";
import {
  pomeriumSettings,
  pomeriumIdentityProviders,
  pomeriumRoutes,
  backends,
  type PomeriumIdentityProvider,
  type PomeriumRoute,
  type PomeriumSettings,
  type GoogleIdpCredentials,
  type AzureIdpCredentials,
  type GitHubIdpCredentials,
  type OidcIdpCredentials,
} from "@uni-proxy-manager/database/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import * as yaml from "yaml";
import { Document, visit as yamlVisit } from "yaml";
import http from "http";
import { getRedisClient } from "@uni-proxy-manager/shared/redis";
import type {
  PomeriumConfigJobData,
  PomeriumConfigResult,
  HaproxyReloadJobData,
} from "@uni-proxy-manager/queue";
import { QUEUES } from "@uni-proxy-manager/queue";

const POMERIUM_CONTAINER_NAME =
  process.env.POMERIUM_CONTAINER_NAME || "uni-proxy-pomerium";
const DOCKER_SOCKET_PATH =
  process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock";

const POMERIUM_CONFIG_PATH =
  process.env.POMERIUM_CONFIG_PATH || "/config/config.yaml";

// PPL (Pomerium Policy Language) types
type PPLCondition = Record<string, unknown>;
type PPLRule = { allow?: { and?: PPLCondition[]; or?: PPLCondition[] } };

interface PomeriumPolicyRoute {
  from: string;
  prefix?: string;
  path?: string;
  regex?: string;
  to?: string | string[];
  policy?: PPLRule[];
  allow_any_authenticated_user?: boolean;
  allow_public_unauthenticated_access?: boolean;
  cors_allow_preflight?: boolean;
  pass_identity_headers?: boolean;
  set_request_headers?: Record<string, string>;
  remove_request_headers?: string[];
  timeout?: string;
  idle_timeout?: string;
  allow_websockets?: boolean;
  preserve_host_header?: boolean;
  tls_skip_verify?: boolean;
}

interface PomeriumConfig {
  address?: string;
  insecure_server?: boolean;
  authenticate_service_url?: string;
  shared_secret?: string;
  cookie_secret?: string;
  signing_key?: string;
  cookie_name?: string;
  cookie_expire?: string;
  cookie_domain?: string;
  cookie_http_only?: boolean;
  cookie_secure?: boolean;
  log_level?: string;
  idp_provider?: string;
  idp_client_id?: string;
  idp_client_secret?: string;
  idp_provider_url?: string;
  idp_scopes?: string[];
  routes?: PomeriumPolicyRoute[];
}

export async function processPomeriumConfig(
  job: Job<PomeriumConfigJobData>
): Promise<PomeriumConfigResult> {
  const { reason, triggeredBy } = job.data;

  console.log(
    `[Pomerium Config] Regenerating config: ${reason} (triggered by: ${triggeredBy || "unknown"})`
  );

  try {
    // Fetch settings
    const settings = await db.query.pomeriumSettings.findFirst({
      where: eq(pomeriumSettings.id, "default"),
    });

    if (!settings?.enabled) {
      console.log(
        "[Pomerium Config] Pomerium is disabled, generating empty config"
      );
      await writeEmptyConfig();
      return { success: true, routesConfigured: 0, idpsConfigured: 0 };
    }

    // Fetch all enabled IdPs
    const idps = await db.query.pomeriumIdentityProviders.findMany({
      where: eq(pomeriumIdentityProviders.enabled, true),
    });

    // Fetch all enabled routes with their domains and backends
    const routes = await db.query.pomeriumRoutes.findMany({
      where: eq(pomeriumRoutes.enabled, true),
      with: {
        identityProvider: true,
        domain: {
          with: {
            backends: {
              where: and(
                eq(backends.enabled, true),
                eq(backends.backendType, "static"),
                isNotNull(backends.address)
              ),
            },
          },
        },
      },
      orderBy: (t, { asc }) => [asc(t.priority)],
    });

    // Generate Pomerium policy config
    const policyConfig = generatePolicyConfig(settings, idps, routes);

    // Ensure config directory exists
    await mkdir(dirname(POMERIUM_CONFIG_PATH), { recursive: true });

    const yamlContent = configToYaml(policyConfig);
    await writeFile(POMERIUM_CONFIG_PATH, yamlContent, "utf-8");

    console.log(
      `[Pomerium Config] Config written to ${POMERIUM_CONFIG_PATH} with ${routes.length} routes`
    );

    // Signal Pomerium to reload the policy file
    await signalPomeriumReload();

    // Trigger HAProxy reload since protected routes affect HAProxy config
    await triggerHaproxyReload("Pomerium config updated");

    return {
      success: true,
      configPath: POMERIUM_CONFIG_PATH,
      routesConfigured: routes.length,
      idpsConfigured: idps.length,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(
      "[Pomerium Config] Failed to regenerate config:",
      errorMessage
    );
    return { success: false, error: errorMessage };
  }
}

/**
 * Serialize Pomerium config to YAML.
 * Uses plain scalars by default (clean output) but double-quotes any string
 * that contains YAML 1.1 flow indicators ([ ] { }) which Go's yaml parser
 * doesn't allow in plain scalars.
 */
function configToYaml(config: PomeriumConfig): string {
  const doc = new Document(config);
  // Nodes created from JS objects have type=undefined (not "PLAIN"),
  // so check for problematic characters without a type guard.
  yamlVisit(doc, {
    Scalar(_, node) {
      if (
        typeof node.value === "string" &&
        (
          node.value.includes("[") ||
          node.value.includes("]") ||
          node.value.includes("{") ||
          node.value.includes("}") ||
          node.value.startsWith(":")
        )
      ) {
        node.type = "QUOTE_DOUBLE";
      }
    },
  });
  return doc.toString();
}

async function writeEmptyConfig(): Promise<void> {
  await mkdir(dirname(POMERIUM_CONFIG_PATH), { recursive: true });
  const emptyConfig: PomeriumConfig = {
    routes: [],
  };
  await writeFile(POMERIUM_CONFIG_PATH, configToYaml(emptyConfig), "utf-8");
}

async function signalPomeriumReload(): Promise<void> {
  return new Promise((resolve) => {
    const options = {
      socketPath: DOCKER_SOCKET_PATH,
      path: `/containers/${POMERIUM_CONTAINER_NAME}/kill?signal=SIGHUP`,
      method: "POST",
    };

    console.log(`[Pomerium Config] Attempting SIGHUP via Docker socket: ${DOCKER_SOCKET_PATH}, container: ${POMERIUM_CONTAINER_NAME}`);

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode === 204 || res.statusCode === 200) {
          console.log(
            `[Pomerium Config] Sent SIGHUP to ${POMERIUM_CONTAINER_NAME}`
          );
        } else {
          console.warn(
            `[Pomerium Config] SIGHUP to ${POMERIUM_CONTAINER_NAME} returned ${res.statusCode}: ${data}`
          );
        }
        resolve();
      });
    });

    req.on("error", (error) => {
      console.warn(
        `[Pomerium Config] Failed to send SIGHUP to ${POMERIUM_CONTAINER_NAME} (socket: ${DOCKER_SOCKET_PATH}):`,
        error.message
      );
      resolve();
    });

    req.setTimeout(10000, () => {
      req.destroy();
      console.warn(
        `[Pomerium Config] SIGHUP signal to ${POMERIUM_CONTAINER_NAME} timed out`
      );
      resolve();
    });

    req.end();
  });
}

async function triggerHaproxyReload(reason: string): Promise<void> {
  try {
    const redis = getRedisClient();
    const queue = new Queue<HaproxyReloadJobData>(QUEUES.HAPROXY_RELOAD, {
      connection: redis,
    });
    await queue.add(
      `haproxy-reload-pomerium-${Date.now()}`,
      { reason, triggeredBy: "pomerium-config" },
      { jobId: `haproxy-reload-pomerium-${Date.now()}` }
    );
    console.log("[Pomerium Config] HAProxy reload queued");
  } catch (error) {
    console.error("[Pomerium Config] Failed to queue HAProxy reload:", error);
  }
}

type RouteWithRelations = PomeriumRoute & {
  identityProvider: PomeriumIdentityProvider | null;
  domain:
    | ({
        id: string;
        hostname: string;
        backends: {
          id: string;
          address: string | null;
          port: number | null;
          protocol: "http" | "https";
        }[];
      } & Record<string, unknown>)
    | null;
};

function generatePolicyConfig(
  settings: PomeriumSettings,
  idps: PomeriumIdentityProvider[],
  routes: RouteWithRelations[]
): PomeriumConfig {
  const config: PomeriumConfig = {};

  // Fixed HTTP address, run without TLS so HAProxy health checks and internal
  // fetches can reach Pomerium over plain HTTP
  config.address = ":80";
  config.insecure_server = true;

  // Secrets - required for Pomerium to load routes
  if (settings.sharedSecret) {
    config.shared_secret = settings.sharedSecret;
  }
  if (settings.cookieSecret) {
    config.cookie_secret = settings.cookieSecret;
  }
  if (settings.signingKey) {
    // signing_key must be base64-encoded PEM - skip if it's not valid PEM data
    // (Pomerium will fatal and load zero routes if an invalid signing_key is provided)
    const decoded = Buffer.from(settings.signingKey, "base64").toString("utf-8");
    if (decoded.includes("-----BEGIN")) {
      config.signing_key = settings.signingKey;
    } else {
      console.warn(
        "[Pomerium Config] signing_key in DB is not valid base64-encoded PEM, skipping"
      );
    }
  }

  // Cookie and auth settings
  if (settings.authenticateServiceUrl) {
    config.authenticate_service_url = settings.authenticateServiceUrl;
  }
  config.cookie_name = settings.cookieName || "_pomerium";
  config.cookie_expire = settings.cookieExpire || "14h";
  if (settings.cookieDomain) {
    config.cookie_domain = settings.cookieDomain;
  }
  config.cookie_http_only = settings.cookieHttpOnly ?? true;
  if (settings.cookieSecure !== null && settings.cookieSecure !== undefined) {
    config.cookie_secure = settings.cookieSecure;
  }
  config.log_level = settings.logLevel || "info";

  // Build IdP configuration based on default IdP
  const defaultIdp = idps.find((i) => i.isDefault) || idps[0];

  if (defaultIdp) {
    const idpConfig = buildIdpConfig(defaultIdp);
    Object.assign(config, idpConfig);
  }

  // Generate routes - only include routes that have domains with backends
  config.routes = routes
    .filter((r) => r.domain && r.domain.backends && r.domain.backends.length > 0)
    .map((route) => buildRoutePolicy(route));

  return config;
}

function buildIdpConfig(
  idp: PomeriumIdentityProvider
): Partial<PomeriumConfig> {
  const credentials = idp.credentials;

  switch (idp.type) {
    case "google": {
      const creds = credentials as GoogleIdpCredentials;
      return {
        idp_provider: "google",
        idp_client_id: creds.clientId,
        idp_client_secret: creds.clientSecret,
      };
    }

    case "azure": {
      const creds = credentials as AzureIdpCredentials;
      return {
        idp_provider: "azure",
        idp_client_id: creds.clientId,
        idp_client_secret: creds.clientSecret,
        idp_provider_url: `https://login.microsoftonline.com/${creds.tenantId}/v2.0`,
      };
    }

    case "github": {
      const creds = credentials as GitHubIdpCredentials;
      return {
        idp_provider: "github",
        idp_client_id: creds.clientId,
        idp_client_secret: creds.clientSecret,
      };
    }

    case "oidc": {
      const creds = credentials as OidcIdpCredentials;
      return {
        idp_provider: "oidc",
        idp_client_id: creds.clientId,
        idp_client_secret: creds.clientSecret,
        idp_provider_url: creds.issuerUrl,
        idp_scopes: creds.scopes,
      };
    }

    default:
      return {};
  }
}

/**
 * Build per-route IdP config for skipping auth selection page
 */
function buildRoutePolicy(route: RouteWithRelations): PomeriumPolicyRoute {
  const hostname = route.domain?.hostname || "localhost";
  const policyRoute: PomeriumPolicyRoute = {
    from: `https://${hostname}`,
  };

  // Populate `to` destinations from the domain's enabled static backends.
  // Use a plain string for single backends (matches Pomerium's expected format),
  // and an array only when there are multiple.
  const enabledBackends = route.domain?.backends ?? [];
  const destinations = enabledBackends
    .filter((b) => b.address)
    .map((b) => `${b.protocol}://${b.address}:${b.port ?? 80}`);
  if (destinations.length === 1) {
    policyRoute.to = destinations[0];
  } else if (destinations.length > 1) {
    policyRoute.to = destinations;
  }

  // Handle path pattern
  const pathPattern = route.pathPattern || "/*";
  if (pathPattern === "/*" || pathPattern === "/**") {
    // Match all paths - no prefix needed
  } else if (pathPattern.includes("**")) {
    // Recursive glob - convert to anchored regex
    policyRoute.regex =
      "^" +
      pathPattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") +
      "(/.*)?$";
  } else if (pathPattern.includes("*") || pathPattern.includes("(")) {
    // Glob or regex-like pattern - convert to anchored regex
    policyRoute.regex =
      "^" + pathPattern.replace(/\*/g, "[^/]*") + "(/.*)?$";
  } else {
    // Exact prefix
    policyRoute.prefix = pathPattern;
  }

  // Handle protection level
  if (route.protection === "public") {
    policyRoute.allow_public_unauthenticated_access = true;
  } else if (route.protection === "protected") {
    const cfg = route.policyConfig || {};

    // Build PPL policy block (required in modern Pomerium — direct route-level
    // allow_any_authenticated_user / allowed_users etc. are deprecated)
    const orConditions: PPLCondition[] = [];

    if (cfg.allowedUsers?.length) {
      for (const email of cfg.allowedUsers) {
        orConditions.push({ email: { is: email } });
      }
    }
    if (cfg.allowedGroups?.length) {
      for (const group of cfg.allowedGroups) {
        orConditions.push({ "claim/groups": group });
      }
    }
    if (cfg.allowedDomains?.length) {
      for (const domain of cfg.allowedDomains) {
        orConditions.push({ email: { ends_with: `@${domain}` } });
      }
    }

    if (orConditions.length > 0) {
      policyRoute.policy = [{ allow: { or: orConditions } }];
    } else {
      // No specific restrictions — allow any authenticated user
      policyRoute.allow_any_authenticated_user = true;
    }

    // Additional route options
    // Always preserve the original Host header so backends see the public
    // hostname (e.g. yneb.uk) and build correct redirect URLs, not the
    // internal backend address. Can be opted out via policyConfig.
    policyRoute.preserve_host_header = cfg.preserveHostHeader !== false;

    if (cfg.corsAllowPreflight) {
      policyRoute.cors_allow_preflight = true;
    }
    if (cfg.passIdentityHeaders !== false) {
      policyRoute.pass_identity_headers = true;
    }
    // Always tell backends the original scheme was HTTPS so they generate
    // correct URLs. Pomerium connects to backends over plain HTTP so without
    // this backends (e.g. WordPress) generate http:// redirect URLs.
    policyRoute.set_request_headers = {
      "X-Forwarded-Proto": "https",
      ...cfg.setRequestHeaders,
    };
    if (cfg.removeRequestHeaders?.length) {
      policyRoute.remove_request_headers = cfg.removeRequestHeaders;
    }
    if (cfg.timeout) {
      policyRoute.timeout = `${cfg.timeout}s`;
    }
    if (cfg.idleTimeout) {
      policyRoute.idle_timeout = `${cfg.idleTimeout}s`;
    }
    if (cfg.websocketsEnabled) {
      policyRoute.allow_websockets = true;
    }
    if (cfg.tlsSkipVerify) {
      policyRoute.tls_skip_verify = true;
    }
  }
  // passthrough - no policy restrictions, backend handles auth

  return policyRoute;
}
