/**
 * S3 Providers Schema Unit Tests
 *
 * Tests for the S3 providers database schema definitions.
 */

import { describe, it, expect } from "vitest";
import {
  s3Providers,
  type S3Provider,
  type NewS3Provider,
} from "../../../../../packages/database/src/schema/s3-providers";

describe("S3 Providers Schema", () => {
  // ============================================================================
  // Table Structure Tests
  // ============================================================================

  describe("s3Providers table", () => {
    it("should have id as primary key", () => {
      const idColumn = s3Providers.id;
      expect(idColumn.name).toBe("id");
      expect(idColumn.dataType).toBe("string");
    });

    it("should have name as required field", () => {
      const nameColumn = s3Providers.name;
      expect(nameColumn.name).toBe("name");
      expect(nameColumn.notNull).toBe(true);
    });

    it("should have endpoint as required field", () => {
      const endpointColumn = s3Providers.endpoint;
      expect(endpointColumn.name).toBe("endpoint");
      expect(endpointColumn.notNull).toBe(true);
    });

    it("should have region with default us-east-1", () => {
      const regionColumn = s3Providers.region;
      expect(regionColumn.name).toBe("region");
      expect(regionColumn.notNull).toBe(true);
      expect(regionColumn.hasDefault).toBe(true);
    });

    it("should have bucket as required field", () => {
      const bucketColumn = s3Providers.bucket;
      expect(bucketColumn.name).toBe("bucket");
      expect(bucketColumn.notNull).toBe(true);
    });

    it("should have pathPrefix with default empty string", () => {
      const pathPrefixColumn = s3Providers.pathPrefix;
      expect(pathPrefixColumn.name).toBe("path_prefix");
      expect(pathPrefixColumn.hasDefault).toBe(true);
    });

    it("should have credentials as required fields", () => {
      expect(s3Providers.accessKeyId.name).toBe("access_key_id");
      expect(s3Providers.secretAccessKey.name).toBe("secret_access_key");
      expect(s3Providers.accessKeyId.notNull).toBe(true);
      expect(s3Providers.secretAccessKey.notNull).toBe(true);
    });

    it("should have isDefault with default false", () => {
      const isDefaultColumn = s3Providers.isDefault;
      expect(isDefaultColumn.name).toBe("is_default");
      expect(isDefaultColumn.notNull).toBe(true);
      expect(isDefaultColumn.hasDefault).toBe(true);
    });

    it("should have usage flags with defaults", () => {
      expect(s3Providers.usedForBuildCache.name).toBe("used_for_build_cache");
      expect(s3Providers.usedForArtifacts.name).toBe("used_for_artifacts");
      expect(s3Providers.usedForBuildCache.hasDefault).toBe(true);
      expect(s3Providers.usedForArtifacts.hasDefault).toBe(true);
    });

    it("should have connection status fields", () => {
      expect(s3Providers.isConnected.name).toBe("is_connected");
      expect(s3Providers.lastConnectionCheck.name).toBe("last_connection_check");
      expect(s3Providers.connectionError.name).toBe("connection_error");
      expect(s3Providers.isConnected.hasDefault).toBe(true);
    });

    it("should have timestamps", () => {
      expect(s3Providers.createdAt.name).toBe("created_at");
      expect(s3Providers.updatedAt.name).toBe("updated_at");
      expect(s3Providers.createdAt.notNull).toBe(true);
      expect(s3Providers.updatedAt.notNull).toBe(true);
    });
  });

  // ============================================================================
  // Type Tests
  // ============================================================================

  describe("S3Provider types", () => {
    it("should export S3Provider select type for AWS S3", () => {
      const provider: S3Provider = {
        id: "s3-1",
        name: "AWS Production",
        endpoint: "https://s3.amazonaws.com",
        region: "us-west-2",
        bucket: "my-app-artifacts",
        pathPrefix: "deployments/",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        isDefault: true,
        usedForBuildCache: true,
        usedForArtifacts: true,
        isConnected: true,
        lastConnectionCheck: new Date(),
        connectionError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(provider.id).toBe("s3-1");
      expect(provider.endpoint).toBe("https://s3.amazonaws.com");
      expect(provider.isDefault).toBe(true);
    });

    it("should export S3Provider select type for MinIO", () => {
      const provider: S3Provider = {
        id: "s3-2",
        name: "Local MinIO",
        endpoint: "http://minio:9000",
        region: "us-east-1",
        bucket: "local-artifacts",
        pathPrefix: "",
        accessKeyId: "minioadmin",
        secretAccessKey: "minioadmin",
        isDefault: false,
        usedForBuildCache: true,
        usedForArtifacts: false,
        isConnected: true,
        lastConnectionCheck: new Date(),
        connectionError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(provider.endpoint).toBe("http://minio:9000");
      expect(provider.usedForArtifacts).toBe(false);
    });

    it("should export NewS3Provider insert type with minimal fields", () => {
      const newProvider: NewS3Provider = {
        id: "s3-1",
        name: "New Provider",
        endpoint: "https://s3.amazonaws.com",
        bucket: "my-bucket",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      };

      expect(newProvider.id).toBe("s3-1");
      expect(newProvider.name).toBe("New Provider");
    });

    it("should handle provider with connection error", () => {
      const provider: Partial<S3Provider> = {
        isConnected: false,
        lastConnectionCheck: new Date(),
        connectionError: "AccessDenied: Access Denied",
      };

      expect(provider.isConnected).toBe(false);
      expect(provider.connectionError).toContain("AccessDenied");
    });

    it("should handle provider with path prefix", () => {
      const provider: Partial<S3Provider> = {
        bucket: "shared-bucket",
        pathPrefix: "app1/production/",
      };

      expect(provider.pathPrefix).toBe("app1/production/");
    });

    it("should handle provider for build cache only", () => {
      const provider: Partial<S3Provider> = {
        usedForBuildCache: true,
        usedForArtifacts: false,
      };

      expect(provider.usedForBuildCache).toBe(true);
      expect(provider.usedForArtifacts).toBe(false);
    });

    it("should handle provider for artifacts only", () => {
      const provider: Partial<S3Provider> = {
        usedForBuildCache: false,
        usedForArtifacts: true,
      };

      expect(provider.usedForBuildCache).toBe(false);
      expect(provider.usedForArtifacts).toBe(true);
    });

    it("should handle Cloudflare R2 provider", () => {
      const provider: Partial<S3Provider> = {
        name: "Cloudflare R2",
        endpoint: "https://account-id.r2.cloudflarestorage.com",
        region: "auto",
        bucket: "r2-bucket",
      };

      expect(provider.endpoint).toContain("r2.cloudflarestorage.com");
      expect(provider.region).toBe("auto");
    });

    it("should handle DigitalOcean Spaces provider", () => {
      const provider: Partial<S3Provider> = {
        name: "DO Spaces",
        endpoint: "https://nyc3.digitaloceanspaces.com",
        region: "nyc3",
        bucket: "my-space",
      };

      expect(provider.endpoint).toContain("digitaloceanspaces.com");
    });
  });
});
