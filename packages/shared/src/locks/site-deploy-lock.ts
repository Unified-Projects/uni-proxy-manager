import type { Redis } from "ioredis";

const LOCK_TTL_SECONDS = 600; // 10 minutes max deployment time

/**
 * Acquire a site deployment lock
 * Only one deployment can run for a site at a time
 */
export async function acquireSiteDeployLock(redis: Redis, siteId: string): Promise<boolean> {
  const lockKey = `site-deploy-lock:${siteId}`;

  // Use SET NX with TTL for atomic lock acquisition
  const result = await redis.set(lockKey, Date.now().toString(), "EX", LOCK_TTL_SECONDS, "NX");

  return result === "OK";
}

/**
 * Release a site deployment lock
 */
export async function releaseSiteDeployLock(redis: Redis, siteId: string): Promise<void> {
  const lockKey = `site-deploy-lock:${siteId}`;
  await redis.del(lockKey);
}

/**
 * Wait for a site deployment lock with timeout
 * Returns true if lock was acquired, false if timeout
 */
export async function waitForSiteDeployLock(
  redis: Redis,
  siteId: string,
  timeoutMs = 30000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await acquireSiteDeployLock(redis, siteId)) {
      return true;
    }
    // Wait 1 second before retrying
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return false;
}

/**
 * Check if a site deployment lock is held
 */
export async function isSiteDeployLocked(redis: Redis, siteId: string): Promise<boolean> {
  const lockKey = `site-deploy-lock:${siteId}`;
  const exists = await redis.exists(lockKey);
  return exists === 1;
}
