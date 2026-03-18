/**
 * Pomerium Test Fixtures
 *
 * Factory functions for creating Pomerium test data.
 */

import { nanoid, customAlphabet } from "nanoid";

const nanoidAlphanumeric = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyz",
  8
);

/**
 * Identity Provider Types
 */
export type PomeriumIdpType = "google" | "azure" | "github" | "oidc";

/**
 * Route Protection Levels
 */
export type PomeriumProtectionLevel = "protected" | "public" | "passthrough";

/**
 * OIDC Credentials structure
 */
export interface OidcCredentials {
  clientId: string;
  clientSecret: string;
  issuerUrl: string;
  scopes?: string[];
}

/**
 * Google Credentials structure
 */
export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
  hostedDomain?: string;
}

/**
 * Azure Credentials structure
 */
export interface AzureCredentials {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}

/**
 * GitHub Credentials structure
 */
export interface GitHubCredentials {
  clientId: string;
  clientSecret: string;
  allowedOrganizations?: string[];
  allowedTeams?: string[];
}

/**
 * Pomerium Policy Configuration
 */
export interface PomeriumPolicyConfig {
  allowedUsers?: string[];
  allowedGroups?: string[];
  allowedDomains?: string[];
  allowedEmailPatterns?: string[];
  corsAllowPreflight?: boolean;
  passIdentityHeaders?: boolean;
  setRequestHeaders?: Record<string, string>;
  removeRequestHeaders?: string[];
  timeout?: number;
  idleTimeout?: number;
  websocketsEnabled?: boolean;
  preserveHostHeader?: boolean;
  tlsSkipVerify?: boolean;
}

/**
 * Create an OIDC Identity Provider fixture
 */
export function createPomeriumOidcIdpFixture(
  overrides: Partial<{
    name: string;
    displayName: string;
    issuerUrl: string;
    clientId: string;
    clientSecret: string;
    scopes: string[];
    enabled: boolean;
    isDefault: boolean;
  }> = {}
): {
  name: string;
  displayName: string;
  type: "oidc";
  credentials: OidcCredentials;
  enabled: boolean;
  isDefault: boolean;
} {
  return {
    name: overrides.name || `OIDC IdP ${nanoid(6)}`,
    displayName: overrides.displayName || "Test OIDC Provider",
    type: "oidc",
    credentials: {
      clientId: overrides.clientId || "test-client",
      clientSecret: overrides.clientSecret || "test-client-secret",
      issuerUrl: overrides.issuerUrl || process.env.DEX_ISSUER_URL || "http://localhost:5556/dex",
      scopes: overrides.scopes || ["openid", "email", "profile"],
    },
    enabled: overrides.enabled ?? true,
    isDefault: overrides.isDefault ?? false,
  };
}

/**
 * Create a Google Identity Provider fixture
 */
export function createPomeriumGoogleIdpFixture(
  overrides: Partial<{
    name: string;
    displayName: string;
    clientId: string;
    clientSecret: string;
    hostedDomain: string;
    enabled: boolean;
    isDefault: boolean;
  }> = {}
): {
  name: string;
  displayName: string;
  type: "google";
  credentials: GoogleCredentials;
  enabled: boolean;
  isDefault: boolean;
} {
  return {
    name: overrides.name || `Google IdP ${nanoid(6)}`,
    displayName: overrides.displayName || "Test Google Provider",
    type: "google",
    credentials: {
      clientId: overrides.clientId || "google-client-id.apps.googleusercontent.com",
      clientSecret: overrides.clientSecret || "google-client-secret",
      hostedDomain: overrides.hostedDomain,
    },
    enabled: overrides.enabled ?? true,
    isDefault: overrides.isDefault ?? false,
  };
}

/**
 * Create an Azure AD Identity Provider fixture
 */
export function createPomeriumAzureIdpFixture(
  overrides: Partial<{
    name: string;
    displayName: string;
    clientId: string;
    clientSecret: string;
    tenantId: string;
    enabled: boolean;
    isDefault: boolean;
  }> = {}
): {
  name: string;
  displayName: string;
  type: "azure";
  credentials: AzureCredentials;
  enabled: boolean;
  isDefault: boolean;
} {
  return {
    name: overrides.name || `Azure IdP ${nanoid(6)}`,
    displayName: overrides.displayName || "Test Azure AD Provider",
    type: "azure",
    credentials: {
      clientId: overrides.clientId || "azure-client-id",
      clientSecret: overrides.clientSecret || "azure-client-secret",
      tenantId: overrides.tenantId || "azure-tenant-id",
    },
    enabled: overrides.enabled ?? true,
    isDefault: overrides.isDefault ?? false,
  };
}

