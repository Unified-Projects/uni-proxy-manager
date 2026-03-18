/**
 * Pomerium Restart Processor Unit Tests
 *
 * Tests for the Pomerium restart processor that handles
 * container restarts via Docker's atomic restart API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "http";
import type { Job } from "bullmq";
import type { PomeriumRestartJobData } from "@uni-proxy-manager/queue";

vi.mock("http", () => ({
  default: {
    request: vi.fn(),
  },
}));

import { processPomeriumRestart } from "../../../../../apps/pomerium-workers/src/processors/pomerium-restart";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function setupDockerResponse(statusCode: number, body = "") {
  vi.mocked(http.request).mockImplementation(
    (options: unknown, callback?: unknown) => {
      const cb = callback as ((res: unknown) => void) | undefined;
      const dataHandlers: Array<(chunk: string) => void> = [];
      const endHandlers: Array<() => void> = [];

      const mockRes = {
        statusCode,
        on: (event: string, handler: unknown) => {
          if (event === "data")
            dataHandlers.push(handler as (chunk: string) => void);
          if (event === "end") endHandlers.push(handler as () => void);
          return mockRes;
        },
      };

      cb?.(mockRes);

      Promise.resolve().then(() => {
        for (const h of dataHandlers) h(body);
        for (const h of endHandlers) h();
      });

      return {
        on: vi.fn().mockReturnThis(),
        setTimeout: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
        end: vi.fn(),
      } as unknown as ReturnType<typeof http.request>;
    }
  );
}

function setupDockerError(errorMessage: string) {
  vi.mocked(http.request).mockImplementation((options: unknown) => {
    let errorHandler: ((err: Error) => void) | undefined;

    const req = {
      on: vi.fn((event: string, handler: unknown) => {
        if (event === "error")
          errorHandler = handler as (err: Error) => void;
        return req;
      }),
      setTimeout: vi.fn().mockReturnThis(),
      destroy: vi.fn(),
      end: vi.fn(() => {
        Promise.resolve().then(() =>
          errorHandler?.(new Error(errorMessage))
        );
      }),
    };

    return req as unknown as ReturnType<typeof http.request>;
  });
}

function setupDockerTimeout() {
  vi.mocked(http.request).mockImplementation((options: unknown) => {
    let timeoutHandler: (() => void) | undefined;

    const req = {
      on: vi.fn().mockReturnThis(),
      setTimeout: vi.fn((ms: number, handler: () => void) => {
        timeoutHandler = handler;
        return req;
      }),
      destroy: vi.fn(),
      end: vi.fn(() => {
        Promise.resolve().then(() => timeoutHandler?.());
      }),
    };

    return req as unknown as ReturnType<typeof http.request>;
  });
}

function createMockJob(
  reason = "Manual restart from UI"
): Job<PomeriumRestartJobData> {
  return {
    id: "test-job-1",
    data: { reason },
  } as Job<PomeriumRestartJobData>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("processPomeriumRestart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // Success path
  // ============================================================================

  describe("success", () => {
    it("returns success:true and method:docker-restart when Docker returns 204", async () => {
      setupDockerResponse(204);

      const result = await processPomeriumRestart(createMockJob());

      expect(result.success).toBe(true);
      expect(result.method).toBe("docker-restart");
      expect(result.error).toBeUndefined();
    });

    it("returns success:true when Docker returns 200", async () => {
      setupDockerResponse(200);

      const result = await processPomeriumRestart(createMockJob());

      expect(result.success).toBe(true);
      expect(result.method).toBe("docker-restart");
    });

    it("calls POST /containers/uni-proxy-pomerium/restart?t=10", async () => {
      setupDockerResponse(204);

      await processPomeriumRestart(createMockJob());

      const [callOptions] = vi.mocked(http.request).mock
        .calls[0] as [{ path: string; method: string; socketPath: string }, unknown];
      expect(callOptions.path).toBe(
        "/containers/uni-proxy-pomerium/restart?t=10"
      );
      expect(callOptions.method).toBe("POST");
      expect(callOptions.socketPath).toBe("/var/run/docker.sock");
    });

    it("logs the reason from job data", async () => {
      setupDockerResponse(204);
      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await processPomeriumRestart(createMockJob("IdP credentials updated"));

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("IdP credentials updated")
      );
      consoleSpy.mockRestore();
    });
  });

  // ============================================================================
  // Container not found
  // ============================================================================

  describe("container not found (404)", () => {
    it("returns success:false when Docker returns 404", async () => {
      setupDockerResponse(404, "No such container: uni-proxy-pomerium");

      const result = await processPomeriumRestart(createMockJob());

      expect(result.success).toBe(false);
      expect(result.method).toBe("docker-restart");
      expect(result.error).toContain("Docker API returned 404");
    });
  });

  // ============================================================================
  // Docker socket unavailable
  // ============================================================================

  describe("docker socket unavailable", () => {
    it("returns success:false and ECONNREFUSED in error when socket is missing", async () => {
      setupDockerError(
        "connect ECONNREFUSED /var/run/docker.sock"
      );

      const result = await processPomeriumRestart(createMockJob());

      expect(result.success).toBe(false);
      expect(result.method).toBe("docker-restart");
      expect(result.error).toContain("ECONNREFUSED");
    });
  });

  // ============================================================================
  // Request timeout
  // ============================================================================

  describe("request timeout", () => {
    it("returns success:false and timeout error message", async () => {
      setupDockerTimeout();

      const result = await processPomeriumRestart(createMockJob());

      expect(result.success).toBe(false);
      expect(result.method).toBe("docker-restart");
      expect(result.error).toBe("Docker API request timed out");
    });
  });

  // ============================================================================
  // Result shape
  // ============================================================================

  describe("result shape", () => {
    it("always includes method:docker-restart regardless of outcome", async () => {
      setupDockerResponse(204);
      const successResult = await processPomeriumRestart(createMockJob());
      expect(successResult.method).toBe("docker-restart");

      vi.clearAllMocks();
      setupDockerResponse(500, "internal error");
      const failResult = await processPomeriumRestart(createMockJob());
      expect(failResult.method).toBe("docker-restart");
    });

    it("error is undefined on success", async () => {
      setupDockerResponse(204);
      const result = await processPomeriumRestart(createMockJob());
      expect(result.error).toBeUndefined();
    });

    it("error contains status code on non-2xx response", async () => {
      setupDockerResponse(500, "server error");
      const result = await processPomeriumRestart(createMockJob());
      expect(result.error).toContain("500");
    });
  });

  // ============================================================================
  // Uses 10s timeout for Docker requests
  // ============================================================================

  describe("request configuration", () => {
    it("sets a 10 second timeout on the HTTP request", async () => {
      setupDockerResponse(204);
      await processPomeriumRestart(createMockJob());

      const req = vi.mocked(http.request).mock.results[0]?.value as {
        setTimeout: ReturnType<typeof vi.fn>;
      };
      expect(req.setTimeout).toHaveBeenCalledWith(
        10000,
        expect.any(Function)
      );
    });
  });
});
