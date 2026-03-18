/**
 * Analytics Live WebSocket Endpoint Unit Tests
 *
 * Tests for the HTTP upgrade route and the WebSocket handler
 * that manages first-message authentication and Redis pub/sub forwarding.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";

// ---------------------------------------------------------------------------
// Hoisted helpers — vi.mock factories are hoisted above all other code, so
// anything they reference must also be hoisted via vi.hoisted().
// ---------------------------------------------------------------------------

const { mockSubscriber, verifyTestJwt } = vi.hoisted(() => {
  function base64url(input: string | Buffer): string {
    const buf = typeof input === "string" ? Buffer.from(input) : input;
    return buf.toString("base64url");
  }

  function verifyTestJwt(
    token: string,
    secret: Uint8Array,
  ): { payload: Record<string, unknown> } {
    const { createHmac: hmac } = require("crypto");
    const secretStr = Buffer.from(secret).toString();
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid token");

    const header = parts[0] as string;
    const body = parts[1] as string;
    const sig = parts[2] as string;
    const expectedSig = base64url(
      hmac("sha256", secretStr).update(`${header}.${body}`).digest(),
    );
    if (sig !== expectedSig) throw new Error("Invalid signature");

    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error("Token expired");
    }

    return { payload };
  }

  const mockSubscriber = {
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    disconnect: vi.fn(),
  };

  return { mockSubscriber, verifyTestJwt };
});

// ---------------------------------------------------------------------------
// Minimal JWT helper using Node crypto (no jose dependency needed)
// ---------------------------------------------------------------------------

function base64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

function createTestJwt(
  payload: Record<string, unknown>,
  secret: string,
  options?: { expired?: boolean },
): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const body = base64url(
    JSON.stringify({
      ...payload,
      iat: now,
      exp: options?.expired ? now - 60 : now + 300,
    }),
  );
  const signature = base64url(
    createHmac("sha256", secret).update(`${header}.${body}`).digest(),
  );
  return `${header}.${body}.${signature}`;
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("jose", () => ({
  jwtVerify: vi.fn(async (token: string, secret: Uint8Array) =>
    verifyTestJwt(token, secret),
  ),
}));

vi.mock("../../../../../apps/analytics/src/services/config-cache", () => ({
  getConfigByUuid: vi.fn(),
}));

vi.mock("../../../../../packages/shared/src/redis/client", () => ({
  getRedisClient: vi.fn().mockReturnValue({
    duplicate: vi.fn().mockReturnValue(mockSubscriber),
  }),
}));

const TEST_SECRET = "test-jwt-secret-32-chars-long!!!";

vi.mock("../../../../../packages/shared/src/config/env", () => ({
  getAnalyticsJwtSecret: vi.fn().mockReturnValue("test-jwt-secret-32-chars-long!!!"),
}));

import app from "../../../../../apps/analytics/src/routes/live";
import { createWebSocketHandler } from "../../../../../apps/analytics/src/routes/live";
import { getConfigByUuid } from "../../../../../apps/analytics/src/services/config-cache";

describe("Analytics Live WebSocket Endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // Part 1: HTTP Route Tests (GET /:uuid/live)
  // ============================================================================

  describe("GET /:uuid/live", () => {
    it("should return 404 for unknown UUID", async () => {
      vi.mocked(getConfigByUuid).mockReturnValue(undefined);

      const res = await app.request("/unknown-uuid/live");

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("CONFIG_NOT_FOUND");
      expect(body.error.message).toBe("Not found");
    });

    it("should return 404 for disabled config", async () => {
      vi.mocked(getConfigByUuid).mockReturnValue({
        id: "config-1",
        enabled: false,
      } as ReturnType<typeof getConfigByUuid>);

      const res = await app.request("/some-uuid/live");

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("CONFIG_NOT_FOUND");
    });

    it("should return 426 when Upgrade header is missing", async () => {
      vi.mocked(getConfigByUuid).mockReturnValue({
        id: "config-1",
        enabled: true,
        publicDashboardEnabled: true,
      } as ReturnType<typeof getConfigByUuid>);

      const res = await app.request("/some-uuid/live");

      expect(res.status).toBe(426);
      const body = await res.json();
      expect(body.error.code).toBe("UPGRADE_REQUIRED");
      expect(body.error.message).toBe("WebSocket upgrade required");
    });

    it("should return 426 when Upgrade header is not 'websocket'", async () => {
      vi.mocked(getConfigByUuid).mockReturnValue({
        id: "config-1",
        enabled: true,
        publicDashboardEnabled: true,
      } as ReturnType<typeof getConfigByUuid>);

      const res = await app.request("/some-uuid/live", {
        headers: { Upgrade: "h2c" },
      });

      expect(res.status).toBe(426);
      const body = await res.json();
      expect(body.error.code).toBe("UPGRADE_REQUIRED");
    });

    it("should return 500 when server object is not available in env", async () => {
      vi.mocked(getConfigByUuid).mockReturnValue({
        id: "config-1",
        enabled: true,
        publicDashboardEnabled: true,
      } as ReturnType<typeof getConfigByUuid>);

      const res = await app.request("/some-uuid/live", {
        headers: { Upgrade: "websocket" },
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe("INTERNAL_ERROR");
      expect(body.error.message).toBe("WebSocket not supported");
    });
  });

  // ============================================================================
  // Part 2: WebSocket Handler Tests (createWebSocketHandler)
  // ============================================================================

  describe("createWebSocketHandler", () => {
    let handler: ReturnType<typeof createWebSocketHandler>;
    let mockWs: {
      data: { configId: string };
      send: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      handler = createWebSocketHandler();
      mockWs = {
        data: { configId: "config-1" },
        send: vi.fn(),
        close: vi.fn(),
      };
    });

    afterEach(() => {
      // Clean up module-level channelSubscribers map so state doesn't leak between tests.
      handler.close(mockWs);
    });

    // --------------------------------------------------------------------------
    // open handler
    // --------------------------------------------------------------------------

    describe("open", () => {
      it("should set a 5-second auth timeout", () => {
        vi.useFakeTimers();
        try {
          handler.open(mockWs);

          // Before 5 seconds, no messages should be sent
          vi.advanceTimersByTime(4999);
          expect(mockWs.send).not.toHaveBeenCalled();
          expect(mockWs.close).not.toHaveBeenCalled();

          // At 5 seconds, the timeout fires
          vi.advanceTimersByTime(1);
          expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({ type: "auth_timeout" }));
          expect(mockWs.close).toHaveBeenCalledWith(1008, "Auth timeout");
        } finally {
          vi.useRealTimers();
        }
      });

      it("should send auth_timeout and close with 1008 after 5 seconds without auth", () => {
        vi.useFakeTimers();
        try {
          handler.open(mockWs);

          vi.advanceTimersByTime(5000);

          expect(mockWs.send).toHaveBeenCalledTimes(1);
          expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({ type: "auth_timeout" }));
          expect(mockWs.close).toHaveBeenCalledWith(1008, "Auth timeout");
        } finally {
          vi.useRealTimers();
        }
      });
    });

    // --------------------------------------------------------------------------
    // message handler - valid JWT
    // --------------------------------------------------------------------------

    describe("message with valid JWT", () => {
      it("should send auth_ok and subscribe to Redis channel", async () => {
        handler.open(mockWs);

        const token = createTestJwt({ configId: "config-1" }, TEST_SECRET);

        await handler.message(mockWs, JSON.stringify({ type: "auth", token }));

        expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({ type: "auth_ok" }));
        expect(mockSubscriber.subscribe).toHaveBeenCalledWith("analytics:live:config-1");
        expect(mockSubscriber.on).toHaveBeenCalledWith("message", expect.any(Function));
      });

      it("should set authenticated to true after valid auth", async () => {
        handler.open(mockWs);

        const token = createTestJwt({ configId: "config-1" }, TEST_SECRET);
        await handler.message(mockWs, JSON.stringify({ type: "auth", token }));

        // Sending another message after auth should not trigger auth logic again.
        // The handler ignores post-auth messages silently, so no send/close should occur.
        mockWs.send.mockClear();
        mockWs.close.mockClear();
        await handler.message(mockWs, JSON.stringify({ type: "something_else" }));

        expect(mockWs.send).not.toHaveBeenCalled();
        expect(mockWs.close).not.toHaveBeenCalled();
      });
    });

    // --------------------------------------------------------------------------
    // message handler - invalid JWT
    // --------------------------------------------------------------------------

    describe("message with invalid JWT", () => {
      it("should send auth_error and close with 1008 for an invalid token", async () => {
        handler.open(mockWs);

        await handler.message(
          mockWs,
          JSON.stringify({ type: "auth", token: "not-a-valid-jwt-token" }),
        );

        expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({ type: "auth_error" }));
        expect(mockWs.close).toHaveBeenCalledWith(1008, "Invalid token");
      });

      it("should send auth_error and close with 1008 for a token signed with the wrong secret", async () => {
        handler.open(mockWs);

        const token = createTestJwt({ configId: "config-1" }, "wrong-secret-that-is-long!!!!!!!!");

        await handler.message(mockWs, JSON.stringify({ type: "auth", token }));

        expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({ type: "auth_error" }));
        expect(mockWs.close).toHaveBeenCalledWith(1008, "Invalid token");
      });

      it("should send auth_error and close with 1008 for an expired token", async () => {
        handler.open(mockWs);

        const token = createTestJwt({ configId: "config-1" }, TEST_SECRET, { expired: true });

        await handler.message(mockWs, JSON.stringify({ type: "auth", token }));

        expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({ type: "auth_error" }));
        expect(mockWs.close).toHaveBeenCalledWith(1008, "Invalid token");
      });
    });

    // --------------------------------------------------------------------------
    // message handler - wrong configId
    // --------------------------------------------------------------------------

    describe("message with wrong configId in JWT", () => {
      it("should send auth_error and close with 'Token scope mismatch'", async () => {
        handler.open(mockWs);

        const token = createTestJwt({ configId: "different-config" }, TEST_SECRET);

        await handler.message(mockWs, JSON.stringify({ type: "auth", token }));

        expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({ type: "auth_error" }));
        expect(mockWs.close).toHaveBeenCalledWith(1008, "Token scope mismatch");
      });
    });

    // --------------------------------------------------------------------------
    // message handler - non-auth type
    // --------------------------------------------------------------------------

    describe("message with non-auth type", () => {
      it("should send auth_error and close for a message without type 'auth'", async () => {
        handler.open(mockWs);

        await handler.message(mockWs, JSON.stringify({ type: "subscribe", channel: "test" }));

        expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({ type: "auth_error" }));
        expect(mockWs.close).toHaveBeenCalledWith(1008, "Invalid auth");
      });

      it("should send auth_error and close for a message missing the token field", async () => {
        handler.open(mockWs);

        await handler.message(mockWs, JSON.stringify({ type: "auth" }));

        expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({ type: "auth_error" }));
        expect(mockWs.close).toHaveBeenCalledWith(1008, "Invalid auth");
      });
    });

    // --------------------------------------------------------------------------
    // message handler - invalid JSON
    // --------------------------------------------------------------------------

    describe("message with invalid JSON", () => {
      it("should send auth_error and close for unparseable message", async () => {
        handler.open(mockWs);

        await handler.message(mockWs, "this is not json {{{");

        expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({ type: "auth_error" }));
        expect(mockWs.close).toHaveBeenCalledWith(1008, "Invalid message");
      });
    });

    // --------------------------------------------------------------------------
    // close handler
    // --------------------------------------------------------------------------

    describe("close", () => {
      it("should clear timeout, disconnect Redis subscriber, and remove from map", async () => {
        vi.useFakeTimers();
        try {
          handler.open(mockWs);

          // Authenticate so subscriber gets set
          const token = createTestJwt({ configId: "config-1" }, TEST_SECRET);
          await handler.message(mockWs, JSON.stringify({ type: "auth", token }));

          handler.close(mockWs);

          expect(mockSubscriber.disconnect).toHaveBeenCalled();

          // After close, the timeout should have been cleared - advancing time
          // should not trigger the auth_timeout
          mockWs.send.mockClear();
          vi.advanceTimersByTime(10000);
          expect(mockWs.send).not.toHaveBeenCalledWith(JSON.stringify({ type: "auth_timeout" }));
        } finally {
          vi.useRealTimers();
        }
      });

      it("should clear timeout without Redis disconnect when not authenticated", () => {
        vi.useFakeTimers();
        try {
          handler.open(mockWs);

          handler.close(mockWs);

          // The subscriber was initialised as null (cast to Redis), so the
          // `if (state.subscriber)` check in the source will be falsy and
          // disconnect should not be called.
          expect(mockSubscriber.disconnect).not.toHaveBeenCalled();

          // Verify the timeout was cleared by advancing past 5 seconds
          mockWs.send.mockClear();
          vi.advanceTimersByTime(10000);
          expect(mockWs.send).not.toHaveBeenCalled();
        } finally {
          vi.useRealTimers();
        }
      });

      it("should handle close for an unknown ws gracefully", () => {
        const unknownWs = {
          data: { configId: "config-unknown" },
          send: vi.fn(),
          close: vi.fn(),
        };

        // Should not throw when closing a ws that was never opened
        expect(() => handler.close(unknownWs)).not.toThrow();
      });
    });
  });
});
