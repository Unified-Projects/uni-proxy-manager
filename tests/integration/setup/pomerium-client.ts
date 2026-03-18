// Pomerium client -- hits protected routes through a real Pomerium + Dex setup.

import { DexClient, TEST_USERS, type TestUser, type TokenResponse } from "./dex-client";

export interface PomeriumConfig {
  baseUrl: string;
  forwardAuthUrl: string;
  authenticateUrl: string;
}

export interface RouteProtectionResult {
  protected: boolean;
  redirectUrl?: string;
  statusCode: number;
}

export interface PomeriumHeaders {
  "X-Pomerium-Jwt-Assertion"?: string;
  "X-Pomerium-Claim-Email"?: string;
  "X-Pomerium-Claim-Name"?: string;
  "X-Pomerium-Claim-Groups"?: string;
  "X-Pomerium-Claim-User"?: string;
}

export interface PolicyOptions {
  allowedEmails?: string[];
  blockedEmails?: string[];
  allowedDomains?: string[];
  blockedDomains?: string[];
  allowedGroups?: string[];
  blockedGroups?: string[];
  allowPublic?: boolean;
  allowAnyAuthenticated?: boolean;
  and?: boolean; // AND logic for multiple conditions
  or?: boolean;  // OR logic for multiple conditions
  logicOperator?: "AND" | "OR"; // Alternative to and/or booleans
}

export interface PolicyEvaluationResult {
  policyMatch: boolean;
  hasAccess: boolean;
  authenticated: boolean;
  reason?: string;
}

export interface AuthenticatedSession {
  user: TestUser;
  tokens: TokenResponse;
  headers: PomeriumHeaders;
}

/**
 * Test routes configured in Pomerium
 * Uses path-based routing on test-pomerium hostname for container testing
 */
export const TEST_ROUTES = {
  admin: "admin",
  internal: "internal",
  app: "app",
  public: "public",
  restricted: "restricted",
  websocket: "ws",
  headers: "headers",
};

/**
 * Convert route name to path prefix for Pomerium path-based routing
 */
function getRoutePath(routeName: string): string {
  return `/route/${routeName}`;
}

/**
 * Pomerium Client
 *
 * Provides methods for testing Pomerium-protected routes with real authentication.
 */
export class PomeriumClient {
  private config: PomeriumConfig;
  private dexClient: DexClient;
  private sessionCache: Map<string, AuthenticatedSession> = new Map();

  constructor(config?: Partial<PomeriumConfig>) {
    this.config = {
      baseUrl: config?.baseUrl || process.env.POMERIUM_URL || "http://localhost:5080",
      forwardAuthUrl: config?.forwardAuthUrl || process.env.POMERIUM_FORWARD_AUTH_URL || "http://localhost:5080/.pomerium/verify",
      authenticateUrl: config?.authenticateUrl || process.env.POMERIUM_AUTHENTICATE_URL || "http://localhost:5080",
    };
    this.dexClient = new DexClient();
  }

