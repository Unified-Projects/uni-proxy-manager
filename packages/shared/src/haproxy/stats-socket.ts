import { Socket } from "net";
import { existsSync, statSync } from "fs";
import { getHaproxySocketPath } from "../config/env.js";

const DEFAULT_SOCKET_TIMEOUT_MS = 5000;

export interface HaproxyInfo {
  version: string;
  release_date: string;
  uptime_sec: number;
  start_time: number;
  try_pid_start_time: number;
  current_connections: number;
  current_pipes: number;
  current_ssl_connections: number;
  max_connections: number;
  max_pipes: number;
  max_ssl_connections: number;
  processes: number;
  run_queue: number;
  tasks: number;
  [key: string]: string | number;
}

export interface BackendStats {
  name: string;
  type: "frontend" | "backend" | "server";
  status: string;

  // Request counters
  total_requests: number;
  http_requests_rate: number;

  // Response codes
  http_responses_1xx: number;
  http_responses_2xx: number;
  http_responses_3xx: number;
  http_responses_4xx: number;
  http_responses_5xx: number;
  http_responses_other: number;

  // Traffic volume
  bytes_in: number;
  bytes_out: number;

  // Connection stats
  current_sessions: number;
  max_sessions: number;
  session_limit: number;
  session_rate: number;
  session_rate_max: number;

  // Queue stats
  current_queue: number;
  max_queue: number;

  // Server health
  check_status?: string;
  check_duration?: number;
  last_status_change?: number;
  downtime?: number;
}

export interface HaproxyStatsData {
  frontends: BackendStats[];
  backends: BackendStats[];
  servers: BackendStats[];
}

/**
 * Execute a command on the HAProxy stats socket
 */
export async function sendHaproxySocketCommand(
  command: string,
  timeoutMs: number = DEFAULT_SOCKET_TIMEOUT_MS
): Promise<string> {
  const socketPath = getHaproxySocketPath();
  console.log(`[HAProxy Socket] Sending command "${command}" to socket: ${socketPath}`);

  // Check if socket file exists
  if (!existsSync(socketPath)) {
    console.error(`[HAProxy Socket] Socket file does not exist: ${socketPath}`);
    throw new Error(`HAProxy socket file not found at ${socketPath}`);
  }

  try {
    const stats = statSync(socketPath);
    console.log(`[HAProxy Socket] Socket file exists, isSocket: ${stats.isSocket()}, mode: ${stats.mode.toString(8)}`);
  } catch (err) {
    console.error(`[HAProxy Socket] Failed to stat socket file:`, err);
  }

  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let response = "";
    let settled = false;
    let connected = false;
    let dataChunks = 0;

    const finish = (event: string, err?: Error) => {
      if (settled) {
        console.log(`[HAProxy Socket] Ignoring ${event} event (already settled)`);
        return;
      }
      settled = true;
      console.log(`[HAProxy Socket] Finishing via ${event}, response length: ${response.length}, chunks: ${dataChunks}`);
      socket.removeAllListeners();
      socket.destroy();
      if (err) {
        console.error(`[HAProxy Socket] Error: ${err.message}`);
        reject(err);
      } else {
        console.log(`[HAProxy Socket] Command completed successfully`);
        resolve(response);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.on("data", (chunk) => {
      dataChunks++;
      const chunkStr = chunk.toString();
      console.log(`[HAProxy Socket] Received data chunk ${dataChunks}, size: ${chunk.length}`);
      response += chunkStr;
    });
    socket.on("timeout", () => {
      console.log(`[HAProxy Socket] Timeout event`);
      socket.destroy();
      finish("timeout", new Error(`HAProxy socket timed out after ${timeoutMs}ms (connected: ${connected}, chunks: ${dataChunks})`));
    });
    socket.on("error", (err) => {
      console.log(`[HAProxy Socket] Error event: ${err.message}`);
      finish("error", new Error(`Failed to query HAProxy stats socket at ${socketPath}: ${err.message}`));
    });
    socket.on("end", () => {
      console.log(`[HAProxy Socket] End event received`);
      finish("end");
    });
    socket.on("close", (hadError) => {
      console.log(`[HAProxy Socket] Close event received, hadError: ${hadError}`);
      finish("close");
    });

    socket.connect(socketPath, () => {
      connected = true;
      console.log(`[HAProxy Socket] Connected, sending command: ${command}`);
      // Write command with newline, then signal we're done writing
      socket.write(`${command}\n`, () => {
        console.log(`[HAProxy Socket] Write callback fired, calling socket.end()`);
        socket.end();
      });
    });
  });
}

/**
 * Parse HAProxy info output into structured data
 */
function parseHaproxyInfo(output: string): HaproxyInfo {
  const info: Partial<HaproxyInfo> = {};

  const lines = output.trim().split("\n");
  for (const line of lines) {
    const [key, value] = line.split(": ");
    if (!key || value === undefined) continue;

    const cleanKey = key.toLowerCase().replace(/\s+/g, "_");

    // Try to parse as number
    const numValue = Number(value);
    if (!isNaN(numValue)) {
      info[cleanKey] = numValue;
    } else {
      info[cleanKey] = value;
    }
  }

  return info as HaproxyInfo;
}

/**
 * Parse HAProxy stats CSV output into structured data
 */
