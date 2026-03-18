/**
 * S3 Client Unit Tests
 *
 * Tests for the S3 service client utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  S3Service,
  getS3Service,
  clearS3Instances,
  joinS3Key,
  type S3Config,
  type UploadOptions,
  type ListOptions,
} from "../../../../packages/shared/src/s3/client";

// Mock AWS SDK
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  PutObjectCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: "put" })),
  GetObjectCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: "get" })),
  DeleteObjectCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: "delete" })),
  ListObjectsV2Command: vi.fn().mockImplementation((params) => ({ ...params, _type: "list" })),
  HeadObjectCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: "head" })),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://presigned-url.example.com"),
}));

describe("S3 Client", () => {
  const testConfig: S3Config = {
    endpoint: "https://s3.amazonaws.com",
    region: "us-east-1",
    bucket: "test-bucket",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    pathPrefix: "test-prefix",
  };

  beforeEach(() => {
    clearS3Instances();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearS3Instances();
  });

  // ============================================================================
  // Constructor Tests
  // ============================================================================

  describe("S3Service constructor", () => {
    it("should create a new S3Service instance", () => {
      const service = new S3Service(testConfig);
      expect(service).toBeInstanceOf(S3Service);
    });

    it("should store bucket name", () => {
      const service = new S3Service(testConfig);
      expect(service.getBucket()).toBe("test-bucket");
    });

    it("should store path prefix", () => {
      const service = new S3Service(testConfig);
      expect(service.getPathPrefix()).toBe("test-prefix");
    });

    it("should handle missing path prefix", () => {
      const configNoPrefix = { ...testConfig, pathPrefix: undefined };
      const service = new S3Service(configNoPrefix);
      expect(service.getPathPrefix()).toBe("");
    });

    it("should handle empty path prefix", () => {
      const configEmptyPrefix = { ...testConfig, pathPrefix: "" };
      const service = new S3Service(configEmptyPrefix);
      expect(service.getPathPrefix()).toBe("");
    });
  });

  describe("joinS3Key", () => {
    it("joins a prefix and storage key without duplicate slashes", () => {
      expect(joinS3Key("sites", "builds/deploy-123/source.tar.gz")).toBe(
        "sites/builds/deploy-123/source.tar.gz"
      );
      expect(joinS3Key("sites/", "/artifacts/site-123/deploy-456")).toBe(
        "sites/artifacts/site-123/deploy-456"
      );
    });

    it("returns a bucket-relative key when no prefix is configured", () => {
      expect(joinS3Key(undefined, "/artifacts/site-123/deploy-456")).toBe(
        "artifacts/site-123/deploy-456"
      );
    });
  });

  // ============================================================================
  // Singleton Tests
  // ============================================================================

  describe("getS3Service", () => {
    it("should return cached instance for same config", () => {
      const service1 = getS3Service(testConfig);
      const service2 = getS3Service(testConfig);
      expect(service1).toBe(service2);
    });

    it("should return different instance for different bucket", () => {
      const service1 = getS3Service(testConfig);
      const service2 = getS3Service({ ...testConfig, bucket: "other-bucket" });
      expect(service1).not.toBe(service2);
    });

    it("should return different instance for different endpoint", () => {
      const service1 = getS3Service(testConfig);
      const service2 = getS3Service({ ...testConfig, endpoint: "https://minio:9000" });
      expect(service1).not.toBe(service2);
    });

    it("should return different instance for different path prefix", () => {
      const service1 = getS3Service(testConfig);
      const service2 = getS3Service({ ...testConfig, pathPrefix: "other-prefix" });
      expect(service1).not.toBe(service2);
    });
  });

  describe("clearS3Instances", () => {
    it("should clear all cached instances", () => {
      const service1 = getS3Service(testConfig);
      clearS3Instances();
      const service2 = getS3Service(testConfig);
      expect(service1).not.toBe(service2);
    });
  });

  // ============================================================================
  // Upload Options Type Tests
  // ============================================================================

  describe("UploadOptions type", () => {
    it("should accept content type option", () => {
      const options: UploadOptions = {
        contentType: "application/json",
      };
      expect(options.contentType).toBe("application/json");
    });

    it("should accept cache control option", () => {
      const options: UploadOptions = {
        cacheControl: "max-age=31536000",
      };
      expect(options.cacheControl).toBe("max-age=31536000");
    });

    it("should accept metadata option", () => {
      const options: UploadOptions = {
        metadata: {
          "x-amz-meta-custom": "value",
        },
      };
      expect(options.metadata).toHaveProperty("x-amz-meta-custom");
    });

    it("should accept all options combined", () => {
      const options: UploadOptions = {
        contentType: "text/plain",
        cacheControl: "no-cache",
        metadata: { key: "value" },
      };
      expect(options.contentType).toBe("text/plain");
      expect(options.cacheControl).toBe("no-cache");
      expect(options.metadata?.key).toBe("value");
    });
  });

  // ============================================================================
  // List Options Type Tests
  // ============================================================================

  describe("ListOptions type", () => {
    it("should accept prefix option", () => {
      const options: ListOptions = {
        prefix: "deployments/",
      };
      expect(options.prefix).toBe("deployments/");
    });

    it("should accept maxKeys option", () => {
      const options: ListOptions = {
        maxKeys: 100,
      };
      expect(options.maxKeys).toBe(100);
    });

    it("should accept continuationToken option", () => {
      const options: ListOptions = {
        continuationToken: "token123",
      };
      expect(options.continuationToken).toBe("token123");
    });

    it("should accept all options combined", () => {
      const options: ListOptions = {
        prefix: "builds/",
        maxKeys: 50,
        continuationToken: "next-page",
      };
      expect(options.prefix).toBe("builds/");
      expect(options.maxKeys).toBe(50);
      expect(options.continuationToken).toBe("next-page");
    });
  });

  // ============================================================================
  // S3Config Type Tests
  // ============================================================================

  describe("S3Config type", () => {
    it("should require all mandatory fields", () => {
      const config: S3Config = {
        endpoint: "https://s3.example.com",
        region: "eu-west-1",
        bucket: "my-bucket",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
      };

      expect(config.endpoint).toBe("https://s3.example.com");
      expect(config.region).toBe("eu-west-1");
      expect(config.bucket).toBe("my-bucket");
      expect(config.accessKeyId).toBe("access-key");
      expect(config.secretAccessKey).toBe("secret-key");
    });

    it("should allow optional pathPrefix", () => {
      const config: S3Config = {
        endpoint: "https://s3.example.com",
        region: "us-east-1",
        bucket: "my-bucket",
        accessKeyId: "key",
        secretAccessKey: "secret",
        pathPrefix: "prefix/path",
      };

      expect(config.pathPrefix).toBe("prefix/path");
    });
  });
});