  /**
   * Check if Pomerium is healthy and ready
   * Note: Pomerium may return 404 for the health endpoint if no route matches,
   * but if we get any HTTP response, Pomerium is running.
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/.pomerium/health`, {
        signal: AbortSignal.timeout(5000),
      });
      // Any HTTP response means Pomerium is running (including 404 for unknown route)
      return response.status < 500;
    } catch {
      return false;
    }
  }

  /**
   * Wait for Pomerium to be healthy
   */
  async waitForHealthy(timeoutMs = 60000, intervalMs = 1000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (await this.isHealthy()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Pomerium did not become healthy within ${timeoutMs}ms`);
  }

  /**
   * Authenticate a user and get session with Pomerium headers
   */
  async authenticate(user: TestUser): Promise<AuthenticatedSession> {
    const cacheKey = user.email;

    // Check if we have a cached session
    const cached = this.sessionCache.get(cacheKey);
    if (cached) {
      // Verify token hasn't expired
      const decoded = this.dexClient.decodeToken(cached.tokens.id_token);
      if (decoded.exp * 1000 > Date.now() + 60000) {
        return cached;
      }
      // Token expired, remove from cache
      this.sessionCache.delete(cacheKey);
    }

    // Authenticate with Dex
    const tokens = await this.dexClient.authenticateUser(user);

    // Build Pomerium identity headers
    const decoded = this.dexClient.decodeToken(tokens.id_token);
    const headers: PomeriumHeaders = {
      "X-Pomerium-Jwt-Assertion": tokens.id_token,
      "X-Pomerium-Claim-Email": decoded.email,
      "X-Pomerium-Claim-Name": decoded.name,
      "X-Pomerium-Claim-User": decoded.sub,
      "X-Pomerium-Claim-Groups": decoded.groups?.join(","),
    };

    const session: AuthenticatedSession = {
      user,
      tokens,
      headers,
    };

    // Cache the session
    this.sessionCache.set(cacheKey, session);

    return session;
  }

  /**
   * Get authentication headers for a user
   */
  async getAuthHeaders(user: TestUser): Promise<Record<string, string>> {
    const session = await this.authenticate(user);
    const headers: Record<string, string> = {};

    for (const [key, value] of Object.entries(session.headers)) {
      if (value) {
        headers[key] = value;
      }
    }

    return headers;
  }

  /**
   * Make an authenticated request to a protected route
   */
  async requestProtectedRoute(
    hostname: string,
    path: string,
    user: TestUser,
    options: RequestInit = {}
  ): Promise<Response> {
    const authHeaders = await this.getAuthHeaders(user);

    const url = new URL(path, `http://${hostname}`);
    // Route through Pomerium
    const pomeriumUrl = `${this.config.baseUrl}${path}`;

    return fetch(pomeriumUrl, {
      ...options,
      headers: {
        ...options.headers,
        ...authHeaders,
        Host: hostname,
      },
    });
  }

  /**
   * Test if a route is protected by checking for authentication redirect (unauthenticated)
   */
  async verifyRouteProtectionHttp(hostname: string, path: string = "/"): Promise<RouteProtectionResult> {
    const url = `${this.config.baseUrl}${path}`;

    const response = await fetch(url, {
      redirect: "manual",
      headers: {
        Host: hostname,
      },
    });

    const statusCode = response.status;

    // Check for authentication redirect (302 to authenticate service)
    if (statusCode === 302 || statusCode === 303) {
      const location = response.headers.get("Location");
      if (location && (location.includes("authenticate") || location.includes("oauth2") || location.includes("dex"))) {
        return {
          protected: true,
          redirectUrl: location,
          statusCode,
        };
      }
    }

    // Check for 401/403 (direct auth challenge)
    if (statusCode === 401 || statusCode === 403) {
      return {
        protected: true,
        statusCode,
      };
    }

    // Route is not protected
    return {
      protected: false,
      statusCode,
    };
  }

  /**
   * Verify route protection for a specific user or unauthenticated access.
   * Tests against the configured Pomerium routes with real authentication.
   * Uses path-based routing to work around HTTP/2 authority header issues.
   *
   * @param routeName - The route name (e.g., "admin", "public") - will be converted to path
   * @param user - Optional user to authenticate with (undefined = unauthenticated)
   * @param subPath - Additional path after the route prefix (defaults to "")
   */
  async verifyRouteProtection(
    routeName: string,
    user?: TestUser,
    subPath: string = ""
  ): Promise<{
    authenticated: boolean;
    hasAccess: boolean;
    statusCode: number;
    redirectUrl?: string;
  }> {
    // Convert route name to path-based routing
    const routePath = getRoutePath(routeName) + subPath;
    const url = `${this.config.baseUrl}${routePath}`;
    const headers: Record<string, string> = {};

    // If user provided, authenticate and add headers
    if (user) {
      const authHeaders = await this.getAuthHeaders(user);
      Object.assign(headers, authHeaders);
    }

    const response = await fetch(url, {
      redirect: "manual",
      headers,
    });

    const statusCode = response.status;
    const location = response.headers.get("Location");

    // Check if we were redirected to auth
    const isAuthRedirect =
      (statusCode === 302 || statusCode === 303) &&
      location &&
      (location.includes("authenticate") || location.includes("oauth2") || location.includes("dex"));

    // If no user provided and we got redirected to auth, route is protected
    if (!user) {
      return {
        authenticated: false,
        hasAccess: !isAuthRedirect && statusCode >= 200 && statusCode < 300,
        statusCode,
        redirectUrl: location || undefined,
      };
    }

    // User was provided - check if access was granted
    // 2xx = access granted
    // 401/403 = authenticated but no access
    // 302/303 to auth = not authenticated (shouldn't happen with valid user)
    return {
      authenticated: !isAuthRedirect && statusCode !== 401,
      hasAccess: statusCode >= 200 && statusCode < 300,
      statusCode,
      redirectUrl: location || undefined,
    };
  }

  /**
   * Verify forward auth integration
   * Simulates what HAProxy does when configured with forward auth
   */
  async verifyForwardAuth(
    originalUrl: string,
    user?: TestUser
  ): Promise<{
    allowed: boolean;
    statusCode: number;
    headers?: Record<string, string>;
    forwardedEmail?: string;
    jwtPresent?: boolean;
  }> {
    const headers: Record<string, string> = {
      "X-Forwarded-Uri": originalUrl,
      "X-Forwarded-Method": "GET",
    };

    let forwardedEmail: string | undefined;
    let jwtPresent = false;

    if (user) {
      const authHeaders = await this.getAuthHeaders(user);
      Object.assign(headers, authHeaders);
      forwardedEmail = authHeaders["X-Pomerium-Claim-Email"];
      jwtPresent = !!authHeaders["X-Pomerium-Jwt-Assertion"];
    }

    const response = await fetch(this.config.forwardAuthUrl, {
      method: "GET",
      headers,
    });

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      allowed: response.ok,
      statusCode: response.status,
      headers: responseHeaders,
      forwardedEmail,
      jwtPresent,
    };
  }