function parseHaproxyStats(csvData: string): HaproxyStatsData {
  const lines = csvData.trim().split("\n").filter(line => line.trim());

  if (lines.length === 0) {
    return { frontends: [], backends: [], servers: [] };
  }

  let headerLine = lines[0];
  if (!headerLine) {
    return { frontends: [], backends: [], servers: [] };
  }

  headerLine = headerLine.replace(/^#\s*/, "");

  if (!headerLine.includes(",")) {
    return { frontends: [], backends: [], servers: [] };
  }

  const headers = headerLine.split(",");

  const frontends: BackendStats[] = [];
  const backends: BackendStats[] = [];
  const servers: BackendStats[] = [];

  // Parse each data line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("#")) continue;

    const values = line.split(",");
    const entry: Record<string, string | number> = {};

    // Map values to headers
    headers.forEach((header, index) => {
      const value = values[index];
      if (value === undefined || value === "") {
        entry[header] = "";
        return;
      }

      // Try to parse as number
      const numValue = Number(value);
      if (!isNaN(numValue)) {
        entry[header] = numValue;
      } else {
        entry[header] = value;
      }
    });

    // Determine type based on svname (service name)
    const type = entry.svname === "FRONTEND" ? "frontend"
               : entry.svname === "BACKEND" ? "backend"
               : "server";

    const stats: BackendStats = {
      name: String(entry.pxname || ""),
      type,
      status: String(entry.status || ""),

      // Request counters
      total_requests: Number(entry.stot || 0),
      http_requests_rate: Number(entry.req_rate || 0),

      // Response codes
      http_responses_1xx: Number(entry.hrsp_1xx || 0),
      http_responses_2xx: Number(entry.hrsp_2xx || 0),
      http_responses_3xx: Number(entry.hrsp_3xx || 0),
      http_responses_4xx: Number(entry.hrsp_4xx || 0),
      http_responses_5xx: Number(entry.hrsp_5xx || 0),
      http_responses_other: Number(entry.hrsp_other || 0),

      // Traffic volume
      bytes_in: Number(entry.bin || 0),
      bytes_out: Number(entry.bout || 0),

      // Connection stats
      current_sessions: Number(entry.scur || 0),
      max_sessions: Number(entry.smax || 0),
      session_limit: Number(entry.slim || 0),
      session_rate: Number(entry.rate || 0),
      session_rate_max: Number(entry.rate_max || 0),

      // Queue stats
      current_queue: Number(entry.qcur || 0),
      max_queue: Number(entry.qmax || 0),

      // Server health (optional)
      check_status: entry.check_status ? String(entry.check_status) : undefined,
      check_duration: entry.check_duration ? Number(entry.check_duration) : undefined,
      last_status_change: entry.lastchg ? Number(entry.lastchg) : undefined,
      downtime: entry.downtime ? Number(entry.downtime) : undefined,
    };

    if (type === "frontend") {
      frontends.push(stats);
    } else if (type === "backend") {
      backends.push(stats);
    } else {
      servers.push(stats);
    }
  }

  return { frontends, backends, servers };
}

/**
 * Get global HAProxy info
 */
export async function getHaproxyInfo(): Promise<HaproxyInfo> {
  const output = await sendHaproxySocketCommand("show info");
  return parseHaproxyInfo(output);
}

/**
 * Get all HAProxy stats
 */
export async function getHaproxyStats(): Promise<HaproxyStatsData> {
  const output = await sendHaproxySocketCommand("show stat");
  console.log(`[HAProxy Stats] Raw response length: ${output.length}, first 500 chars: ${output.substring(0, 500)}`);
  const stats = parseHaproxyStats(output);
  console.log(`[HAProxy Stats] Parsed: ${stats.frontends.length} frontends, ${stats.backends.length} backends, ${stats.servers.length} servers`);
  return stats;
}

/**
 * Get stats for a specific backend
 */
export async function getBackendStats(backendName: string): Promise<BackendStats | null> {
  const stats = await getHaproxyStats();
  return stats.backends.find(b => b.name === backendName) || null;
}

/**
 * Get stats for a specific frontend
 */
export async function getFrontendStats(frontendName: string): Promise<BackendStats | null> {
  const stats = await getHaproxyStats();
  return stats.frontends.find(f => f.name === frontendName) || null;
}

/**
 * Check if HAProxy is running by querying the stats socket
 */
export async function isHaproxyRunning(): Promise<boolean> {
  try {
    await getHaproxyInfo();
    return true;
  } catch {
    return false;
  }
}

export interface HaproxyHealthResult {
  healthy: boolean;
  method: "http" | "socket" | "none";
  error?: string;
}

export async function checkHaproxyHealthHttp(
  endpoint?: string
): Promise<{ healthy: boolean; error?: string }> {
  const { getHaproxyStatsUrl } = await import("../config/env.js");
  const statsUrl = endpoint || getHaproxyStatsUrl();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(statsUrl, {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    return { healthy: response.ok };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function checkHaproxyHealth(): Promise<HaproxyHealthResult> {
  const httpHealth = await checkHaproxyHealthHttp();
  if (httpHealth.healthy) {
    return { healthy: true, method: "http" };
  }

  try {
    const running = await isHaproxyRunning();
    if (running) {
      return { healthy: true, method: "socket" };
    }
  } catch {
    // Socket also failed
  }

  return {
    healthy: false,
    method: "none",
    error: httpHealth.error || "Both HTTP and socket health checks failed",
  };
}
