/**
 * Cluster Nodes Schema Unit Tests
 */

import { describe, it, expect } from "vitest";
import {
  clusterNodes,
  clusterNodeStatusEnum,
  type ClusterNode,
  type InsertClusterNode,
} from "../../../../../packages/database/src/schema/cluster-nodes";

describe("Cluster Nodes Schema", () => {
  describe("clusterNodeStatusEnum", () => {
    it("should define all expected status values", () => {
      expect(clusterNodeStatusEnum.enumValues).toContain("online");
      expect(clusterNodeStatusEnum.enumValues).toContain("offline");
      expect(clusterNodeStatusEnum.enumValues).toContain("syncing");
      expect(clusterNodeStatusEnum.enumValues).toContain("error");
      expect(clusterNodeStatusEnum.enumValues).toContain("unknown");
    });

    it("should have exactly 5 status values", () => {
      expect(clusterNodeStatusEnum.enumValues).toHaveLength(5);
    });

    it("should have correct enum name", () => {
      expect(clusterNodeStatusEnum.enumName).toBe("cluster_node_status");
    });
  });

  describe("clusterNodes table", () => {
    it("should have id as primary key", () => {
      expect(clusterNodes.id.name).toBe("id");
      expect(clusterNodes.id.dataType).toBe("string");
    });

    it("should have name as not null", () => {
      expect(clusterNodes.name.name).toBe("name");
      expect(clusterNodes.name.notNull).toBe(true);
    });

    it("should have apiUrl as unique and not null", () => {
      expect(clusterNodes.apiUrl.name).toBe("api_url");
      expect(clusterNodes.apiUrl.notNull).toBe(true);
      expect(clusterNodes.apiUrl.isUnique).toBe(true);
    });

    it("should have apiKey as not null", () => {
      expect(clusterNodes.apiKey.name).toBe("api_key");
      expect(clusterNodes.apiKey.notNull).toBe(true);
    });

    it("should have status with default unknown", () => {
      expect(clusterNodes.status.name).toBe("status");
      expect(clusterNodes.status.notNull).toBe(true);
      expect(clusterNodes.status.hasDefault).toBe(true);
    });

    it("should have lastSeenAt as nullable timestamp", () => {
      expect(clusterNodes.lastSeenAt.name).toBe("last_seen_at");
      expect(clusterNodes.lastSeenAt.notNull).toBe(false);
    });

    it("should have lastSyncAt as nullable timestamp", () => {
      expect(clusterNodes.lastSyncAt.name).toBe("last_sync_at");
      expect(clusterNodes.lastSyncAt.notNull).toBe(false);
    });

    it("should have lastSyncError as nullable text", () => {
      expect(clusterNodes.lastSyncError.name).toBe("last_sync_error");
    });

    it("should have configVersion as nullable text", () => {
      expect(clusterNodes.configVersion.name).toBe("config_version");
    });

    it("should have isLocal with default false", () => {
      expect(clusterNodes.isLocal.name).toBe("is_local");
      expect(clusterNodes.isLocal.notNull).toBe(true);
      expect(clusterNodes.isLocal.hasDefault).toBe(true);
    });

    it("should have metadata as nullable jsonb", () => {
      expect(clusterNodes.metadata.name).toBe("metadata");
    });

    it("should have createdAt and updatedAt with defaults", () => {
      expect(clusterNodes.createdAt.name).toBe("created_at");
      expect(clusterNodes.createdAt.notNull).toBe(true);
      expect(clusterNodes.createdAt.hasDefault).toBe(true);
      expect(clusterNodes.updatedAt.name).toBe("updated_at");
      expect(clusterNodes.updatedAt.notNull).toBe(true);
      expect(clusterNodes.updatedAt.hasDefault).toBe(true);
    });
  });
});
