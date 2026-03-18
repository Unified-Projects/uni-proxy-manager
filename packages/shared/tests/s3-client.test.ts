import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Use vi.hoisted() to create shared mock values available to vi.mock factories.
// IMPORTANT: do NOT call .mockImplementation(fn) inside vi.hoisted() - Vitest's
// transform reduces `vi.fn().mockImplementation(fn)` to just `fn` in that
// context. Set implementations as separate module-level statements instead.
const { mockSendFn, mockGetSignedUrl } = vi.hoisted(() => ({
  mockSendFn: vi.fn(),
  mockGetSignedUrl: vi.fn().mockResolvedValue("https://signed-url.example.com/file"),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(function () { return { send: mockSendFn }; }),
  PutObjectCommand: vi.fn(function (params: unknown) { return { params }; }),
  GetObjectCommand: vi.fn(function (params: unknown) { return { params }; }),
  DeleteObjectCommand: vi.fn(function (params: unknown) { return { params }; }),
  ListObjectsV2Command: vi.fn(function (params: unknown) { return { params }; }),
  HeadObjectCommand: vi.fn(function (params: unknown) { return { params }; }),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: mockGetSignedUrl,
}));

import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { S3Service, getS3Service, clearS3Instances, joinS3Key, type S3Config } from "../src/s3/client";

const mockPutObjectCommand = vi.mocked(PutObjectCommand);
const mockDeleteObjectCommand = vi.mocked(DeleteObjectCommand);

const mockS3Config: S3Config = {
  endpoint: "http://minio:9000",
  region: "us-east-1",
  bucket: "test-bucket",
  accessKeyId: "access-key",
  secretAccessKey: "secret-key",
  pathPrefix: "sites",
};

