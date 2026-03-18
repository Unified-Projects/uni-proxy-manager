/**
 * HAProxy client for integration tests
 * Provides utilities for sending requests through HAProxy and checking its state
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  responseTime: number;
}

export class HAProxyClient {
  private readonly httpPort: number;
  private readonly httpsPort: number;
  private readonly statsSocketPath: string;

  constructor(options: {
    httpPort?: number;
    httpsPort?: number;
    statsSocketPath?: string;
  } = {}) {
    this.httpPort = options.httpPort || 80;
    this.httpsPort = options.httpsPort || 443;
    this.statsSocketPath = options.statsSocketPath || "/var/run/haproxy/haproxy.sock";
  }

  /**
   * Send HTTP request through HAProxy
   */
  async request(
    hostname: string,
    path: string = "/",
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      https?: boolean;
      followRedirects?: boolean;
      timeout?: number;
      clientIp?: string;
    } = {}
  ): Promise<ProxyResponse> {
    const {
      method = "GET",
      headers = {},
      body,
      https = false,
      followRedirects = false,
      timeout = 5000,
      clientIp,
    } = options;

    const port = https ? this.httpsPort : this.httpPort;
    const protocol = https ? "https" : "http";
    const url = `${protocol}://localhost:${port}${path}`;

    const startTime = Date.now();

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: {
          Host: hostname,
          ...headers,
        },
        redirect: followRedirects ? "follow" : "manual",
        signal: AbortSignal.timeout(timeout),
      };

      if (body) {
        fetchOptions.body = body;
      }

      // Add X-Forwarded-For for client IP simulation
      if (clientIp) {
        (fetchOptions.headers as Record<string, string>)["X-Forwarded-For"] = clientIp;
      }

      const response = await fetch(url, fetchOptions);
      const responseTime = Date.now() - startTime;

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return {
        status: response.status,
        headers: responseHeaders,
        body: await response.text(),
        responseTime,
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === "TimeoutError") {
          return {
            status: 0,
            headers: {},
            body: "Request timeout",
            responseTime: timeout,
          };
        }
      }
      throw error;
    }
  }

  /**
   * Send HTTPS request through HAProxy
   */
  async requestHttps(
    hostname: string,
    path: string = "/",
    options: Omit<Parameters<typeof this.request>[2], "https"> = {}
  ): Promise<ProxyResponse> {
    return this.request(hostname, path, { ...options, https: true });
  }

  /**
   * Check if HAProxy is running and accepting connections
   */
  async isRunning(): Promise<boolean> {
    try {
      const response = await this.request("localhost", "/", { timeout: 2000 });
      // Even a 503 means HAProxy is running
      return response.status > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get HAProxy stats via socket (if available)
   */
  async getStats(): Promise<Record<string, any> | null> {
    try {
      const { stdout } = await execAsync(
        `echo "show stat" | socat stdio ${this.statsSocketPath}`
      );
      return this.parseStatsOutput(stdout);
    } catch {
      return null;
    }
  }

  /**
   * Parse HAProxy stats CSV output
   */
  private parseStatsOutput(output: string): Record<string, any> {
    const lines = output.trim().split("\n");
    if (lines.length < 2) return {};

    const headers = lines[0].replace("# ", "").split(",");
    const stats: Record<string, any> = { backends: {}, frontends: {} };

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",");
      const entry: Record<string, string> = {};

      for (let j = 0; j < headers.length && j < values.length; j++) {
        entry[headers[j]] = values[j];
      }

      const pxname = entry.pxname;
      const svname = entry.svname;

      if (svname === "FRONTEND") {
        stats.frontends[pxname] = entry;
      } else if (svname === "BACKEND") {
        stats.backends[pxname] = entry;
      }
    }

    return stats;
  }

  /**
   * Check backend health status
   */
  async getBackendStatus(backendName: string): Promise<"UP" | "DOWN" | "UNKNOWN"> {
    const stats = await this.getStats();
    if (!stats || !stats.backends[backendName]) {
      return "UNKNOWN";
    }
    return stats.backends[backendName].status === "UP" ? "UP" : "DOWN";
  }

  /**
   * Reload HAProxy configuration (via socket)
   */
  async reloadConfig(): Promise<boolean> {
    try {
      // Try socket-based reload first
      await execAsync(
        `echo "reload" | socat stdio ${this.statsSocketPath}`
      );
      return true;
    } catch {
      // Fall back to sending SIGHUP
      try {
        await execAsync("pkill -HUP haproxy");
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Validate HAProxy configuration file
   */
  async validateConfig(configPath: string): Promise<{ valid: boolean; message: string }> {
    try {
      const { stdout, stderr } = await execAsync(
        `haproxy -c -f ${configPath}`,
        { timeout: 10000 }
      );
      return {
        valid: true,
        message: stderr || stdout || "Configuration is valid",
      };
    } catch (error) {
      if (error instanceof Error && "stderr" in error) {
        return {
          valid: false,
          message: (error as any).stderr || error.message,
        };
      }
      return {
        valid: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Test if a specific backend server is being used for a host
   */
  async testRouting(
    hostname: string,
    expectedBackendAddress: string
  ): Promise<boolean> {
    // Make multiple requests to account for round-robin
    for (let i = 0; i < 5; i++) {
      const response = await this.request(hostname, "/", {
        headers: { "X-Test-Request": "true" },
      });
      // Check if X-Served-By or similar header matches
      if (response.headers["x-served-by"]?.includes(expectedBackendAddress)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if HTTPS redirect is working for a host
   */
  async testHttpsRedirect(hostname: string): Promise<boolean> {
    const response = await this.request(hostname, "/", {
      followRedirects: false,
    });
    return (
      response.status === 301 &&
      response.headers.location?.startsWith("https://")
    );
  }

  /**
   * Test if maintenance mode is blocking requests
   */
  async testMaintenanceMode(
    hostname: string,
    expectedStatus: number = 503
  ): Promise<boolean> {
    const response = await this.request(hostname, "/");
    return response.status === expectedStatus;
  }

  /**
   * Test if bypass IP is allowed through maintenance mode
   */
  async testMaintenanceBypass(
    hostname: string,
    bypassIp: string
  ): Promise<boolean> {
    const response = await this.request(hostname, "/", {
      clientIp: bypassIp,
    });
    // Should get 200 (or at least not 503) when using bypass IP
    return response.status !== 503;
  }

  /**
   * Get base URL for HTTP requests
   */
  getHttpBaseUrl(): string {
    return `http://localhost:${this.httpPort}`;
  }

  /**
   * Get base URL for HTTPS requests
   */
  getHttpsBaseUrl(): string {
    return `https://localhost:${this.httpsPort}`;
  }
}

/**
 * Create a HAProxy client instance
 */
export function createHAProxyClient(options?: ConstructorParameters<typeof HAProxyClient>[0]): HAProxyClient {
  return new HAProxyClient(options);
}

/**
 * Default HAProxy client for tests
 */
export const haproxyClient = new HAProxyClient({
  httpPort: parseInt(process.env.HAPROXY_HTTP_PORT || "8080", 10),
  httpsPort: parseInt(process.env.HAPROXY_HTTPS_PORT || "8443", 10),
  statsSocketPath: process.env.HAPROXY_STATS_SOCKET || "/var/run/haproxy/haproxy.sock",
});