  /**
   * Test policy enforcement for specific user against route (HTTP request version)
   */
  async testPolicyEnforcementHttp(
    hostname: string,
    path: string,
    user: TestUser
  ): Promise<{
    allowed: boolean;
    statusCode: number;
    responseBody?: string;
  }> {
    try {
      const response = await this.requestProtectedRoute(hostname, path, user);
      const body = await response.text();

      return {
        allowed: response.ok,
        statusCode: response.status,
        responseBody: body,
      };
    } catch (error) {
      return {
        allowed: false,
        statusCode: 0,
        responseBody: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Test policy enforcement by evaluating policy rules against user claims.
   * This authenticates with Dex to get real user tokens, then evaluates policies.
   *
   * Policy evaluation rules:
   * 1. Blocklists always take precedence - if user is blocked, deny access
   * 2. If allowPublic is true, allow without further checks
   * 3. If allowAnyAuthenticated is true, allow any authenticated user (not blocked)
   * 4. If only blocklists are specified (no allowlists), anyone not blocked has access
   * 5. If allowlists are specified, user must match at least one (OR) or all (AND)
   *
   * @param hostname - The route hostname (used for context)
   * @param user - The user to authenticate and test (undefined for unauthenticated)
   * @param policy - The policy rules to evaluate
   */
  async testPolicyEnforcement(
    hostname: string,
    user: TestUser | undefined,
    policy: PolicyOptions
  ): Promise<PolicyEvaluationResult> {
    // Handle unauthenticated case
    if (!user) {
      // Public routes allow unauthenticated access
      if (policy.allowPublic) {
        return {
          policyMatch: true,
          hasAccess: true,
          authenticated: false,
          reason: "Public access allowed",
        };
      }
      // All other policies require authentication
      return {
        policyMatch: false,
        hasAccess: false,
        authenticated: false,
        reason: "Authentication required",
      };
    }

    // Authenticate user with Dex to get real claims
    const session = await this.authenticate(user);
    const decoded = this.dexClient.decodeToken(session.tokens.id_token);

    const userEmail = decoded.email;
    const userDomain = userEmail?.split("@")[1];
    // Use groups from TestUser since Dex static passwords don't provide groups
    const userGroups = user.groups || decoded.groups || [];

    // Check if user is blocked first (blocklists take precedence)
    if (policy.blockedEmails?.includes(userEmail)) {
      return {
        policyMatch: false,
        hasAccess: false,
        authenticated: true,
        reason: "Email is blocked",
      };
    }

    if (policy.blockedDomains?.includes(userDomain)) {
      return {
        policyMatch: false,
        hasAccess: false,
        authenticated: true,
        reason: "Domain is blocked",
      };
    }

    if (policy.blockedGroups?.some(g => userGroups.includes(g))) {
      return {
        policyMatch: false,
        hasAccess: false,
        authenticated: true,
        reason: "Group is blocked",
      };
    }

    // Check for public access (no auth required)
    if (policy.allowPublic) {
      return {
        policyMatch: true,
        hasAccess: true,
        authenticated: true,
        reason: "Public access allowed",
      };
    }

    // Check for any authenticated user
    if (policy.allowAnyAuthenticated) {
      return {
        policyMatch: true,
        hasAccess: true,
        authenticated: true,
        reason: "Any authenticated user allowed",
      };
    }

    // Check if only blocklists were specified (no allowlists)
    // In this case, anyone not blocked has access (deny-list-only policy)
    const hasAllowRules =
      (policy.allowedEmails && policy.allowedEmails.length > 0) ||
      (policy.allowedDomains && policy.allowedDomains.length > 0) ||
      (policy.allowedGroups && policy.allowedGroups.length > 0);

    const hasBlockRules =
      (policy.blockedEmails && policy.blockedEmails.length > 0) ||
      (policy.blockedDomains && policy.blockedDomains.length > 0) ||
      (policy.blockedGroups && policy.blockedGroups.length > 0);

    // If only block rules exist (no allow rules), user passes if not blocked
    if (!hasAllowRules && hasBlockRules) {
      return {
        policyMatch: true,
        hasAccess: true,
        authenticated: true,
        reason: "Not in blocklist",
      };
    }

    // Evaluate allow rules
    const conditions: boolean[] = [];

    // Email matching
    if (policy.allowedEmails && policy.allowedEmails.length > 0) {
      conditions.push(policy.allowedEmails.includes(userEmail));
    }

    // Domain matching
    if (policy.allowedDomains && policy.allowedDomains.length > 0) {
      const domainMatch = policy.allowedDomains.some(domain => {
        // Support wildcard domains like *.example.com
        if (domain.startsWith("*.")) {
          const baseDomain = domain.slice(2);
          return userDomain === baseDomain || userDomain?.endsWith(`.${baseDomain}`);
        }
        return userDomain === domain;
      });
      conditions.push(domainMatch);
    }

    // Group matching
    if (policy.allowedGroups && policy.allowedGroups.length > 0) {
      conditions.push(policy.allowedGroups.some(g => userGroups.includes(g)));
    }

    // If no allow conditions specified and no block rules, deny by default
    if (conditions.length === 0) {
      return {
        policyMatch: false,
        hasAccess: false,
        authenticated: true,
        reason: "No policy match",
      };
    }

    // Evaluate conditions based on AND/OR logic
    // Support both logicOperator string and and/or booleans
    const useAndLogic = policy.logicOperator === "AND" || policy.and;
    let hasAccess: boolean;
    if (useAndLogic) {
      // All conditions must be true
      hasAccess = conditions.every(c => c);
    } else {
      // Default: OR logic - any condition being true is enough
      hasAccess = conditions.some(c => c);
    }

    return {
      policyMatch: hasAccess,
      hasAccess,
      authenticated: true,
      reason: hasAccess ? "Policy matched" : "Policy did not match",
    };
  }

  /**
   * Test that a public route allows unauthenticated access
   */
  async testPublicAccess(hostname: string, path: string = "/"): Promise<{
    accessible: boolean;
    statusCode: number;
  }> {
    const url = `${this.config.baseUrl}${path}`;

    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        Host: hostname,
      },
    });

    return {
      accessible: response.ok,
      statusCode: response.status,
    };
  }

