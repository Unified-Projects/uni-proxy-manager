/**
 * Test Redis utilities
 */

import Redis from "ioredis";
import { Queue, type Job } from "bullmq";
import { QUEUES } from "../../../packages/queue/src/queues";

const redisUrl = process.env.UNI_PROXY_MANAGER_REDIS_URL!;

/**
 * Create a test Redis client
 */
export function createTestRedisClient(): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

/**
 * Clear all BullMQ queues
 */
export async function clearRedisQueues(): Promise<void> {
  const redis = createTestRedisClient();

  for (const queueName of Object.values(QUEUES)) {
    const queue = new Queue(queueName, { connection: redis });
    try {
      await queue.pause();
      await queue.drain(true);

      // BullMQ 5 can briefly report the queue as non-paused immediately after
      // pause() while pause state propagates through Redis. Retry a few times.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await queue.obliterate({ force: true });
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes("Cannot obliterate non-paused queue") || attempt === 2) {
            throw error;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
          await queue.pause();
        }
      }
    } finally {
      await queue.close();
    }
  }

  await redis.quit();
}

/**
 * Wait for a job to complete or fail
 */
export async function waitForJob<T>(
  queueName: string,
  jobId: string,
  timeout = 30000
): Promise<Job<T> | null> {
  const redis = createTestRedisClient();
  const queue = new Queue<T>(queueName, { connection: redis });

  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const job = await queue.getJob(jobId);
    if (job) {
      const state = await job.getState();
      if (state === "completed" || state === "failed") {
        await queue.close();
        await redis.quit();
        return job;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  await queue.close();
  await redis.quit();
  return null;
}

/**
 * Get counts of jobs in different states
 */
export async function getQueueCounts(queueName: string): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  const redis = createTestRedisClient();
  const queue = new Queue(queueName, { connection: redis });
  const counts = await queue.getJobCounts();
  await queue.close();
  await redis.quit();
  return counts;
}

/**
 * Get all jobs from a queue
 */
export async function getQueueJobs<T>(
  queueName: string,
  status: "waiting" | "active" | "completed" | "failed" = "waiting"
): Promise<Job<T>[]> {
  const redis = createTestRedisClient();
  const queue = new Queue<T>(queueName, { connection: redis });
  const jobs = await queue.getJobs([status]);
  await queue.close();
  await redis.quit();
  return jobs;
}

/**
 * Check if Redis is connected
 */
export async function isRedisConnected(): Promise<boolean> {
  try {
    const redis = createTestRedisClient();
    await redis.ping();
    await redis.quit();
    return true;
  } catch {
    return false;
  }
}

// Singleton Redis client for reuse
let _sharedRedisClient: Redis | null = null;

/**
 * Get a shared Redis client (use for multiple operations)
 */
export function getRedisClient(): Redis {
  if (!_sharedRedisClient) {
    _sharedRedisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return _sharedRedisClient;
}

/**
 * Close the shared Redis client
 */
export async function closeRedisClient(): Promise<void> {
  if (_sharedRedisClient) {
    await _sharedRedisClient.quit();
    _sharedRedisClient = null;
  }
}
