import Redis from "ioredis";
import { getRedisUrl } from "../config/env.js";

let redisClient: Redis | null = null;

function createRedisClient(): Redis {
  const redisUrl = getRedisUrl();
  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => {
      if (times > 10) {
        return null; // Stop retrying after 10 attempts
      }
      return Math.min(times * 100, 3000);
    },
  });

  client.on("error", (err) => {
    console.error("[Redis] Connection error:", err.message);
  });

  client.on("connect", () => {
    console.log("[Redis] Connected");
  });

  client.on("reconnecting", () => {
    console.log("[Redis] Reconnecting...");
  });

  client.on("end", () => {
    console.warn("[Redis] Connection ended");
    if (redisClient === client) {
      redisClient = null;
    }
  });

  return client;
}

export function getRedisClient(): Redis {
  if (!redisClient || redisClient.status === "end") {
    redisClient = createRedisClient();
  }

  return redisClient;
}

export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    const client = redisClient;
    redisClient = null;

    if (client.status === "end") {
      return;
    }

    try {
      await client.quit();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== "Connection is closed.") {
        throw error;
      }
    }
  }
}

export async function pingRedis(): Promise<boolean> {
  try {
    const client = getRedisClient();
    const result = await client.ping();
    return result === "PONG";
  } catch {
    return false;
  }
}