/**
 * Create a GitHub Identity Provider fixture
 */
export function createPomeriumGitHubIdpFixture(
  overrides: Partial<{
    name: string;
    displayName: string;
    clientId: string;
    clientSecret: string;
    allowedOrganizations: string[];
    allowedTeams: string[];
    enabled: boolean;
    isDefault: boolean;
  }> = {}
): {
  name: string;
  displayName: string;
  type: "github";
  credentials: GitHubCredentials;
  enabled: boolean;
  isDefault: boolean;
} {
  return {
    name: overrides.name || `GitHub IdP ${nanoid(6)}`,
    displayName: overrides.displayName || "Test GitHub Provider",
    type: "github",
    credentials: {
      clientId: overrides.clientId || "github-client-id",
      clientSecret: overrides.clientSecret || "github-client-secret",
      allowedOrganizations: overrides.allowedOrganizations || [],
      allowedTeams: overrides.allowedTeams || [],
    },
    enabled: overrides.enabled ?? true,
    isDefault: overrides.isDefault ?? false,
  };
}

/**
 * Create an Identity Provider fixture by type
 */
export function createPomeriumIdpFixture(
  type: PomeriumIdpType = "oidc",
  overrides: Record<string, unknown> = {}
) {
  switch (type) {
    case "google":
      return createPomeriumGoogleIdpFixture(overrides);
    case "azure":
      return createPomeriumAzureIdpFixture(overrides);
    case "github":
      return createPomeriumGitHubIdpFixture(overrides);
    case "oidc":
    default:
      return createPomeriumOidcIdpFixture(overrides);
  }
}

/**
 * Create a Pomerium Route fixture
 */
export function createPomeriumRouteFixture(
  domainId: string,
  overrides: Partial<{
    name: string;
    pathPattern: string;
    protection: PomeriumProtectionLevel;
    identityProviderId: string | null;
    policyConfig: PomeriumPolicyConfig;
    priority: number;
    enabled: boolean;
    description: string;
  }> = {}
): {
  name: string;
  domainId: string;
  pathPattern: string;
  protection: PomeriumProtectionLevel;
  identityProviderId: string | null;
  policyConfig: PomeriumPolicyConfig;
  priority: number;
  enabled: boolean;
  description: string;
} {
  return {
    name: overrides.name || `Protected Route ${nanoid(6)}`,
    domainId,
    pathPattern: overrides.pathPattern || "/*",
    protection: overrides.protection || "protected",
    identityProviderId: overrides.identityProviderId ?? null,
    policyConfig: overrides.policyConfig || {
      passIdentityHeaders: true,
    },
    priority: overrides.priority ?? 100,
    enabled: overrides.enabled ?? true,
    description: overrides.description || "Test route created by fixture",
  };
}

/**
 * Create a protected admin route fixture
 */
export function createAdminRouteFixture(
  domainId: string,
  adminEmail: string = "admin@test.local"
): ReturnType<typeof createPomeriumRouteFixture> {
  return createPomeriumRouteFixture(domainId, {
    name: "Admin Route",
    pathPattern: "/admin/*",
    protection: "protected",
    policyConfig: {
      allowedUsers: [adminEmail],
      passIdentityHeaders: true,
    },
    priority: 10,
    description: "Admin-only protected route",
  });
}

/**
 * Create a domain-restricted route fixture
 */
export function createDomainRestrictedRouteFixture(
  domainId: string,
  allowedDomain: string = "company.test"
): ReturnType<typeof createPomeriumRouteFixture> {
  return createPomeriumRouteFixture(domainId, {
    name: "Internal Route",
    pathPattern: "/internal/*",
    protection: "protected",
    policyConfig: {
      allowedDomains: [allowedDomain],
      passIdentityHeaders: true,
    },
    priority: 50,
    description: "Domain-restricted route",
  });
}

/**
 * Create a public route fixture
 */
export function createPublicRouteFixture(
  domainId: string
): ReturnType<typeof createPomeriumRouteFixture> {
  return createPomeriumRouteFixture(domainId, {
    name: "Public Route",
    pathPattern: "/public/*",
    protection: "public",
    policyConfig: {},
    priority: 100,
    description: "Public route allowing unauthenticated access",
  });
}

/**
 * Create a passthrough route fixture
 */
