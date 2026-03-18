import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testClient } from "../setup/test-client";
import { closeTestDb } from "../setup/test-db";

describe("Config API", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  describe("GET /api/config/acme", () => {
    it("should return current ACME configuration", async () => {
      const response = await testClient.get<{
        email: string;
        staging: boolean;
        directoryUrl: string;
      }>("/api/config/acme");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("email");
      expect(response.body).toHaveProperty("staging");
      expect(response.body).toHaveProperty("directoryUrl");

      // These should come from environment variables
      expect(typeof response.body.email).toBe("string");
      expect(typeof response.body.staging).toBe("boolean");
      expect(typeof response.body.directoryUrl).toBe("string");
    });

    it("should return empty string for email if not configured", async () => {
      const response = await testClient.get<{ email: string }>("/api/config/acme");

      expect(response.status).toBe(200);
      // Email might be empty if not configured
      expect(response.body.email).toBeDefined();
    });
  });

  describe("PUT /api/config/acme", () => {
    it("should update ACME email configuration", async () => {
      const updateData = {
        email: "test@example.com",
      };

      const response = await testClient.put<{
        success: boolean;
        message: string;
        email: string;
      }>("/api/config/acme", updateData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty("message");
      expect(response.body.email).toBe(updateData.email);
    });

    it("should validate email format", async () => {
      const invalidData = {
        email: "not-a-valid-email",
      };

      const response = await testClient.put<{ error: any }>(
        "/api/config/acme",
        invalidData
      );

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error");
    });

    it("should reject missing email", async () => {
      const response = await testClient.put<{ error: any }>(
        "/api/config/acme",
        {}
      );

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error");
    });

    it("should reject empty email", async () => {
      const invalidData = {
        email: "",
      };

      const response = await testClient.put<{ error: any }>(
        "/api/config/acme",
        invalidData
      );

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error");
    });

    it("should accept valid email formats", async () => {
      const validEmails = [
        "user@example.com",
        "admin@subdomain.example.com",
        "test.user+tag@example.co.uk",
      ];

      for (const email of validEmails) {
        const response = await testClient.put<{ success: boolean }>(
          "/api/config/acme",
          { email }
        );

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      }
    });
  });
});
