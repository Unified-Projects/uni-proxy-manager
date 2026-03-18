/**
 * OpenRuntimes Executor Client
 *
 * Based on the official API documentation:
 * https://github.com/open-runtimes/executor
 *
 * The executor runs on port 80 (internally) and provides endpoints for:
 * - Creating/managing runtime containers
 * - Executing functions
 * - Streaming logs
 * - Health checks
 */

export interface OpenRuntimesConfig {
  /** Executor endpoint (e.g., http://openruntimes-executor:80) */
  endpoint: string;
  /** Secret key for authentication (OPR_EXECUTOR_SECRET) */
  secret: string;
}

/**
 * Parameters for creating a runtime container
 */
export interface CreateRuntimeParams {
  /** Unique runtime identifier */
  runtimeId: string;
  /** Container image (e.g., openruntimes/node:v4-20.0) */
  image: string;
  /** Source file/tarball path in storage */
  source?: string;
  /** Output destination folder in storage */
  destination?: string;
  /** Entry point file */
  entrypoint?: string;
  /** Environment variables for the runtime */
  variables?: Record<string, string>;
  /** Container startup entrypoint commands */
  runtimeEntrypoint?: string;
  /** Timeout in seconds (default: 600) */
  timeout?: number;
  /** CPU cores limit (default: 1) */
  cpus?: number;
  /** RAM in MB (default: 512) */
  memory?: number;
  /** Runtime version: v2 or v5 (default: v5) */
  version?: "v2" | "v5";
  /** Keep-alive ID for cleanup protection - runtimes with same ID share protection, newest wins */
  keepAliveId?: string;
}

/**
 * Runtime information returned from API
 */
export interface RuntimeInfo {
  runtimeId?: string;
  name?: string;
  image?: string;
  status?: string;
  created?: string | number;
  updated?: string | number;
  cpus?: number;
  memory?: number;
  listening?: number | boolean;
  initialised?: number | boolean;
}

/**
 * Parameters for executing a function
 */
export interface ExecuteFunctionParams {
  /** Runtime ID to execute on */
  runtimeId: string;
  /** Request body/payload */
  body?: string;
  /** URL path (default: /) */
  path?: string;
  /** HTTP method (default: GET) */
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS";
  /** Request headers */
  headers?: Record<string, string>;
  /** Execution timeout in seconds (default: 15) */
  timeout?: number;
  /** Override runtime environment variables */
  variables?: Record<string, string>;
  /** Override image (creates runtime if needed) */
  image?: string;
  /** Override source path */
  source?: string;
  /** Override entrypoint */
  entrypoint?: string;
  /** Override CPU limit */
  cpus?: number;
  /** Override memory limit */
  memory?: number;
  /** Runtime version */
  version?: "v2" | "v5";
  /** Startup commands */
  runtimeEntrypoint?: string;
  /** Enable execution logging (default: true) */
  logging?: boolean;
  /** Container restart policy: "always" keeps container warm, "no" for one-shot */
  restartPolicy?: "always" | "no";
  /** Keep-alive ID for cleanup protection when creating runtime on-demand */
  keepAliveId?: string;
}

/**
 * Function execution result
 */
export interface ExecutionResult {
  /** HTTP status code from function */
  statusCode: number;
  /** Response headers */
  headers: Record<string, string>;
  /** Response body - Uint8Array to preserve binary data (fonts, images, etc) */
  body: Uint8Array;
  /** Execution logs */
  logs: string;
  /** Error messages */
  errors: string;
  /** Execution duration in ms */
  duration: number;
}

/**
 * Parameters for building a runtime (Appwrite-style createRuntime for builds)
 */
export interface BuildRuntimeParams {
  /** Deployment ID */
  deploymentId: string;
  /** Project/Site ID */
  projectId: string;
  /** Source tarball path (from storage) */
  source: string;
  /** Container image (e.g., openruntimes/node:v5-20.0) */
  image: string;
  /** Runtime version: v2 or v5 */
  version: "v2" | "v5";
  /** CPU cores limit */
  cpus: number;
  /** RAM in MB */
  memory: number;
  /** Build timeout in seconds */
  timeout: number;
  /** Whether to remove container after build (default: true) */
  remove?: boolean;
  /** Entry point file */
  entrypoint?: string;
  /** Output destination folder in storage (e.g., /storage/builds/app-{projectId}) */
  destination: string;
  /** Environment variables for the build */
  variables?: Record<string, string>;
  /** Build command to run (e.g., "npm install && npm run build") */
  command: string;
  /** Framework output directory (e.g., .next, dist) */
  outputDirectory?: string;
  /** Runtime entrypoint (optional, usually not needed for builds) */
  runtimeEntrypoint?: string;
}