export function createPassthroughRouteFixture(
  domainId: string
): ReturnType<typeof createPomeriumRouteFixture> {
  return createPomeriumRouteFixture(domainId, {
    name: "Passthrough Route",
    pathPattern: "/api/*",
    protection: "passthrough",
    policyConfig: {
      preserveHostHeader: true,
    },
    priority: 90,
    description: "Passthrough route - backend handles auth",
  });
}

/**
 * Create Pomerium Settings fixture
 */
export function createPomeriumSettingsFixture(
  overrides: Partial<{
    enabled: boolean;
    authenticateServiceUrl: string;
    cookieName: string;
    cookieExpire: string;
    cookieDomain: string | null;
    cookieSecure: boolean;
    cookieHttpOnly: boolean;
    logLevel: "debug" | "info" | "warn" | "error";
    forwardAuthUrl: string;
  }> = {}
): {
  enabled: boolean;
  authenticateServiceUrl: string;
  cookieName: string;
  cookieExpire: string;
  cookieDomain: string | null;
  cookieSecure: boolean;
  cookieHttpOnly: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
  forwardAuthUrl: string;
} {
  return {
    enabled: overrides.enabled ?? true,
    authenticateServiceUrl: overrides.authenticateServiceUrl || "http://localhost:5080",
    cookieName: overrides.cookieName || "_pomerium_test",
    cookieExpire: overrides.cookieExpire || "14h",
    cookieDomain: overrides.cookieDomain ?? null,
    cookieSecure: overrides.cookieSecure ?? false,
    cookieHttpOnly: overrides.cookieHttpOnly ?? true,
    logLevel: overrides.logLevel || "debug",
    forwardAuthUrl: overrides.forwardAuthUrl || "http://localhost:5080/.pomerium/verify",
  };
}

/**
 * Create a complete Pomerium test scenario with IdP, routes, and settings
 */
export function createPomeriumTestScenario(
  domainId: string,
  options: {
    withAdminRoute?: boolean;
    withPublicRoute?: boolean;
    withDomainRestriction?: boolean;
    adminEmail?: string;
    allowedDomain?: string;
  } = {}
): {
  idp: ReturnType<typeof createPomeriumOidcIdpFixture>;
  settings: ReturnType<typeof createPomeriumSettingsFixture>;
  routes: ReturnType<typeof createPomeriumRouteFixture>[];
} {
  const routes: ReturnType<typeof createPomeriumRouteFixture>[] = [];

  // Default protected route for entire domain
  routes.push(
    createPomeriumRouteFixture(domainId, {
      name: "Default Protected",
      pathPattern: "/*",
      protection: "protected",
      priority: 1000,
    })
  );

  if (options.withAdminRoute) {
    routes.push(
      createAdminRouteFixture(domainId, options.adminEmail)
    );
  }

  if (options.withPublicRoute) {
    routes.push(createPublicRouteFixture(domainId));
  }

  if (options.withDomainRestriction) {
    routes.push(
      createDomainRestrictedRouteFixture(domainId, options.allowedDomain)
    );
  }

  return {
    idp: createPomeriumOidcIdpFixture({ isDefault: true }),
    settings: createPomeriumSettingsFixture(),
    routes,
  };
}

/**
 * Policy config presets for common scenarios
 */
export const POLICY_PRESETS = {
  /**
   * Allow any authenticated user
   */
  anyAuthenticated: {
    passIdentityHeaders: true,
  } as PomeriumPolicyConfig,

  /**
   * Admin only
   */
  adminOnly: {
    allowedUsers: ["admin@test.local"],
    passIdentityHeaders: true,
  } as PomeriumPolicyConfig,

  /**
   * Company employees only
   */
  companyOnly: {
    allowedDomains: ["company.test"],
    passIdentityHeaders: true,
  } as PomeriumPolicyConfig,

  /**
   * WebSocket enabled
   */
  websocket: {
    websocketsEnabled: true,
    passIdentityHeaders: true,
    timeout: 0,
    idleTimeout: 0,
  } as PomeriumPolicyConfig,

  /**
   * API route with CORS
   */
  api: {
    corsAllowPreflight: true,
    passIdentityHeaders: true,
    preserveHostHeader: true,
  } as PomeriumPolicyConfig,

  /**
   * Strict - specific users only
   */
  strict: (emails: string[]): PomeriumPolicyConfig => ({
    allowedUsers: emails,
    passIdentityHeaders: true,
  }),

  /**
   * Group-based access
   */
  groups: (groups: string[]): PomeriumPolicyConfig => ({
    allowedGroups: groups,
    passIdentityHeaders: true,
  }),
};
