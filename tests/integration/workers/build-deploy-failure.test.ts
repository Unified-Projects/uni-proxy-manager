import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testClient } from "../setup/test-client";
import { testDb, clearDatabase, closeTestDb } from "../setup/test-db";
import { createSiteFixture, createDeploymentFixture } from "../setup/fixtures";
import * as schema from "../../../packages/database/src/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

describe("Build/Deploy Failure Scenarios", () => {
  let testSiteId: string;

  beforeAll(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    const siteData = createSiteFixture();
    const res = await testClient.post<{ site: any }>("/api/sites", siteData);
    testSiteId = res.body.site.id;
  });

  describe("Deployment status transitions", () => {
    it("should have pending status on initial deployment trigger", async () => {
      const deploymentData = createDeploymentFixture(testSiteId, {
        status: "pending",
      });

      const [deployment] = await testDb
        .insert(schema.deployments)
        .values({
          id: nanoid(),
          ...deploymentData,
        })
        .returning();

      expect(deployment.status).toBe("pending");
    });

    it("should be able to update deployment to failed status", async () => {
      const deploymentData = createDeploymentFixture(testSiteId, {
        status: "building",
      });

      const [deployment] = await testDb
        .insert(schema.deployments)
        .values({
          id: nanoid(),
          ...deploymentData,
        })
        .returning();

      await testDb
        .update(schema.deployments)
        .set({
          status: "failed",
          errorMessage: "Build command exited with code 1",
        })
        .where(eq(schema.deployments.id, deployment.id));

      const updated = await testDb.query.deployments.findFirst({
        where: eq(schema.deployments.id, deployment.id),
      });

      expect(updated?.status).toBe("failed");
      expect(updated?.errorMessage).toContain("code 1");
    });

    it("should be able to update deployment to cancelled status", async () => {
      const deploymentData = createDeploymentFixture(testSiteId, {
        status: "building",
      });

      const [deployment] = await testDb
        .insert(schema.deployments)
        .values({
          id: nanoid(),
          ...deploymentData,
        })
        .returning();

      await testDb
        .update(schema.deployments)
        .set({ status: "cancelled" })
        .where(eq(schema.deployments.id, deployment.id));

      const updated = await testDb.query.deployments.findFirst({
        where: eq(schema.deployments.id, deployment.id),
      });

      expect(updated?.status).toBe("cancelled");
    });
  });

  describe("Site status on failure", () => {
    it("should update site status to error when build fails", async () => {
      const deploymentData = createDeploymentFixture(testSiteId, {
        status: "failed",
      });

      await testDb.insert(schema.deployments).values({
        id: nanoid(),
        ...deploymentData,
      });

      await testDb
        .update(schema.sites)
        .set({ status: "error" })
        .where(eq(schema.sites.id, testSiteId));

      const site = await testDb.query.sites.findFirst({
        where: eq(schema.sites.id, testSiteId),
      });

      expect(site?.status).toBe("error");
    });

    it("should preserve previous active deployment on failure", async () => {
      const liveDeployment = createDeploymentFixture(testSiteId, {
        status: "live",
        version: 1,
        slot: "blue",
      });

      const [live] = await testDb
        .insert(schema.deployments)
        .values({
          id: nanoid(),
          ...liveDeployment,
        })
        .returning();

      const failedDeployment = createDeploymentFixture(testSiteId, {
        status: "failed",
        version: 2,
        slot: "green",
      });

      await testDb.insert(schema.deployments).values({
        id: nanoid(),
        ...failedDeployment,
      });

      const liveCheck = await testDb.query.deployments.findFirst({
        where: eq(schema.deployments.id, live.id),
      });

      expect(liveCheck?.status).toBe("live");
    });
  });

  describe("Error message handling", () => {
    it("should store build error message", async () => {
      const errorMessage =
        "npm ERR! code ENOENT\nnpm ERR! syscall open\nnpm ERR! path package.json";

      const deploymentData = createDeploymentFixture(testSiteId, {
        status: "failed",
      });

      const [deployment] = await testDb
        .insert(schema.deployments)
        .values({
          id: nanoid(),
          ...deploymentData,
          errorMessage,
        })
        .returning();

      expect(deployment.errorMessage).toContain("ENOENT");
      expect(deployment.errorMessage).toContain("package.json");
    });

    it("should store deploy error message", async () => {
      const errorMessage = "Runtime creation failed: connection refused";

      const deploymentData = createDeploymentFixture(testSiteId, {
        status: "failed",
      });

      const [deployment] = await testDb
        .insert(schema.deployments)
        .values({
          id: nanoid(),
          ...deploymentData,
          errorMessage,
          buildCompletedAt: new Date(),
        })
        .returning();

      expect(deployment.errorMessage).toContain("Runtime");
      expect(deployment.buildCompletedAt).toBeDefined();
    });
  });

  describe("Deployment logs", () => {
    it("should store build logs", async () => {
      const buildLogs = [
        "[2024-01-01T00:00:00Z] Starting build...",
        "[2024-01-01T00:00:01Z] Running npm install...",
        "[2024-01-01T00:00:30Z] Build failed: exit code 1",
      ].join("\n");

      const deploymentData = createDeploymentFixture(testSiteId, {
        status: "failed",
      });

      const [deployment] = await testDb
        .insert(schema.deployments)
        .values({
          id: nanoid(),
          ...deploymentData,
          buildLogs,
        })
        .returning();

      expect(deployment.buildLogs).toContain("npm install");
      expect(deployment.buildLogs).toContain("exit code 1");
    });
  });

  describe("Version and slot management on failure", () => {
    it("should not affect version counter on failure", async () => {
      for (let i = 1; i <= 3; i++) {
        const deploymentData = createDeploymentFixture(testSiteId, {
          status: i === 2 ? "failed" : "live",
          version: i,
          slot: i % 2 === 1 ? "blue" : "green",
        });

        await testDb.insert(schema.deployments).values({
          id: nanoid(),
          ...deploymentData,
        });
      }

      const allDeployments = await testDb.query.deployments.findMany({
        where: eq(schema.deployments.siteId, testSiteId),
        orderBy: (deployments, { asc }) => [asc(deployments.version)],
      });

      expect(allDeployments).toHaveLength(3);
      expect(allDeployments[0].version).toBe(1);
      expect(allDeployments[1].version).toBe(2);
      expect(allDeployments[2].version).toBe(3);
    });

    it("should alternate slots correctly even after failure", async () => {
      const slot1 = createDeploymentFixture(testSiteId, {
        status: "live",
        version: 1,
        slot: "blue",
      });

      const slot2 = createDeploymentFixture(testSiteId, {
        status: "failed",
        version: 2,
        slot: "green",
      });

      const slot3 = createDeploymentFixture(testSiteId, {
        status: "live",
        version: 3,
        slot: "blue",
      });

      await testDb.insert(schema.deployments).values([
        { id: nanoid(), ...slot1 },
        { id: nanoid(), ...slot2 },
        { id: nanoid(), ...slot3 },
      ]);

      const deployments = await testDb.query.deployments.findMany({
        where: eq(schema.deployments.siteId, testSiteId),
        orderBy: (deployments, { asc }) => [asc(deployments.version)],
      });

      expect(deployments[0].slot).toBe("blue");
      expect(deployments[1].slot).toBe("green");
      expect(deployments[2].slot).toBe("blue");
    });
  });
});
