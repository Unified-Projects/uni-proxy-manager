/**
 * E2E Test Fixtures and Helpers
 *
 * Provides utilities for testing against real services (executor, workers, API)
 */

import { execSync } from "child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync, copyFileSync } from "fs";
import { join, dirname } from "path";

// Test configuration
export const E2E_CONFIG = {
  API_URL: process.env.E2E_API_URL || "http://127.0.0.1:3099",
  EXECUTOR_URL: process.env.E2E_EXECUTOR_URL || "http://127.0.0.1:8080",
  EXECUTOR_SECRET: process.env.E2E_EXECUTOR_SECRET || "e2e-test-executor-secret",
  POSTGRES_URL:
    process.env.E2E_POSTGRES_URL ||
    "postgresql://e2e_user:e2e_password@127.0.0.1:5435/uni_proxy_e2e?sslmode=disable",
  REDIS_URL: process.env.E2E_REDIS_URL || "redis://127.0.0.1:6380",
  STORAGE_PATH: "/tmp/uni-proxy-e2e",
  TIMEOUT_MS: 180000, // 3 minutes for deployment tests
};

/**
 * API client for E2E tests
 */
export class E2EApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = E2E_CONFIG.API_URL) {
    this.baseUrl = baseUrl;
  }

  async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
    } = {}
  ): Promise<{ status: number; body: T }> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const body = await response.json().catch(() => ({}));
    return { status: response.status, body: body as T };
  }

  async createSite(data: {
    name: string;
    slug: string;
    framework: "nextjs" | "sveltekit" | "static";
    renderMode: "ssr" | "ssg" | "hybrid";
    buildCommand?: string;
    outputDirectory?: string;
    nodeVersion?: string;
    coldStartEnabled?: boolean;
    memoryMb?: number;
    cpuLimit?: string;
    timeoutSeconds?: number;
  }): Promise<{ status: number; body: { site: any } }> {
    return this.request("/api/sites", {
      method: "POST",
      body: data,
    });
  }

  async getSite(siteId: string): Promise<{ status: number; body: { site: any } }> {
    return this.request(`/api/sites/${siteId}`);
  }

  async deleteSite(siteId: string): Promise<{ status: number; body: any }> {
    return this.request(`/api/sites/${siteId}`, { method: "DELETE" });
  }

  async triggerDeploy(siteId: string): Promise<{ status: number; body: { deployment: any } }> {
    return this.request(`/api/sites/${siteId}/deploy`, { method: "POST" });
  }

  async getDeployment(
    siteId: string,
    deploymentId: string
  ): Promise<{ status: number; body: { deployment: any } }> {
    return this.request(`/api/sites/${siteId}/deployments/${deploymentId}`);
  }

  async uploadArtifact(
    siteId: string,
    artifactPath: string
  ): Promise<{ status: number; body: any }> {
    // Read the artifact file and upload
    const fs = await import("fs/promises");
    const fileBuffer = await fs.readFile(artifactPath);

    const formData = new FormData();
    formData.append("artifact", new Blob([fileBuffer]), "artifact.tar.gz");

    const response = await fetch(`${this.baseUrl}/api/sites/${siteId}/upload`, {
      method: "POST",
      body: formData,
    });

    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
  }
}

/**
 * Executor client for direct executor API calls
 */
export class E2EExecutorClient {
  private endpoint: string;
  private secret: string;

  constructor(
    endpoint: string = E2E_CONFIG.EXECUTOR_URL,
    secret: string = E2E_CONFIG.EXECUTOR_SECRET
  ) {
    this.endpoint = endpoint;
    this.secret = secret;
  }

  async getRuntime(runtimeId: string): Promise<any | null> {
    try {
      const response = await fetch(`${this.endpoint}/v1/runtimes/${runtimeId}`, {
        headers: {
          Authorization: `Bearer ${this.secret}`,
        },
      });

      if (response.status === 404) return null;
      return response.json();
    } catch {
      return null;
    }
  }

  async listRuntimes(): Promise<any[]> {
    const response = await fetch(`${this.endpoint}/v1/runtimes`, {
      headers: {
        Authorization: `Bearer ${this.secret}`,
      },
    });

    const data = await response.json();
    return Array.isArray(data) ? data : data.runtimes || [];
  }

