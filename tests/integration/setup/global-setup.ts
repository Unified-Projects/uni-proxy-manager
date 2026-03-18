import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, copyFileSync } from "fs";
import { join } from "path";

// Detect if running inside Docker container (containers are already running)
const IS_DOCKER = !!process.env.DATABASE_URL?.includes("test-postgres");

const PROJECT_ROOT = IS_DOCKER ? "/app" : process.cwd();
const DOCKER_DIR = join(PROJECT_ROOT, "docker");
const TEST_DATA_DIR = join(DOCKER_DIR, "test-data");

// Check if Pomerium testing is enabled
const POMERIUM_ENABLED = process.env.TEST_POMERIUM_ENABLED !== "false";

// Helper to run commands - handles shell-less execution
function runCommand(cmd: string, options?: { cwd?: string; env?: Record<string, string>; stdio?: "inherit" | "pipe" | "ignore" }) {
  try {
    // For commands like "pnpm db:push", we need to run via node to avoid shell requirement
    if (cmd.startsWith("pnpm ")) {
      const pnpmArgs = cmd.substring(5).split(" ");
      const nodePath = process.execPath;
      const pnpmPath = require.resolve("pnpm/bin/pnpm.cjs");

      execSync(nodePath, {
        args: [pnpmPath, ...pnpmArgs],
        cwd: options?.cwd || PROJECT_ROOT,
        env: options?.env || process.env,
        stdio: options?.stdio || "inherit",
        encoding: "utf-8",
      });
    } else {
      // For other commands, try direct execution
      const parts = cmd.split(" ");
      const executable = parts[0];
      const args = parts.slice(1);

      execSync(executable, {
        args: args,
        cwd: options?.cwd || PROJECT_ROOT,
        env: options?.env || process.env,
        stdio: options?.stdio || "inherit",
        encoding: "utf-8",
      });
    }
  } catch (error) {
    console.error(`Failed to run command: ${cmd}`);
    throw error;
  }
}

function waitForContainer(
  containerName: string,
  timeout = 60000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const check = () => {
      try {
        // First check if container has a health check defined
        const healthStatus = execSync(
          `docker inspect --format='{{.State.Health.Status}}' ${containerName} 2>/dev/null || echo "no_health_check"`,
          { encoding: "utf-8" }
        ).trim();

        // If healthy, we're done
        if (healthStatus === "healthy") {
          resolve();
          return;
        }

        // If container has no health check, check if it's running
        if (healthStatus === "no_health_check" || healthStatus === "") {
          const runningStatus = execSync(
            `docker inspect --format='{{.State.Running}}' ${containerName} 2>/dev/null || echo "false"`,
            { encoding: "utf-8" }
          ).trim();

          if (runningStatus === "true") {
            resolve();
            return;
          }
        }

        if (Date.now() - startTime > timeout) {
          reject(
            new Error(
              `Container ${containerName} did not become healthy within ${timeout}ms`
            )
          );
          return;
        }

        setTimeout(check, 1000);
      } catch {
        if (Date.now() - startTime > timeout) {
          reject(new Error(`Failed to check container ${containerName}`));
          return;
        }
        setTimeout(check, 1000);
      }
    };

    check();
  });
}

function setupTestDirectories(): void {
  const dirs = [
    join(TEST_DATA_DIR, "haproxy"),
    join(TEST_DATA_DIR, "certificates"),
    join(TEST_DATA_DIR, "error-pages"),
    join(TEST_DATA_DIR, "nginx"),
    join(TEST_DATA_DIR, "sites", "sources"),
    join(TEST_DATA_DIR, "sites", "builds"),
    join(TEST_DATA_DIR, "sites", "deploys"),
    join(TEST_DATA_DIR, "dex"),
    join(TEST_DATA_DIR, "pomerium"),
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // Write initial HAProxy config
  // NOTE: No HTTPS frontend initially - it will be added only when domains with SSL are configured
  const haproxyConfig = `global
    log stdout format raw local0
    maxconn 4096

defaults
    log global
    mode http
    option httplog
    timeout connect 5s
    timeout client 50s
    timeout server 50s

frontend http_front
    mode http
    bind *:80
    default_backend test_backend

backend test_backend
    mode http
    balance roundrobin
    server backend uni-proxy-manager-test-backend:80 check
`;
  writeFileSync(join(TEST_DATA_DIR, "haproxy/haproxy.cfg"), haproxyConfig);

  // Write nginx index page for backend testing
  writeFileSync(
    join(TEST_DATA_DIR, "nginx/index.html"),
    "<html><body>Test Backend OK</body></html>"
  );
}

// Cleanup function for process exit handlers
function cleanupContainers(): void {
  try {
    runCommand("docker compose -f docker/docker-compose.test.yml down -v --remove-orphans", {
      stdio: "ignore",
    });
  } catch {
    // Ignore errors during cleanup
  }
}

export async function setup(): Promise<void> {
  console.log("[Integration Tests] Starting test infrastructure...");
  console.log(`[Integration Tests] Running in Docker: ${IS_DOCKER}`);

  // Skip Docker container management when running inside Docker
  if (!IS_DOCKER) {
    // Register cleanup handlers for unexpected exits
    process.on("SIGINT", () => {
      console.log("\n[Integration Tests] Caught SIGINT, cleaning up...");
      cleanupContainers();
      process.exit(1);
    });

    process.on("SIGTERM", () => {
      console.log("\n[Integration Tests] Caught SIGTERM, cleaning up...");
      cleanupContainers();
      process.exit(1);
    });

    process.on("exit", () => {
      cleanupContainers();
    });

    // Setup test directories
    setupTestDirectories();

    // Start containers
    console.log("[Integration Tests] Starting Docker containers...");
    runCommand("docker compose -f docker/docker-compose.test.yml up -d");

    // Wait for core containers to be healthy
    console.log("[Integration Tests] Waiting for core containers to be healthy...");
    await Promise.all([
      waitForContainer("uni-proxy-manager-test-postgres"),
      waitForContainer("uni-proxy-manager-test-redis"),
      waitForContainer("uni-proxy-manager-test-backend"),
    ]);

    // Wait for Dex and Pomerium if enabled
    if (POMERIUM_ENABLED) {
      console.log("[Integration Tests] Waiting for Dex OIDC provider to be healthy...");
      await waitForContainer("uni-proxy-manager-test-dex", 90000);

      console.log("[Integration Tests] Waiting for Pomerium to be healthy...");
      await waitForContainer("uni-proxy-manager-test-pomerium", 90000);

      console.log("[Integration Tests] Dex and Pomerium are ready");
    }

    // Wait for Pebble ACME test server
    console.log("[Integration Tests] Waiting for Pebble ACME server to be healthy...");
    await waitForContainer("uni-proxy-manager-test-pebble", 60000);

    console.log("[Integration Tests] Pebble ACME infrastructure is ready");
  } else {
    console.log("[Integration Tests] Running inside Docker - containers already available");
  }

  // Database migrations are handled by test-db-migrate service before tests run
  console.log("[Integration Tests] Database migrations handled by test-db-migrate service");

  console.log("[Integration Tests] Infrastructure ready");
}

export default setup;
