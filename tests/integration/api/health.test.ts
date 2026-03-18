import { describe, it, expect, afterAll } from "vitest";
import { testClient } from "../setup/test-client";
import { closeTestDb } from "../setup/test-db";

describe("Health API", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  describe("GET /health", () => {
    it("should return 200 when all services are healthy", async () => {
      const response = await testClient.get<{
        status: string;
        redis: any;
        timestamp: string;
      }>("/health");

      expect(response.status).toBe(200);
      expect(response.body.status).toBeDefined();
      expect(response.body).toHaveProperty("redis");
      expect(response.body).toHaveProperty("timestamp");
    });

    it("should include Redis status", async () => {
      const response = await testClient.get<{ redis: any }>("/health");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("redis");
      expect(typeof response.body.redis).toBe("string");
    });

    it("should include timestamp in ISO format", async () => {
      const response = await testClient.get<{ timestamp: string }>("/health");

      expect(response.status).toBe(200);
      expect(response.body.timestamp).toBeDefined();

      // Verify it's a valid ISO timestamp
      const timestamp = new Date(response.body.timestamp);
      expect(timestamp.toISOString()).toBe(response.body.timestamp);
    });

    it("should return consistent health check structure", async () => {
      const response = await testClient.get<any>("/health");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: expect.any(String),
        redis: expect.any(String),
        timestamp: expect.any(String),
      });
    });

    it("should have recent timestamp", async () => {
      const beforeTime = new Date();
      const response = await testClient.get<{ timestamp: string }>("/health");
      const afterTime = new Date();

      expect(response.status).toBe(200);

      const responseTime = new Date(response.body.timestamp);
      expect(responseTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(responseTime.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });
  });
});
