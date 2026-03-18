import type { Job } from "bullmq";
import type {
  PomeriumRestartJobData,
  PomeriumRestartResult,
} from "@uni-proxy-manager/queue";
import http from "http";

const POMERIUM_CONTAINER_NAME =
  process.env.POMERIUM_CONTAINER_NAME || "uni-proxy-pomerium";
const DOCKER_SOCKET_PATH =
  process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock";

function sendDockerRequest(
  path: string,
  method: string
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  return new Promise((resolve) => {
    const options = {
      socketPath: DOCKER_SOCKET_PATH,
      path,
      method,
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (
          res.statusCode !== undefined &&
          res.statusCode >= 200 &&
          res.statusCode < 300
        ) {
          resolve({ success: true, statusCode: res.statusCode });
        } else {
          resolve({
            success: false,
            statusCode: res.statusCode,
            error: `Docker API returned ${res.statusCode}: ${data}`,
          });
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

export async function processPomeriumRestart(
  job: Job<PomeriumRestartJobData>
): Promise<PomeriumRestartResult> {
  const { reason } = job.data;
  console.log(`[Pomerium Restart] Restarting Pomerium: ${reason}`);

  try {
    const restartResult = await sendDockerRequest(
      `/containers/${POMERIUM_CONTAINER_NAME}/restart?t=10`,
      "POST"
    );

    if (restartResult.success) {
      console.log(
        `[Pomerium Restart] Container ${POMERIUM_CONTAINER_NAME} started successfully`
      );
      return { success: true, method: "docker-restart" };
    }

    console.error(
      "[Pomerium Restart] Restart failed:",
      restartResult.error
    );
    return {
      success: false,
      method: "docker-restart",
      error: restartResult.error,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[Pomerium Restart] Failed:", errorMessage);
    return { success: false, method: "docker-restart", error: errorMessage };
  }
}
