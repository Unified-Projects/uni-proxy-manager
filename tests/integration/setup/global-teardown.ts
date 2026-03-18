import { execSync } from "child_process";
import { rmSync } from "fs";
import { join } from "path";

const PROJECT_ROOT = process.cwd();
const TEST_DATA_DIR = join(PROJECT_ROOT, "docker/test-data");

export async function teardown(): Promise<void> {
  console.log("[Integration Tests] Tearing down test infrastructure...");

  // Stop and remove containers
  try {
    execSync(
      "docker compose -f docker/docker-compose.test.yml down -v --remove-orphans",
      {
        cwd: PROJECT_ROOT,
        stdio: "inherit",
      }
    );
  } catch (error) {
    console.warn("[Integration Tests] Failed to stop containers:", error);
  }

  // Cleanup test data directory
  try {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch (error) {
    console.warn(
      "[Integration Tests] Failed to cleanup test data directory:",
      error
    );
  }

  console.log("[Integration Tests] Teardown complete");
}

export default teardown;