/**
 * Build result from executor
 */
export interface BuildResult {
  /** Path to the built artifact */
  path: string;
  /** Size of the built artifact in bytes */
  size: number;
  /** Build output logs */
  output: Array<{ content: string }>;
}

/**
 * Health check response
 */
export interface HealthStatus {
  status: "pass" | "fail";
  version?: string;
}

export class OpenRuntimesClient {
  private endpoint: string;
  private secret: string;

  constructor(config: OpenRuntimesConfig) {
    this.endpoint = config.endpoint.replace(/\/$/, "");
    this.secret = config.secret;
  }

  private getStatus(runtime: RuntimeInfo | null): string {
    if (!runtime?.status) return "";
    return runtime.status.toLowerCase();
  }

  private isRuntimeReadyInfo(runtime: RuntimeInfo | null): runtime is RuntimeInfo {
    if (!runtime) return false;

    if (runtime.listening !== undefined) {
      const listening = Number(runtime.listening);
      if (!Number.isNaN(listening)) {
        if (listening === 1) return true;
        if (listening === 0) {
          const initialised = Number(runtime.initialised);
          if (!Number.isNaN(initialised) && initialised === 1) {
            return true;
          }
          return false;
        }
      }
    }

    if (runtime.initialised !== undefined) {
      const initialised = Number(runtime.initialised);
      if (!Number.isNaN(initialised) && initialised === 1) {
        return true;
      }
    }

    const status = this.getStatus(runtime);
    if (status === "ready") return true;
    if (status.startsWith("up")) return true;

    return false;
  }

  private isRuntimeErrorInfo(runtime: RuntimeInfo | null): boolean {
    if (!runtime) return false;
    const status = this.getStatus(runtime);
    return (
      status === "error" ||
      status.includes("exited") ||
      status.includes("dead")
    );
  }

  /**
   * Build multipart form data body string (Appwrite-style)
   */
  private buildMultipartBody(params: Record<string, unknown>, boundary: string): string {
    const parts: string[] = [];

    const addPart = (key: string, value: unknown) => {
      if (value === undefined || value === null) return;

      let stringValue: string;
      if (typeof value === "object") {
        stringValue = JSON.stringify(value);
      } else {
        stringValue = String(value);
      }

      parts.push(`--${boundary}\r\n`);
      parts.push(`Content-Disposition: form-data; name="${key}"\r\n\r\n`);
      parts.push(`${stringValue}\r\n`);
    };

    for (const [key, value] of Object.entries(params)) {
      addPart(key, value);
    }

    parts.push(`--${boundary}--\r\n`);
    return parts.join("");
  }