  async deleteRuntime(runtimeId: string): Promise<void> {
    await fetch(`${this.endpoint}/v1/runtimes/${runtimeId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.secret}`,
      },
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/v1/health`, {
        headers: {
          Authorization: `Bearer ${this.secret}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Wait for a condition with timeout
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number; description?: string } = {}
): Promise<void> {
  const { timeoutMs = 60000, intervalMs = 1000, description = "condition" } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timeout waiting for ${description} after ${timeoutMs}ms`);
}

/**
 * Wait for deployment to reach a specific status
 */
export async function waitForDeploymentStatus(
  client: E2EApiClient,
  siteId: string,
  deploymentId: string,
  targetStatus: string | string[],
  timeoutMs: number = E2E_CONFIG.TIMEOUT_MS
): Promise<any> {
  const statuses = Array.isArray(targetStatus) ? targetStatus : [targetStatus];
  let lastStatus = "";

  await waitFor(
    async () => {
      const { body } = await client.getDeployment(siteId, deploymentId);
      lastStatus = body.deployment?.status || "unknown";
      return statuses.includes(lastStatus);
    },
    {
      timeoutMs,
      intervalMs: 2000,
      description: `deployment ${deploymentId} to be ${statuses.join(" or ")} (last: ${lastStatus})`,
    }
  );

  const { body } = await client.getDeployment(siteId, deploymentId);
  return body.deployment;
}

/**
 * Clean up test data directories
 */
export function cleanupTestData(): void {
  const dirs = [
    join(E2E_CONFIG.STORAGE_PATH, "functions"),
    join(E2E_CONFIG.STORAGE_PATH, "builds"),
    join(E2E_CONFIG.STORAGE_PATH, "sites"),
  ];

  for (const dir of dirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Create a test artifact tarball
 *
 * This creates a minimal static site artifact for testing.
 * For SSR tests, use createNextJsTestArtifact().
 */
export function createStaticTestArtifact(outputPath: string): string {
  const tempDir = join(dirname(outputPath), "temp-static-site");

  // Create minimal static site structure
  mkdirSync(tempDir, { recursive: true });
  writeFileSync(
    join(tempDir, "index.html"),
    `<!DOCTYPE html>
<html>
<head><title>E2E Test Site</title></head>
<body>
  <h1>E2E Test Site</h1>
  <p>This is a test static site for E2E testing.</p>
  <p id="timestamp">${Date.now()}</p>
</body>
</html>`
  );

  // Create tarball
  execSync(`tar -czf ${outputPath} -C ${tempDir} .`, { stdio: "pipe" });

  // Cleanup temp dir
  rmSync(tempDir, { recursive: true, force: true });

  return outputPath;
}

/**
 * Create a test Next.js SSR artifact
 *
 * This uses a pre-built Next.js artifact from the test-project directory.
 * If the artifact doesn't exist, it builds it.
 */
export async function createNextJsTestArtifact(outputPath: string): Promise<string> {
  const testProjectDir = join(dirname(outputPath), "..", "test-project");
  const prebuiltArtifact = join(testProjectDir, "artifact.tar.gz");

  // Check if we have a pre-built artifact
  if (existsSync(prebuiltArtifact)) {
    copyFileSync(prebuiltArtifact, outputPath);
    return outputPath;
  }

  // Build the test project
  if (!existsSync(testProjectDir)) {
    throw new Error(
      `Test project directory not found: ${testProjectDir}. ` +
        `Please run 'pnpm test:e2e-real:setup' to create the test project.`
    );
  }

  // Build and create artifact
  execSync("npm install && npm run build", {
    cwd: testProjectDir,
    stdio: "pipe",
  });

  // Create tarball of the .next directory
  execSync(`tar -czf ${outputPath} -C ${testProjectDir} .next package.json node_modules`, {
    stdio: "pipe",
  });

  return outputPath;
}

/**
 * Generate a unique test ID
 */
export function generateTestId(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Create test site data
 */
export function createTestSiteData(overrides: Partial<{
  name: string;
  slug: string;
  framework: "nextjs" | "sveltekit" | "static";
  renderMode: "ssr" | "ssg" | "hybrid";
  coldStartEnabled: boolean;
  memoryMb: number;
  timeoutSeconds: number;
}> = {}) {
  const testId = generateTestId();
  return {
    name: overrides.name || `E2E Test Site ${testId}`,
    slug: overrides.slug || `e2e-test-${testId}`,
    framework: overrides.framework || "static",
    renderMode: overrides.renderMode || "ssg",
    buildCommand: "echo 'no build needed'",
    outputDirectory: ".",
    nodeVersion: "20",
    coldStartEnabled: overrides.coldStartEnabled ?? true,
    memoryMb: overrides.memoryMb || 256,
    cpuLimit: "0.5",
    timeoutSeconds: overrides.timeoutSeconds || 30,
  };
}