describe("S3Service", () => {
  let service: S3Service;

  beforeEach(() => {
    clearS3Instances();
    service = new S3Service(mockS3Config);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("initializes with correct config", () => {
      expect(service.getBucket()).toBe("test-bucket");
      expect(service.getPathPrefix()).toBe("sites");
    });

    it("handles empty path prefix", () => {
      const service2 = new S3Service({ ...mockS3Config, pathPrefix: undefined });
      expect(service2.getPathPrefix()).toBe("");
    });
  });

  describe("getFullKey", () => {
    it("builds explicit storage keys for URT-compatible paths", () => {
      expect(joinS3Key("sites", "builds/deploy-123/source.tar.gz")).toBe(
        "sites/builds/deploy-123/source.tar.gz"
      );
      expect(joinS3Key("sites/", "/artifacts/site-1/deploy-1")).toBe(
        "sites/artifacts/site-1/deploy-1"
      );
      expect(joinS3Key("", "/artifacts/site-1/deploy-1")).toBe(
        "artifacts/site-1/deploy-1"
      );
    });

    it("prepends path prefix to key", async () => {
      mockSendFn.mockResolvedValueOnce({ ETag: '"abc123"' });

      await service.upload("file.txt", Buffer.from("test"));

      expect(mockPutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: "sites/file.txt",
        })
      );
    });

    it("handles keys with leading slashes", async () => {
      mockSendFn.mockResolvedValueOnce({ ETag: '"abc123"' });

      await service.upload("/file.txt", Buffer.from("test"));

      expect(mockPutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: "sites/file.txt",
        })
      );
    });
  });

  describe("upload", () => {
    it("uploads a buffer with correct parameters", async () => {
      mockSendFn.mockResolvedValueOnce({ ETag: '"abc123"' });

      const result = await service.upload("test.txt", Buffer.from("test content"), {
        contentType: "text/plain",
        cacheControl: "max-age=3600",
        metadata: { custom: "value" },
      });

      expect(mockSendFn).toHaveBeenCalledTimes(1);
      expect(result.key).toBe("sites/test.txt");
      expect(result.etag).toBe('"abc123"');
    });

    it("uploads a string", async () => {
      mockSendFn.mockResolvedValueOnce({ ETag: '"def456"' });

      const result = await service.upload("text.txt", "string content");

      expect(result.key).toBe("sites/text.txt");
    });
  });

  describe("download", () => {
    it("downloads a file and returns metadata", async () => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from("test content");
        },
      };

      mockSendFn.mockResolvedValueOnce({
        Body: mockStream,
        ContentType: "text/plain",
        ContentLength: 12,
        Metadata: { custom: "value" },
      });

      const result = await service.download("test.txt");

      expect(result.contentType).toBe("text/plain");
      expect(result.contentLength).toBe(12);
      expect(result.metadata).toEqual({ custom: "value" });
    });

    it("throws error when no body returned", async () => {
      mockSendFn.mockResolvedValueOnce({});

      await expect(service.download("test.txt")).rejects.toThrow(
        "No body returned for key: sites/test.txt"
      );
    });
  });

  describe("downloadBuffer", () => {
    it("downloads file as buffer", async () => {
      const chunks = [Buffer.from("hello"), Buffer.from(" world")];
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of chunks) {
            yield chunk;
          }
        },
      };

      mockSendFn.mockResolvedValueOnce({
        Body: mockStream,
        ContentType: "text/plain",
      });

      const result = await service.downloadBuffer("test.txt");

      expect(result.toString()).toBe("hello world");
    });
  });

  describe("delete", () => {
    it("deletes a file", async () => {
      mockSendFn.mockResolvedValueOnce({});

      await service.delete("test.txt");

      expect(mockDeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: "test-bucket",
        Key: "sites/test.txt",
      });
    });
  });

  describe("deleteMany", () => {
    it("deletes multiple files", async () => {
      mockSendFn.mockResolvedValue({});

      await service.deleteMany(["file1.txt", "file2.txt", "file3.txt"]);

      expect(mockSendFn).toHaveBeenCalledTimes(3);
    });
  });

  describe("list", () => {
    it("lists objects with correct options", async () => {
      mockSendFn.mockResolvedValueOnce({
        Contents: [
          { Key: "sites/file1.txt", Size: 100, LastModified: new Date("2024-01-01"), ETag: '"abc"' },
          { Key: "sites/file2.txt", Size: 200, LastModified: new Date("2024-01-02"), ETag: '"def"' },
        ],
        NextContinuationToken: "token123",
        IsTruncated: true,
      });

      const result = await service.list({ prefix: "folder/", maxKeys: 100 });

      expect(result.objects).toHaveLength(2);
      expect(result.objects[0].key).toBe("sites/file1.txt");
      expect(result.objects[0].size).toBe(100);
      expect(result.continuationToken).toBe("token123");
      expect(result.isTruncated).toBe(true);
    });

    it("handles empty results", async () => {
      mockSendFn.mockResolvedValueOnce({
        Contents: undefined,
        IsTruncated: false,
      });

      const result = await service.list();

      expect(result.objects).toEqual([]);
      expect(result.isTruncated).toBe(false);
    });
  });

  describe("exists", () => {
    it("returns true when object exists", async () => {
      mockSendFn.mockResolvedValueOnce({});

      const result = await service.exists("test.txt");

      expect(result).toBe(true);
    });

    it("returns false when object not found", async () => {
      mockSendFn.mockRejectedValueOnce({ name: "NotFound" });

      const result = await service.exists("nonexistent.txt");

      expect(result).toBe(false);
    });

    it("throws on other errors", async () => {
      mockSendFn.mockRejectedValueOnce(new Error("Network error"));

      await expect(service.exists("test.txt")).rejects.toThrow("Network error");
    });
  });

  describe("getMetadata", () => {
    it("returns object metadata", async () => {
      mockSendFn.mockResolvedValueOnce({
        ContentType: "application/json",
        ContentLength: 1024,
        LastModified: new Date("2024-01-15"),
        Metadata: { version: "1" },
      });

      const result = await service.getMetadata("data.json");

      expect(result.contentType).toBe("application/json");
      expect(result.contentLength).toBe(1024);
      expect(result.metadata).toEqual({ version: "1" });
    });
  });

  describe("getPresignedDownloadUrl", () => {
    it("generates a presigned download URL", async () => {
      const result = await service.getPresignedDownloadUrl("file.txt", 7200);

      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        { expiresIn: 7200 }
      );
      expect(result).toBe("https://signed-url.example.com/file");
    });
  });

  describe("getPresignedUploadUrl", () => {
    it("generates a presigned upload URL", async () => {
      const result = await service.getPresignedUploadUrl("file.txt", {
        expiresInSeconds: 1800,
        contentType: "application/octet-stream",
      });

      expect(mockGetSignedUrl).toHaveBeenCalled();
      expect(result).toBe("https://signed-url.example.com/file");
    });
  });

  describe("testConnection", () => {
    it("returns success when connection works", async () => {
      mockSendFn.mockResolvedValueOnce({});

      const result = await service.testConnection();

      expect(result.success).toBe(true);
      expect(result.bucketInfo?.name).toBe("test-bucket");
    });

    it("returns error when connection fails", async () => {
      mockSendFn.mockRejectedValueOnce(new Error("Access Denied"));

      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toBe("Access Denied");
    });
  });

  describe("getBucketUsage", () => {
    it("calculates total usage", async () => {
      mockSendFn
        .mockResolvedValueOnce({
          Contents: [
            { Key: "file1.txt", Size: 100, LastModified: new Date("2024-01-01") },
            { Key: "file2.txt", Size: 200, LastModified: new Date("2024-01-02") },
          ],
          IsTruncated: false,
        });

      const result = await service.getBucketUsage();

      expect(result.totalObjects).toBe(2);
      expect(result.totalSize).toBe(300);
      expect(result.lastModified).toEqual(new Date("2024-01-02"));
    });

    it("handles pagination", async () => {
      mockSendFn
        .mockResolvedValueOnce({
          Contents: [{ Key: "file1.txt", Size: 100, LastModified: new Date("2024-01-01") }],
          NextContinuationToken: "token",
          IsTruncated: true,
        })
        .mockResolvedValueOnce({
          Contents: [{ Key: "file2.txt", Size: 200, LastModified: new Date("2024-01-02") }],
          IsTruncated: false,
        });

      const result = await service.getBucketUsage();

      expect(result.totalObjects).toBe(2);
      expect(result.totalSize).toBe(300);
    });
  });

  describe("copy", () => {
    it("copies an object by download and re-upload", async () => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from("content");
        },
      };

      mockSendFn
        .mockResolvedValueOnce({
          Body: mockStream,
          ContentType: "text/plain",
          Metadata: { key: "value" },
        })
        .mockResolvedValueOnce({
          Body: mockStream,
          ContentType: "text/plain",
        })
        .mockResolvedValueOnce({ ETag: '"copied"' });

      await service.copy("source.txt", "destination.txt");

      expect(mockSendFn).toHaveBeenCalledTimes(3);
    });
  });
});

describe("getS3Service", () => {
  beforeEach(() => {
    clearS3Instances();
  });

  it("returns the same instance for same config", () => {
    const service1 = getS3Service(mockS3Config);
    const service2 = getS3Service(mockS3Config);

    expect(service1).toBe(service2);
  });

  it("returns different instances for different configs", () => {
    const service1 = getS3Service(mockS3Config);
    const service2 = getS3Service({ ...mockS3Config, bucket: "other-bucket" });

    expect(service1).not.toBe(service2);
  });
});

describe("clearS3Instances", () => {
  it("clears cached instances", () => {
    const service1 = getS3Service(mockS3Config);
    clearS3Instances();
    const service2 = getS3Service(mockS3Config);

    expect(service1).not.toBe(service2);
  });
});
