import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  type PutObjectCommandInput,
  type GetObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { type Readable } from "stream";

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  pathPrefix?: string;
}

export interface UploadOptions {
  contentType?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}

export interface ListOptions {
  prefix?: string;
  maxKeys?: number;
  continuationToken?: string;
}

export interface ListResult {
  objects: Array<{
    key: string;
    size: number;
    lastModified: Date;
    etag?: string;
  }>;
  continuationToken?: string;
  isTruncated: boolean;
}

export function joinS3Key(pathPrefix: string | undefined | null, key: string): string {
  const normalizedKey = key.replace(/^\/+/, "");
  const normalizedPrefix = (pathPrefix || "").replace(/^\/+|\/+$/g, "");

  if (!normalizedPrefix) {
    return normalizedKey;
  }

  return `${normalizedPrefix}/${normalizedKey}`.replace(/\/+/g, "/");
}

export class S3Service {
  private client: S3Client;
  private bucket: string;
  private pathPrefix: string;

  constructor(config: S3Config) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true, // Required for most S3-compatible services
    });
    this.bucket = config.bucket;
    this.pathPrefix = config.pathPrefix || "";
  }

  private getFullKey(key: string): string {
    return joinS3Key(this.pathPrefix, key);
  }

  /**
   * Upload a file to S3
   */
  async upload(
    key: string,
    body: Buffer | Readable | string,
    options: UploadOptions = {}
  ): Promise<{ key: string; etag?: string }> {
    const fullKey = this.getFullKey(key);

    const params: PutObjectCommandInput = {
      Bucket: this.bucket,
      Key: fullKey,
      Body: body,
      ContentType: options.contentType,
      CacheControl: options.cacheControl,
      Metadata: options.metadata,
    };

    const result = await this.client.send(new PutObjectCommand(params));

    return {
      key: fullKey,
      etag: result.ETag,
    };
  }

  /**
   * Download a file from S3
   */
  async download(key: string): Promise<{
    body: Readable;
    contentType?: string;
    contentLength?: number;
    metadata?: Record<string, string>;
  }> {
    const fullKey = this.getFullKey(key);

    const params: GetObjectCommandInput = {
      Bucket: this.bucket,
      Key: fullKey,
    };

    const result = await this.client.send(new GetObjectCommand(params));

    if (!result.Body) {
      throw new Error(`No body returned for key: ${fullKey}`);
    }

    return {
      body: result.Body as Readable,
      contentType: result.ContentType,
      contentLength: result.ContentLength,
      metadata: result.Metadata,
    };
  }

  /**
   * Download a file as a buffer
   */
  async downloadBuffer(key: string): Promise<Buffer> {
    const { body } = await this.download(key);
    const chunks: Buffer[] = [];

    for await (const chunk of body) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  /**
   * Delete a file from S3
   */
  async delete(key: string): Promise<void> {
    const fullKey = this.getFullKey(key);

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: fullKey,
      })
    );
  }

  /**
   * Delete multiple files from S3
   */
  async deleteMany(keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.delete(key)));
  }

  /**
   * List objects in S3
   */
  async list(options: ListOptions = {}): Promise<ListResult> {
    const prefix = options.prefix
      ? this.getFullKey(options.prefix)
      : this.pathPrefix || undefined;

    const result = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        MaxKeys: options.maxKeys || 1000,
        ContinuationToken: options.continuationToken,
      })
    );

    return {
      objects: (result.Contents || []).map((obj) => ({
        key: obj.Key || "",
        size: obj.Size || 0,
        lastModified: obj.LastModified || new Date(),
        etag: obj.ETag,
      })),
      continuationToken: result.NextContinuationToken,
      isTruncated: result.IsTruncated || false,
    };
  }

  /**
   * Check if an object exists
   */
  async exists(key: string): Promise<boolean> {
    const fullKey = this.getFullKey(key);

    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: fullKey,
        })
      );
      return true;
    } catch (error: unknown) {
      if (error && typeof error === "object" && "name" in error && error.name === "NotFound") {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get object metadata without downloading
   */
  async getMetadata(key: string): Promise<{
    contentType?: string;
    contentLength?: number;
    lastModified?: Date;
    metadata?: Record<string, string>;
  }> {
    const fullKey = this.getFullKey(key);

    const result = await this.client.send(
      new HeadObjectCommand({
        Bucket: this.bucket,
        Key: fullKey,
      })
    );

    return {
      contentType: result.ContentType,
      contentLength: result.ContentLength,
      lastModified: result.LastModified,
      metadata: result.Metadata,
    };
  }

  /**
   * Generate a presigned URL for download
   */
  async getPresignedDownloadUrl(
    key: string,
    expiresInSeconds: number = 3600
  ): Promise<string> {
    const fullKey = this.getFullKey(key);

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: fullKey,
    });

    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  /**
   * Generate a presigned URL for upload
   */
  async getPresignedUploadUrl(
    key: string,
    options: {
      expiresInSeconds?: number;
      contentType?: string;
    } = {}
  ): Promise<string> {
    const fullKey = this.getFullKey(key);

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: fullKey,
      ContentType: options.contentType,
    });

    return getSignedUrl(this.client, command, {
      expiresIn: options.expiresInSeconds || 3600,
    });
  }

  /**
   * Test connection to S3
   */
  async testConnection(): Promise<{ success: boolean; error?: string; bucketInfo?: { name: string; region: string } }> {
    try {
      await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          MaxKeys: 1,
        })
      );
      return {
        success: true,
        bucketInfo: {
          name: this.bucket,
          region: "configured",
        },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: message };
    }
  }

  /**
   * Get bucket usage statistics
   */
  async getBucketUsage(): Promise<{
    totalObjects: number;
    totalSize: number;
    lastModified?: Date;
  }> {
    let totalObjects = 0;
    let totalSize = 0;
    let lastModified: Date | undefined;
    let continuationToken: string | undefined;

    do {
      const result = await this.list({
        maxKeys: 1000,
        continuationToken,
      });

      totalObjects += result.objects.length;
      for (const obj of result.objects) {
        totalSize += obj.size;
        if (!lastModified || obj.lastModified > lastModified) {
          lastModified = obj.lastModified;
        }
      }

      continuationToken = result.continuationToken;
    } while (continuationToken);

    return {
      totalObjects,
      totalSize,
      lastModified,
    };
  }

  /**
   * Copy an object within S3
   */
  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    const sourceFullKey = this.getFullKey(sourceKey);
    const destFullKey = this.getFullKey(destinationKey);

    // Download and re-upload (works across all S3-compatible services)
    const { body, contentType, metadata } = await this.download(sourceKey);
    const buffer = await this.downloadBuffer(sourceKey);

    await this.upload(destinationKey, buffer, {
      contentType,
      metadata,
    });
  }

  /**
   * Get the bucket name
   */
  getBucket(): string {
    return this.bucket;
  }

  /**
   * Get the path prefix
   */
  getPathPrefix(): string {
    return this.pathPrefix;
  }
}

// Singleton instances cache
const s3Instances = new Map<string, S3Service>();

/**
 * Get or create an S3 service instance for a given config
 */
export function getS3Service(config: S3Config): S3Service {
  const key = `${config.endpoint}:${config.bucket}:${config.pathPrefix || ""}`;

  if (!s3Instances.has(key)) {
    s3Instances.set(key, new S3Service(config));
  }

  return s3Instances.get(key)!;
}

/**
 * Clear all cached S3 instances
 */
export function clearS3Instances(): void {
  s3Instances.clear();
}