  /**
   * Make an authenticated request to the executor
   *
   * URT (Unified Runtimes) API:
   * - Health: GET /v1/health with Authorization: Bearer {secret}
   * - Runtimes: GET/POST/DELETE /v1/runtimes with Authorization: Bearer {secret}
   * - Executions: POST /v1/runtimes/{runtimeId}/executions with Authorization: Bearer {secret}
   */
  private async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      timeout?: number;
      stream?: boolean;
      runtimeId?: string;
      useMultipart?: boolean;
    } = {}
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutMs = (options.timeout || 30) * 1000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const isExecution = path.includes("/executions");
      const useMultipart = options.useMultipart ?? true; // URT defaults to multipart for executions
      const boundary = `----UrtBoundary${Date.now()}`;

      // URT uses Bearer token authentication for the API
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.secret}`,
      };

      // URT supports multipart/form-data for executions (matching Appwrite executor format)
      if (useMultipart) {
        headers["Content-Type"] = `multipart/form-data; boundary=${boundary}`;
        headers["Accept"] = "multipart/form-data";
      } else {
        headers["Content-Type"] = "application/json";
      }

      let bodyContent: string | undefined;
      if (options.body) {
        if (useMultipart) {
          bodyContent = this.buildMultipartBody(options.body as Record<string, unknown>, boundary);
        } else {
          bodyContent = JSON.stringify(options.body);
        }
      }

      const response = await fetch(`${this.endpoint}${path}`, {
        method: options.method || "GET",
        headers,
        body: bodyContent,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `URT Executor API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      if (options.stream) {
        return response as unknown as T;
      }

      // Parse multipart response if needed (URT uses multipart/form-data for executions)
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("multipart/form-data")) {
        // Use arrayBuffer to preserve binary data (fonts, images, etc)
        // JavaScript strings are UTF-16 and corrupt binary when using text()
        const buffer = await response.arrayBuffer();
        return this.parseMultipartResponseBinary(new Uint8Array(buffer), contentType) as T;
      }

      return response.json() as Promise<T>;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Parse multipart form-data response using binary operations
   *
   * Uses Uint8Array to preserve binary data (fonts, images, etc).
   * JavaScript strings are UTF-16 and corrupt binary when using text().
   */
  private parseMultipartResponseBinary(data: Uint8Array, contentType: string): Record<string, unknown> {
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) {
      // Fallback - decode as text
      const decoder = new TextDecoder();
      return { body: decoder.decode(data) };
    }

    const boundary = boundaryMatch[1];
    const boundaryBytes = new TextEncoder().encode(`--${boundary}`);
    const crlfCrlfLength = 4; // \r\n\r\n

    const result: Record<string, unknown> = {};
    const decoder = new TextDecoder();

    // Find all boundary positions
    const boundaryPositions: number[] = [];
    for (let i = 0; i <= data.length - boundaryBytes.length; i++) {
      let match = true;
      for (let j = 0; j < boundaryBytes.length; j++) {
        if (data[i + j] !== boundaryBytes[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        boundaryPositions.push(i);
      }
    }

    // Process each part between boundaries
    for (let p = 0; p < boundaryPositions.length - 1; p++) {
      const currentPos = boundaryPositions[p];
      const nextPos = boundaryPositions[p + 1];
      if (currentPos === undefined || nextPos === undefined) continue;

      const partStart = currentPos + boundaryBytes.length;
      const partEnd = nextPos;

      // Skip leading CRLF after boundary
      let contentStart = partStart;
      if (data[contentStart] === 13 && data[contentStart + 1] === 10) {
        contentStart += 2;
      }

      // Find header/body separator (CRLFCRLF)
      let headerEnd = -1;
      for (let i = contentStart; i <= partEnd - crlfCrlfLength; i++) {
        if (data[i] === 13 && data[i + 1] === 10 && data[i + 2] === 13 && data[i + 3] === 10) {
          headerEnd = i;
          break;
        }
      }

      if (headerEnd === -1) continue;

      // Parse headers as text (headers are always ASCII)
      const headersBytes = data.slice(contentStart, headerEnd);
      const headersText = decoder.decode(headersBytes);

      // Body starts after CRLFCRLF
      const bodyStart = headerEnd + 4;
      let bodyEnd = partEnd;

      // Remove trailing CRLF before next boundary
      if (bodyEnd >= 2 && data[bodyEnd - 2] === 13 && data[bodyEnd - 1] === 10) {
        bodyEnd -= 2;
      }

      // Extract field name from headers
      const nameMatch = headersText.match(/name="([^"]+)"/);
      if (nameMatch && nameMatch[1]) {
        const name = nameMatch[1];
        const bodyBytes = data.slice(bodyStart, bodyEnd);

        // For metadata fields, decode as text and parse JSON
        if (name === "headers" || name === "statusCode" || name === "duration" || name === "startTime") {
          const bodyText = decoder.decode(bodyBytes);
          try {
            result[name] = JSON.parse(bodyText);
          } catch {
            result[name] = bodyText;
          }
        } else if (name === "logs" || name === "errors") {
          // Logs and errors are text
          result[name] = decoder.decode(bodyBytes);
        } else if (name === "body") {
          // Body is kept as Uint8Array to preserve binary data
          result[name] = bodyBytes;
        } else {
          // Unknown fields - decode as text
          result[name] = decoder.decode(bodyBytes);
        }
      }
    }

    return result;
  }

  /**
   * Create a new runtime container
   *
   * POST /v1/runtimes
   */
  async createRuntime(params: CreateRuntimeParams): Promise<RuntimeInfo> {
    const body: Record<string, unknown> = {
      runtimeId: params.runtimeId,
      image: params.image,
    };

    if (params.source) body.source = params.source;
    if (params.destination) body.destination = params.destination;
    if (params.entrypoint) body.entrypoint = params.entrypoint;
    if (params.variables) body.variables = params.variables;
    if (params.runtimeEntrypoint) body.runtimeEntrypoint = params.runtimeEntrypoint;
    if (params.timeout) body.timeout = params.timeout;
    if (params.cpus) body.cpus = params.cpus;
    if (params.memory) body.memory = params.memory;
    if (params.version) body.version = params.version;
    if (params.keepAliveId) body.keepAliveId = params.keepAliveId;

    return this.request<RuntimeInfo>("/v1/runtimes", {
      method: "POST",
      body,
      timeout: params.timeout || 600,
      useMultipart: false, // Runtimes use JSON format
    });
  }

  /**
   * Build a runtime using the executor (Appwrite-style)
   *
   * This creates a build container that:
   * 1. Extracts the source tarball
   * 2. Runs the build command using helpers/build.sh
   * 3. Packages the output and saves to destination
   * 4. Removes the container when done (if remove=true)
   *
   * POST /v1/runtimes
   */
  async buildRuntime(params: BuildRuntimeParams): Promise<BuildResult> {
    // Runtime ID format: {projectId}-{deploymentId}-build (matches Appwrite)
    const runtimeId = `${params.projectId}-${params.deploymentId}-build`;

    // Normalize version (v3/v4 -> v5)
    let version = params.version;
    if (version === "v2") {
      // Keep v2 as-is
    } else {
      version = "v5";
    }

    // Build command format (matches Appwrite):
    // v2: tar -zxf /tmp/code.tar.gz -C /usr/code && cd /usr/local/src/ && ./build.sh
    // v5: tar -zxf /tmp/code.tar.gz -C /mnt/code && helpers/build.sh "{command}"
    let fullCommand: string;
    if (version === "v2") {
      fullCommand = `tar -zxf /tmp/code.tar.gz -C /usr/code && cd /usr/local/src/ && ./build.sh`;
    } else {
      const escapedCommand = params.command.replace(/'/g, "'\\''");
      fullCommand = `tar -zxf /tmp/code.tar.gz -C /mnt/code && helpers/build.sh '${escapedCommand}'`;
    }

    const body: Record<string, unknown> = {
      runtimeId,
      source: params.source,
      destination: params.destination,
      image: params.image,
      entrypoint: params.entrypoint || "",
      variables: params.variables || {},
      remove: params.remove ?? true,
      command: fullCommand,
      cpus: params.cpus,
      memory: params.memory,
      version,
      timeout: params.timeout,
      outputDirectory: params.outputDirectory || "",
      runtimeEntrypoint: params.runtimeEntrypoint || "",
    };

    try {
      const result = await this.request<BuildResult>("/v1/runtimes", {
        method: "POST",
        body,
        timeout: params.timeout,
        runtimeId,
        useMultipart: false, // Runtimes use JSON format
      });

      return result;
    } catch (error) {
      console.error("[OpenRuntimes] buildRuntime failed:", {
        runtimeId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Stream build logs from executor (SSE-based, like Appwrite)
   * Retries until the container is ready or timeout expires.
   *
   * GET /v1/runtimes/{runtimeId}/logs
   */
  async streamBuildLogs(
    projectId: string,
    deploymentId: string,
    options?: { timeout?: number; callback?: (logs: string) => void }
  ): Promise<void> {
    const runtimeId = `${projectId}-${deploymentId}-build`;
    const timeout = options?.timeout || 600;
    const startTime = Date.now();
    const maxRetries = 30; // Retry for up to 60 seconds (30 * 2s)
    let retryCount = 0;

    // Create a separate controller for log streaming (longer timeout)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout * 1000);

    try {
      // Retry loop - wait for container to be ready
      while (retryCount < maxRetries) {
        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed > timeout) {
          return;
        }

        try {
          const response = await fetch(
            `${this.endpoint}/v1/runtimes/${runtimeId}/logs?timeout=${timeout}`,
            {
              method: "GET",
              headers: {
                Authorization: `Bearer ${this.secret}`,
                Accept: "text/event-stream",
                "x-opr-runtime-id": runtimeId,
                "x-opr-addressing-method": "anycast-efficient",
                "x-edge-bypass-gateway": "1",
              },
              signal: controller.signal,
            }
          );

          if (!response.ok) {
            const errorText = await response.text();
            // Container not ready yet - retry
            if (response.status === 500 && errorText.includes("not found")) {
              retryCount++;
              await new Promise((r) => setTimeout(r, 2000)); // Wait 2s before retry
              continue;
            }
            throw new Error(
              `Log stream error: ${response.status} ${response.statusText} - ${errorText}`
            );
          }

          if (!response.body || !options?.callback) {
            return;
          }

          // Successfully connected - stream logs
          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const text = decoder.decode(value, { stream: true });
              if (text) {
                options.callback(text);
              }
            }
          } finally {
            reader.releaseLock();
          }
          return; // Successfully streamed, exit
        } catch (fetchError) {
          // Network errors - retry
          if (fetchError instanceof Error && fetchError.name !== "AbortError") {
            retryCount++;
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          throw fetchError;
        }
      }
    } catch (error) {
      // Abort errors are expected when build finishes
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Get build runtime status
   *
   * GET /v1/runtimes/{runtimeId}
   */
  async getBuildStatus(projectId: string, deploymentId: string): Promise<RuntimeInfo | null> {
    const runtimeId = `${projectId}-${deploymentId}-build`;
    return this.getRuntime(runtimeId);
  }

  /**
   * Check if a build is still running
   */
  async isBuildRunning(projectId: string, deploymentId: string): Promise<boolean> {
    const runtime = await this.getBuildStatus(projectId, deploymentId);
    if (!runtime) return false;

    const status = this.getStatus(runtime);
    // Build is running if container exists and is not in error/exited state
    return status !== "" && !this.isRuntimeErrorInfo(runtime);
  }

  /**
   * List all active runtime containers
   *
   * GET /v1/runtimes
   */
  async listRuntimes(): Promise<RuntimeInfo[]> {
    const result = await this.request<RuntimeInfo[] | { runtimes: RuntimeInfo[] }>("/v1/runtimes");
    return Array.isArray(result) ? result : result.runtimes || [];
  }

  /**
   * Get details for a specific runtime
   *
   * GET /v1/runtimes/{runtimeId}
   */
  async getRuntime(runtimeId: string): Promise<RuntimeInfo | null> {
    try {
      return await this.request<RuntimeInfo>(`/v1/runtimes/${runtimeId}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("404")) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Delete a runtime container
   *
   * DELETE /v1/runtimes/{runtimeId}
   */
  async deleteRuntime(runtimeId: string): Promise<void> {
    await this.request(`/v1/runtimes/${runtimeId}`, {
      method: "DELETE",
    });
  }

  /**
   * Execute a function on a runtime
   *
   * POST /v1/runtimes/{runtimeId}/executions
   *
   * If the runtime doesn't exist and image/source are provided,
   * it will be created automatically (cold start)
   */
  async execute(params: ExecuteFunctionParams): Promise<ExecutionResult> {
    const startTime = Date.now();

    const body: Record<string, unknown> = {};

    if (params.body) body.body = params.body;
    if (params.path) body.path = params.path;
    if (params.method) body.method = params.method;
    if (params.headers) body.headers = params.headers;
    if (params.timeout) body.timeout = params.timeout;
    if (params.variables) body.variables = params.variables;
    if (params.image) body.image = params.image;
    if (params.source) body.source = params.source;
    if (params.entrypoint) body.entrypoint = params.entrypoint;
    if (params.cpus) body.cpus = params.cpus;
    if (params.memory) body.memory = params.memory;
    if (params.version) body.version = params.version;
    if (params.runtimeEntrypoint) body.runtimeEntrypoint = params.runtimeEntrypoint;
    if (params.keepAliveId) body.keepAliveId = params.keepAliveId;

    // Always pass these for proper container lifecycle (Appwrite-style)
    body.logging = params.logging ?? true;
    body.restartPolicy = params.restartPolicy ?? "always";

    const result = await this.request<{
      statusCode: number;
      headers: Record<string, string>;
      body: Uint8Array;
      logs: string;
      errors: string;
    }>(`/v1/runtimes/${params.runtimeId}/executions`, {
      method: "POST",
      body,
      timeout: (params.timeout || 15) + 15, // Add buffer for network latency (Appwrite uses +15)
      runtimeId: params.runtimeId,
    });

    return {
      ...result,
      body: result.body ?? new Uint8Array(),
      duration: Date.now() - startTime,
    };
  }

  /**
   * Stream logs from a runtime
   *
   * GET /v1/runtimes/{runtimeId}/logs
   *
   * Returns a Response object for streaming
   */
  async streamLogs(
    runtimeId: string,
    options?: { timeout?: number }
  ): Promise<ReadableStream<Uint8Array>> {
    const response = await this.request<Response>(
      `/v1/runtimes/${runtimeId}/logs?timeout=${options?.timeout || 600}`,
      {
        method: "GET",
        stream: true,
        timeout: options?.timeout || 600,
      }
    );

    if (!response.body) {
      throw new Error("No stream body available");
    }

    return response.body;
  }

  /**
   * Health check endpoint
   *
   * GET /v1/health
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    status?: string;
    version?: string;
    error?: string;
  }> {
    try {
      const result = await this.request<HealthStatus>("/v1/health", {
        timeout: 5,
      });
      return {
        healthy: result.status === "pass",
        status: result.status,
        version: result.version,
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Check if a runtime exists and is ready
   */
  async isRuntimeReady(runtimeId: string): Promise<boolean> {
    const runtime = await this.getRuntime(runtimeId);
    return this.isRuntimeReadyInfo(runtime);
  }

  /**
   * Wait for a runtime to be ready
   */
  async waitForRuntime(
    runtimeId: string,
    options?: { timeoutMs?: number; pollIntervalMs?: number }
  ): Promise<boolean> {
    const timeoutMs = options?.timeoutMs || 60000;
    const pollIntervalMs = options?.pollIntervalMs || 1000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const runtime = await this.getRuntime(runtimeId);

      if (this.isRuntimeReadyInfo(runtime)) {
        return true;
      }

      if (this.isRuntimeErrorInfo(runtime)) {
        throw new Error(`Runtime ${runtimeId} failed to start`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Timeout waiting for runtime ${runtimeId} to be ready`);
  }

  /**
   * Get or create a runtime, ensuring it's ready for execution
   */
  async ensureRuntime(params: CreateRuntimeParams): Promise<RuntimeInfo> {
    // Check if runtime already exists
    const existing = await this.getRuntime(params.runtimeId);

    if (this.isRuntimeReadyInfo(existing)) {
      return existing;
    }

    // Delete failed runtime if exists
    if (this.isRuntimeErrorInfo(existing)) {
      await this.deleteRuntime(params.runtimeId);
    }

    // Create new runtime
    const runtime = await this.createRuntime(params);

    // Wait for it to be ready
    await this.waitForRuntime(params.runtimeId);

    return runtime;
  }

}

// Singleton instance
let clientInstance: OpenRuntimesClient | null = null;

/**
 * Get the OpenRuntimes client instance
 */
export function getOpenRuntimesClient(): OpenRuntimesClient {
  if (!clientInstance) {
    const endpoint =
      process.env.SITES_EXECUTOR_ENDPOINT ||
      process.env.UNI_PROXY_MANAGER_OPENRUNTIMES_ENDPOINT ||
      "http://openruntimes-executor:80";

    const secret =
      process.env.SITES_EXECUTOR_SECRET ||
      process.env.UNI_PROXY_MANAGER_OPENRUNTIMES_SECRET;

    if (!secret) {
      throw new Error(
        "OpenRuntimes secret not configured. Set SITES_EXECUTOR_SECRET or UNI_PROXY_MANAGER_OPENRUNTIMES_SECRET"
      );
    }

    clientInstance = new OpenRuntimesClient({ endpoint, secret });
  }

  return clientInstance;
}

/**
 * Check if OpenRuntimes is configured
 */
export function isOpenRuntimesConfigured(): boolean {
  return !!(
    process.env.SITES_EXECUTOR_SECRET ||
    process.env.UNI_PROXY_MANAGER_OPENRUNTIMES_SECRET
  );
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  endpoint: string | null;
}

export function validateOpenRuntimesConfiguration(): ConfigValidationResult {
  const errors: string[] = [];

  const secret =
    process.env.SITES_EXECUTOR_SECRET ||
    process.env.UNI_PROXY_MANAGER_OPENRUNTIMES_SECRET;

  if (!secret) {
    errors.push(
      "OpenRuntimes executor secret not configured. " +
        "Set SITES_EXECUTOR_SECRET environment variable."
    );
  }

  const endpoint =
    process.env.SITES_EXECUTOR_ENDPOINT ||
    process.env.UNI_PROXY_MANAGER_OPENRUNTIMES_ENDPOINT ||
    "http://openruntimes-executor:80";

  try {
    new URL(endpoint);
  } catch {
    errors.push(
      `Invalid OpenRuntimes endpoint URL: ${endpoint}. ` +
        "Set SITES_EXECUTOR_ENDPOINT to a valid URL."
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    endpoint: errors.length === 0 ? endpoint : null,
  };
}

/**
 * Create a new OpenRuntimes client with custom config
 */
export function createOpenRuntimesClient(
  config: OpenRuntimesConfig
): OpenRuntimesClient {
  return new OpenRuntimesClient(config);
}

/**
 * Reset the singleton client (useful for testing)
 */
export function resetOpenRuntimesClient(): void {
  clientInstance = null;
}
