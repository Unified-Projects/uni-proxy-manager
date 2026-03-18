import type { Job } from "bullmq";
import type { HaproxyReloadJobData, HaproxyReloadResult } from "@uni-proxy-manager/queue";
import { getHaproxyConfigPath } from "@uni-proxy-manager/shared/config";
import { sendHaproxySocketCommand } from "@uni-proxy-manager/shared/haproxy";
import { stat } from "fs/promises";
import http from "http";

const HAPROXY_CONTAINER_NAME = process.env.HAPROXY_CONTAINER_NAME || "uni-proxy-manager-haproxy";
const DOCKER_SOCKET_PATH = process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock";

/**
 * Send a signal to the HAProxy container via Docker API using raw http
 */
function sendDockerSignal(signal: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const options = {
      socketPath: DOCKER_SOCKET_PATH,
      path: `/containers/${HAPROXY_CONTAINER_NAME}/kill?signal=${signal}`,
      method: "POST",
    };

    console.log(`[HAProxy Reload] Sending ${signal} to ${HAPROXY_CONTAINER_NAME} via ${DOCKER_SOCKET_PATH}`);

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode === 204 || res.statusCode === 200) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: `Docker API returned ${res.statusCode}: ${data}` });
        }
      });
    });

    req.on("error", (error) => {
      resolve({ success: false, error: error.message });
    });

    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ success: false, error: "Docker API request timed out" });
    });

    req.end();
  });
}

/**
 * Reload HAProxy by sending SIGHUP to the container
 */
async function reloadHaproxy(): Promise<{ success: boolean; method: string; error?: string }> {
  // Always attempt Docker API - don't check if socket exists first
  const result = await sendDockerSignal("SIGHUP");

  if (result.success) {
    console.log(`[HAProxy Reload] Successfully sent SIGHUP to container ${HAPROXY_CONTAINER_NAME}`);
    return { success: true, method: "docker-sighup" };
  }

  console.error("[HAProxy Reload] Docker SIGHUP failed:", result.error);
  return {
    success: false,
    method: "docker-sighup",
    error: result.error,
  };
}

export async function processHaproxyReload(
  job: Job<HaproxyReloadJobData>
): Promise<HaproxyReloadResult> {
  const { reason } = job.data;

  console.log(`[HAProxy Reload] Processing reload: ${reason}`);

  try {
    const configPath = getHaproxyConfigPath();

    // Verify config file exists
    try {
      await stat(configPath);
    } catch {
      throw new Error(`Config file not found: ${configPath}`);
    }

    console.log(`[HAProxy Reload] Config file exists at ${configPath}`);

    // Verify HAProxy is accessible via socket
    try {
      await sendHaproxySocketCommand("show info");
      console.log("[HAProxy Reload] Socket connection verified");
    } catch (socketError) {
      console.warn("[HAProxy Reload] Socket check failed:",
        socketError instanceof Error ? socketError.message : socketError);
    }

    // Perform the reload
    const reloadResult = await reloadHaproxy();

    if (reloadResult.success) {
      console.log(`[HAProxy Reload] Completed via ${reloadResult.method}`);
      return {
        success: true,
        configPath,
        reloadMethod: reloadResult.method as HaproxyReloadResult["reloadMethod"],
      };
    } else {
      console.error(`[HAProxy Reload] Failed: ${reloadResult.error}`);
      return {
        success: false,
        configPath,
        reloadMethod: reloadResult.method as HaproxyReloadResult["reloadMethod"],
        error: reloadResult.error,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[HAProxy Reload] Failed:`, errorMessage);

    return {
      success: false,
      reloadMethod: "unknown",
      error: errorMessage,
    };
  }
}
