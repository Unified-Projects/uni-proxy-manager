/**
 * Pomerium Schema Unit Tests
 *
 * Tests for the Pomerium database schema definitions.
 */

import { describe, it, expect } from "vitest";
import {
  pomeriumIdentityProviders,
  pomeriumRoutes,
  pomeriumSettings,
  pomeriumIdpTypeEnum,
  pomeriumRouteProtectionEnum,
  type PomeriumIdentityProvider,
  type NewPomeriumIdentityProvider,
  type PomeriumRoute,
  type NewPomeriumRoute,
  type PomeriumSettings,
  type NewPomeriumSettings,
  type GoogleIdpCredentials,
  type AzureIdpCredentials,
  type GitHubIdpCredentials,
  type OidcIdpCredentials,
  type PomeriumPolicyConfig,
} from "../../../../../packages/database/src/schema/pomerium";

describe("Pomerium Schema", () => {
  // ============================================================================
  // Enum Tests
  // ============================================================================

  describe("pomeriumIdpTypeEnum", () => {
    it("should define all expected IdP types", () => {
      const enumValues = pomeriumIdpTypeEnum.enumValues;

      expect(enumValues).toContain("google");
      expect(enumValues).toContain("azure");
      expect(enumValues).toContain("github");
      expect(enumValues).toContain("oidc");
    });

    it("should have exactly 4 IdP types", () => {
      expect(pomeriumIdpTypeEnum.enumValues).toHaveLength(4);
    });

    it("should have correct enum name", () => {
      expect(pomeriumIdpTypeEnum.enumName).toBe("pomerium_idp_type");
    });
  });

  describe("pomeriumRouteProtectionEnum", () => {
    it("should define all expected protection levels", () => {
      const enumValues = pomeriumRouteProtectionEnum.enumValues;

      expect(enumValues).toContain("protected");
      expect(enumValues).toContain("public");
      expect(enumValues).toContain("passthrough");
    });

    it("should have exactly 3 protection levels", () => {
      expect(pomeriumRouteProtectionEnum.enumValues).toHaveLength(3);
    });

    it("should have correct enum name", () => {
      expect(pomeriumRouteProtectionEnum.enumName).toBe("pomerium_route_protection");
    });
  });

  // ============================================================================
  // Identity Providers Table Tests
  // ============================================================================

  describe("pomeriumIdentityProviders table", () => {
    it("should have id as primary key", () => {
      const idColumn = pomeriumIdentityProviders.id;
      expect(idColumn.name).toBe("id");
      expect(idColumn.dataType).toBe("string");
    });

    it("should have name as required unique field", () => {
      const nameColumn = pomeriumIdentityProviders.name;
      expect(nameColumn.name).toBe("name");
      expect(nameColumn.notNull).toBe(true);
      expect(nameColumn.isUnique).toBe(true);
    });

    it("should have displayName as optional field", () => {
      const displayNameColumn = pomeriumIdentityProviders.displayName;
      expect(displayNameColumn.name).toBe("display_name");
      expect(displayNameColumn.notNull).toBe(false);
    });

    it("should have type as required field", () => {
      const typeColumn = pomeriumIdentityProviders.type;
      expect(typeColumn.name).toBe("type");
      expect(typeColumn.notNull).toBe(true);
    });

    it("should have credentials as required JSONB field", () => {
      const credentialsColumn = pomeriumIdentityProviders.credentials;
      expect(credentialsColumn.name).toBe("credentials");
      expect(credentialsColumn.notNull).toBe(true);
      expect(credentialsColumn.dataType).toBe("json");
    });

    it("should have enabled with default true", () => {
      const enabledColumn = pomeriumIdentityProviders.enabled;
      expect(enabledColumn.name).toBe("enabled");
      expect(enabledColumn.notNull).toBe(true);
      expect(enabledColumn.hasDefault).toBe(true);
    });

    it("should have isDefault with default false", () => {
      const isDefaultColumn = pomeriumIdentityProviders.isDefault;
      expect(isDefaultColumn.name).toBe("is_default");
      expect(isDefaultColumn.notNull).toBe(true);
      expect(isDefaultColumn.hasDefault).toBe(true);
    });

    it("should have lastValidated as optional timestamp", () => {
      const lastValidatedColumn = pomeriumIdentityProviders.lastValidated;
      expect(lastValidatedColumn.name).toBe("last_validated");
      expect(lastValidatedColumn.notNull).toBe(false);
    });

    it("should have validationError as optional text", () => {
      const validationErrorColumn = pomeriumIdentityProviders.validationError;
      expect(validationErrorColumn.name).toBe("validation_error");
      expect(validationErrorColumn.notNull).toBe(false);
    });

    it("should have timestamps", () => {
      expect(pomeriumIdentityProviders.createdAt.name).toBe("created_at");
      expect(pomeriumIdentityProviders.updatedAt.name).toBe("updated_at");
    });
  });

  // ============================================================================
  // Routes Table Tests
  // ============================================================================

  describe("pomeriumRoutes table", () => {
    it("should have id as primary key", () => {
      const idColumn = pomeriumRoutes.id;
      expect(idColumn.name).toBe("id");
      expect(idColumn.dataType).toBe("string");
    });

    it("should have name as required field", () => {
      const nameColumn = pomeriumRoutes.name;
      expect(nameColumn.name).toBe("name");
      expect(nameColumn.notNull).toBe(true);
    });

    it("should have domainId as required field", () => {
      const domainIdColumn = pomeriumRoutes.domainId;
      expect(domainIdColumn.name).toBe("domain_id");
      expect(domainIdColumn.notNull).toBe(true);
    });

    it("should have pathPattern with default /*", () => {
      const pathPatternColumn = pomeriumRoutes.pathPattern;
      expect(pathPatternColumn.name).toBe("path_pattern");
      expect(pathPatternColumn.notNull).toBe(true);
      expect(pathPatternColumn.hasDefault).toBe(true);
    });

    it("should have protection with default protected", () => {
      const protectionColumn = pomeriumRoutes.protection;
      expect(protectionColumn.name).toBe("protection");
      expect(protectionColumn.notNull).toBe(true);
      expect(protectionColumn.hasDefault).toBe(true);
    });

    it("should have identityProviderId as optional field", () => {
      const idpColumn = pomeriumRoutes.identityProviderId;
      expect(idpColumn.name).toBe("identity_provider_id");
      expect(idpColumn.notNull).toBe(false);
    });

    it("should have policyConfig as JSONB field", () => {
      const policyColumn = pomeriumRoutes.policyConfig;
      expect(policyColumn.name).toBe("policy_config");
      expect(policyColumn.dataType).toBe("json");
    });

    it("should have priority with default 100", () => {
      const priorityColumn = pomeriumRoutes.priority;
      expect(priorityColumn.name).toBe("priority");
      expect(priorityColumn.notNull).toBe(true);
      expect(priorityColumn.hasDefault).toBe(true);
    });

    it("should have enabled with default true", () => {
      const enabledColumn = pomeriumRoutes.enabled;
      expect(enabledColumn.name).toBe("enabled");
      expect(enabledColumn.notNull).toBe(true);
      expect(enabledColumn.hasDefault).toBe(true);
    });

    it("should have description as optional text", () => {
      const descriptionColumn = pomeriumRoutes.description;
      expect(descriptionColumn.name).toBe("description");
      expect(descriptionColumn.notNull).toBe(false);
    });
  });

  // ============================================================================
  // Settings Table Tests
  // ============================================================================

  describe("pomeriumSettings table", () => {
    it("should have id as primary key with default", () => {
      const idColumn = pomeriumSettings.id;
      expect(idColumn.name).toBe("id");
      expect(idColumn.hasDefault).toBe(true);
    });

    it("should have secret fields", () => {
      expect(pomeriumSettings.sharedSecret.name).toBe("shared_secret");
      expect(pomeriumSettings.cookieSecret.name).toBe("cookie_secret");
      expect(pomeriumSettings.signingKey.name).toBe("signing_key");
    });

    it("should have authenticateServiceUrl as optional", () => {
      const urlColumn = pomeriumSettings.authenticateServiceUrl;
      expect(urlColumn.name).toBe("authenticate_service_url");
      expect(urlColumn.notNull).toBe(false);
    });

    it("should have cookie settings", () => {
      expect(pomeriumSettings.cookieName.name).toBe("cookie_name");
      expect(pomeriumSettings.cookieExpire.name).toBe("cookie_expire");
      expect(pomeriumSettings.cookieDomain.name).toBe("cookie_domain");
      expect(pomeriumSettings.cookieSecure.name).toBe("cookie_secure");
      expect(pomeriumSettings.cookieHttpOnly.name).toBe("cookie_http_only");
    });

    it("should have enabled with default false", () => {
      const enabledColumn = pomeriumSettings.enabled;
      expect(enabledColumn.name).toBe("enabled");
      expect(enabledColumn.notNull).toBe(true);
      expect(enabledColumn.hasDefault).toBe(true);
    });

    it("should have logLevel with default info", () => {
      const logLevelColumn = pomeriumSettings.logLevel;
      expect(logLevelColumn.name).toBe("log_level");
      expect(logLevelColumn.hasDefault).toBe(true);
    });
  });

  // ============================================================================
  // Type Tests
  // ============================================================================

  describe("Credential types", () => {
    it("should define GoogleIdpCredentials", () => {
      const creds: GoogleIdpCredentials = {
        clientId: "google-client-id",
        clientSecret: "google-secret",
        hostedDomain: "example.com",
      };

      expect(creds.clientId).toBe("google-client-id");
      expect(creds.hostedDomain).toBe("example.com");
    });

    it("should define AzureIdpCredentials", () => {
      const creds: AzureIdpCredentials = {
        clientId: "azure-client-id",
        clientSecret: "azure-secret",
        tenantId: "azure-tenant-id",
      };

      expect(creds.clientId).toBe("azure-client-id");
      expect(creds.tenantId).toBe("azure-tenant-id");
    });

    it("should define GitHubIdpCredentials", () => {
      const creds: GitHubIdpCredentials = {
        clientId: "github-client-id",
        clientSecret: "github-secret",
        allowedOrganizations: ["org1", "org2"],
        allowedTeams: ["team1"],
      };

      expect(creds.clientId).toBe("github-client-id");
      expect(creds.allowedOrganizations).toContain("org1");
    });

    it("should define OidcIdpCredentials", () => {
      const creds: OidcIdpCredentials = {
        clientId: "oidc-client-id",
        clientSecret: "oidc-secret",
        issuerUrl: "https://auth.example.com",
        scopes: ["openid", "email", "profile"],
      };

      expect(creds.clientId).toBe("oidc-client-id");
      expect(creds.issuerUrl).toBe("https://auth.example.com");
    });
  });

  describe("PomeriumPolicyConfig type", () => {
    it("should define all policy options", () => {
      const policy: PomeriumPolicyConfig = {
        allowedUsers: ["user@example.com"],
        allowedGroups: ["admins"],
        allowedDomains: ["example.com"],
        allowedEmailPatterns: ["*@example.com"],
        corsAllowPreflight: true,
        passIdentityHeaders: true,
        setRequestHeaders: { "X-Custom-Header": "value" },
        removeRequestHeaders: ["X-Remove"],
        timeout: 30,
        idleTimeout: 60,
        websocketsEnabled: true,
        preserveHostHeader: true,
        tlsSkipVerify: false,
      };

      expect(policy.allowedUsers).toContain("user@example.com");
      expect(policy.websocketsEnabled).toBe(true);
    });

    it("should allow partial policy config", () => {
      const policy: PomeriumPolicyConfig = {
        allowedGroups: ["admins"],
      };

      expect(policy.allowedGroups).toContain("admins");
      expect(policy.allowedUsers).toBeUndefined();
    });
  });

  describe("PomeriumIdentityProvider type", () => {
    it("should export select type", () => {
      const idp: PomeriumIdentityProvider = {
        id: "idp-1",
        name: "Google IdP",
        displayName: "Google",
        type: "google",
        credentials: {
          clientId: "test",
          clientSecret: "secret",
        },
        enabled: true,
        isDefault: false,
        lastValidated: null,
        validationError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(idp.id).toBe("idp-1");
      expect(idp.type).toBe("google");
    });

    it("should export insert type", () => {
      const newIdp: NewPomeriumIdentityProvider = {
        id: "idp-1",
        name: "OIDC Provider",
        type: "oidc",
        credentials: {
          clientId: "test",
          clientSecret: "secret",
          issuerUrl: "https://auth.example.com",
        },
      };

      expect(newIdp.id).toBe("idp-1");
    });
  });

  describe("PomeriumRoute type", () => {
    it("should export select type", () => {
      const route: PomeriumRoute = {
        id: "route-1",
        name: "Admin Route",
        domainId: "domain-1",
        pathPattern: "/admin/*",
        protection: "protected",
        identityProviderId: null,
        policyConfig: { allowedGroups: ["admins"] },
        priority: 10,
        enabled: true,
        description: "Admin access",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(route.id).toBe("route-1");
      expect(route.protection).toBe("protected");
    });

    it("should export insert type", () => {
      const newRoute: NewPomeriumRoute = {
        id: "route-1",
        name: "API Route",
        domainId: "domain-1",
        pathPattern: "/api/*",
      };

      expect(newRoute.id).toBe("route-1");
    });
  });

  describe("PomeriumSettings type", () => {
    it("should export select type", () => {
      const settings: PomeriumSettings = {
        id: "default",
        sharedSecret: "secret",
        cookieSecret: "cookie-secret",
        signingKey: "signing-key",
        authenticateServiceUrl: "https://auth.example.com",
        cookieName: "_pomerium",
        cookieExpire: "14h",
        cookieDomain: ".example.com",
        cookieSecure: true,
        cookieHttpOnly: true,
        enabled: true,
        logLevel: "info",
        forwardAuthUrl: "http://localhost:8000/verify",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(settings.id).toBe("default");
      expect(settings.enabled).toBe(true);
    });

    it("should export insert type with minimal fields", () => {
      const newSettings: NewPomeriumSettings = {
        id: "default",
      };

      expect(newSettings.id).toBe("default");
    });
  });
});