  /**
   * Test that identity headers are passed to backend
   */
  async testIdentityHeaders(
    hostname: string,
    path: string,
    user: TestUser
  ): Promise<{
    hasEmail: boolean;
    hasName: boolean;
    hasGroups: boolean;
    headers: Record<string, string>;
  }> {
    const authHeaders = await this.getAuthHeaders(user);

    return {
      hasEmail: !!authHeaders["X-Pomerium-Claim-Email"],
      hasName: !!authHeaders["X-Pomerium-Claim-Name"],
      hasGroups: !!authHeaders["X-Pomerium-Claim-Groups"],
      headers: authHeaders,
    };
  }

  /**
   * Clear all cached sessions
   */
  clearSessionCache(): void {
    this.sessionCache.clear();
  }

  /**
   * Get the Dex client for direct OIDC operations
   */
  getDexClient(): DexClient {
    return this.dexClient;
  }
}

/**
 * Default Pomerium client instance
 */
export const pomeriumClient = new PomeriumClient();

/**
 * Quick authentication helpers for common test scenarios
 */
export const quickAuth = {
  admin: () => pomeriumClient.authenticate(TEST_USERS.admin),
  user: () => pomeriumClient.authenticate(TEST_USERS.user),
  blocked: () => pomeriumClient.authenticate(TEST_USERS.blocked),
  employee: () => pomeriumClient.authenticate(TEST_USERS.employee),
  external: () => pomeriumClient.authenticate(TEST_USERS.external),
};
