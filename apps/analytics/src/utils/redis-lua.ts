/**
 * Shared Redis Lua scripts for atomic operations.
 */

/**
 * Atomically increment a counter key, set its expiry on first increment,
 * and return both the count and remaining TTL.
 *
 * KEYS[1] = the counter key
 * ARGV[1] = the TTL in seconds
 *
 * Returns: [count, ttl]
 */
export const INCR_WITH_TTL_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
`;
