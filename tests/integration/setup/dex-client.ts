// Dex OIDC client -- handles auth + token fetching for integration tests.

export interface DexConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
}

export interface TokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export interface WellKnownConfig {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  scopes_supported: string[];
  response_types_supported: string[];
  grant_types_supported?: string[];
}

export interface TestUser {
  email: string;
  password: string;
  username: string;
  userId: string;
  groups?: string[];
}

export interface DecodedToken {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  groups?: string[];
}

/**
 * Static test users configured in Dex
 * Password for all users is "password"
 * Groups are defined here since Dex static passwords don't support groups
 */
export const TEST_USERS: Record<string, TestUser> = {
  admin: {
    email: "admin@test.local",
    password: "password",
    username: "admin",
    userId: "08a8684b-db88-4b73-90a9-3cd1661f5466",
    groups: ["admins", "employees"],
  },
  user: {
    email: "user@test.local",
    password: "password",
    username: "user",
    userId: "41331323-6f44-45e6-b3b9-2c4c48c8a6fb",
    groups: ["users"],
  },
  blocked: {
    email: "blocked@test.local",
    password: "password",
    username: "blocked",
    userId: "59b38d79-8c67-45f2-bf94-2c4c48c8a6fc",
    groups: ["blocked"],
  },
  employee: {
    email: "employee@company.test",
    password: "password",
    username: "employee",
    userId: "72c49e8a-1234-5678-9abc-def012345678",
    groups: ["employees"],
  },
  external: {
    email: "external@external.test",
    password: "password",
    username: "external",
    userId: "83d50f9b-2345-6789-abcd-ef0123456789",
    groups: ["external"],
  },
};

/**
 * Static clients configured in Dex
 */
export const TEST_CLIENTS = {
  pomerium: {
    clientId: "pomerium-test",
    clientSecret: "pomerium-test-secret",
  },
  test: {
    clientId: "test-client",
    clientSecret: "test-client-secret",
  },
  public: {
    clientId: "test-public-client",
    clientSecret: "", // Public client, no secret
  },
};

/**
 * Dex OIDC Client
 *
 * Provides methods for OIDC operations against the Dex test server.
 */
export class DexClient {
  private config: DexConfig;
  private wellKnownCache: WellKnownConfig | null = null;

  constructor(config?: Partial<DexConfig>) {
    this.config = {
      issuerUrl: config?.issuerUrl || process.env.DEX_ISSUER_URL || "http://localhost:5556/dex",
      clientId: config?.clientId || TEST_CLIENTS.test.clientId,
      clientSecret: config?.clientSecret || TEST_CLIENTS.test.clientSecret,
    };
  }

  /**
   * Get OIDC well-known configuration
   */
  async getWellKnownConfig(): Promise<WellKnownConfig> {
    if (this.wellKnownCache) {
      return this.wellKnownCache;
    }

    const response = await fetch(`${this.config.issuerUrl}/.well-known/openid-configuration`);
    if (!response.ok) {
      throw new Error(`Failed to fetch OIDC config: ${response.status} ${response.statusText}`);
    }

    this.wellKnownCache = await response.json();
    return this.wellKnownCache!;
  }

  /**
   * Authenticate a user using Resource Owner Password Credentials grant
   * Note: This grant type must be enabled in Dex and is only suitable for testing
   */
  async authenticateUser(user: TestUser, scopes: string[] = ["openid", "email", "profile"]): Promise<TokenResponse> {
    const wellKnown = await this.getWellKnownConfig();

    const params = new URLSearchParams({
      grant_type: "password",
      username: user.email,
      password: user.password,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: scopes.join(" "),
    });

    const response = await fetch(wellKnown.token_endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Authentication failed: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
    const wellKnown = await this.getWellKnownConfig();

    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    const response = await fetch(wellKnown.token_endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Refresh an access token using a refresh token
   */
  async refreshToken(refreshToken: string): Promise<TokenResponse> {
    const wellKnown = await this.getWellKnownConfig();

    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    const response = await fetch(wellKnown.token_endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Get user info from userinfo endpoint
   */
  async getUserInfo(accessToken: string): Promise<Record<string, unknown>> {
    const wellKnown = await this.getWellKnownConfig();

    const response = await fetch(wellKnown.userinfo_endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get user info: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Decode a JWT token (without verification - for testing only)
   */
  decodeToken(token: string): DecodedToken {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid JWT token format");
    }

    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    return payload as DecodedToken;
  }

  /**
   * Get the authorization URL for browser-based auth flow
   */
  async getAuthorizationUrl(
    redirectUri: string,
    scopes: string[] = ["openid", "email", "profile"],
    state?: string
  ): Promise<string> {
    const wellKnown = await this.getWellKnownConfig();

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes.join(" "),
      state: state || crypto.randomUUID(),
    });

    return `${wellKnown.authorization_endpoint}?${params.toString()}`;
  }

  /**
   * Check if Dex is healthy and ready
   * Note: Password grant may be enabled via passwordConnector but not advertised
   * in grant_types_supported. We verify Dex is running by checking endpoints.
   */
  async isHealthy(): Promise<boolean> {
    try {
      // Try to get well-known config (primary health check)
      await this.getWellKnownConfig();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Wait for Dex to be healthy
   */
  async waitForHealthy(timeoutMs = 60000, intervalMs = 1000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (await this.isHealthy()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Dex did not become healthy within ${timeoutMs}ms`);
  }

  /**
   * Clear the cached well-known config
   */
  clearCache(): void {
    this.wellKnownCache = null;
  }
}

/**
 * Default Dex client instance
 */
export const dexClient = new DexClient();

/**
 * Create a Dex client with Pomerium credentials
 */
export function createPomeriumDexClient(): DexClient {
  return new DexClient({
    clientId: TEST_CLIENTS.pomerium.clientId,
    clientSecret: TEST_CLIENTS.pomerium.clientSecret,
  });
}
