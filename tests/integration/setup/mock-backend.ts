/**
 * Mock HTTP backend server for integration tests
 * Provides programmatic control over responses
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "http";

interface MockResponse {
  status: number;
  body?: string;
  headers?: Record<string, string>;
  delay?: number; // Delay in ms before responding
}

interface RequestLog {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body?: string;
  timestamp: Date;
}

export class MockBackendServer {
  private server: Server | null = null;
  private port: number;
  private responseMap: Map<string, MockResponse> = new Map();
  private defaultResponse: MockResponse = { status: 200, body: "OK" };
  private requestLogs: RequestLog[] = [];
  private isHealthy: boolean = true;

  constructor(port: number = 0) {
    this.port = port;
  }

  /**
   * Start the mock server
   */
  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = createServer(async (req, res) => {
        await this.handleRequest(req, res);
      });

      this.server.on("error", reject);

      // Explicitly bind to 0.0.0.0 to ensure IPv4 connectivity
      this.server.listen(this.port, "0.0.0.0", () => {
        const address = this.server!.address();
        if (address && typeof address !== "string") {
          this.port = address.port;
          console.log(`[MockBackend] Started on port ${this.port}`);
          resolve(this.port);
        } else {
          reject(new Error("Failed to get server address"));
        }
      });
    });
  }

  /**
   * Stop the mock server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log(`[MockBackend] Stopped`);
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Handle incoming request
   */
  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    // Log the request
    const body = await this.readBody(req);
    this.requestLogs.push({
      method: req.method || "GET",
      url: req.url || "/",
      headers: req.headers,
      body,
      timestamp: new Date(),
    });

    // Check if server is set to unhealthy
    if (!this.isHealthy) {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("Service Unavailable");
      return;
    }

    // Get response for this path
    const path = req.url || "/";
    const response = this.responseMap.get(path) || this.defaultResponse;

    // Apply delay if specified
    if (response.delay) {
      await new Promise((r) => setTimeout(r, response.delay));
    }

    // Send response
    const headers = {
      "Content-Type": "text/plain",
      ...response.headers,
    };

    res.writeHead(response.status, headers);
    res.end(response.body || "");
  }

  /**
   * Read request body
   */
  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    });
  }

  /**
   * Set response for a specific path
   */
  setResponse(path: string, response: MockResponse): void {
    this.responseMap.set(path, response);
  }

  /**
   * Set default response for all paths
   */
  setDefaultResponse(response: MockResponse): void {
    this.defaultResponse = response;
  }

  /**
   * Set server health status
   */
  setHealthy(healthy: boolean): void {
    this.isHealthy = healthy;
  }

  /**
   * Get request logs
   */
  getRequestLogs(): RequestLog[] {
    return [...this.requestLogs];
  }

  /**
   * Get requests to a specific path
   */
  getRequestsTo(path: string): RequestLog[] {
    return this.requestLogs.filter((r) => r.url === path);
  }

  /**
   * Clear request logs
   */
  clearLogs(): void {
    this.requestLogs = [];
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.responseMap.clear();
    this.defaultResponse = { status: 200, body: "OK" };
    this.requestLogs = [];
    this.isHealthy = true;
  }

  /**
   * Get the port the server is running on
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Get the base URL
   */
  getBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }
}

/**
 * Create and start a mock backend server
 */
export async function createMockBackend(port: number = 0): Promise<MockBackendServer> {
  const server = new MockBackendServer(port);
  await server.start();
  return server;
}
