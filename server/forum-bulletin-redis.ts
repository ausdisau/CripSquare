import { createHmac } from "node:crypto";

/**
 * Upstash Redis REST implementation (works in Vercel serverless runtimes).
 * The Lua script atomically increments, applies TTL and returns the count.
 * No user identifier or post text is stored as a Redis key or value.
 *
 * A missing/unavailable rate limiter fails CLOSED when the feature is enabled.
 */
const LUA = [
  "local n=redis.call('INCR', KEYS[1])",
  "if redis.call('TTL', KEYS[1]) < 0 then",
  "  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))",
  "end",
  "return n",
].join("\n");

export class ForumRateLimitUnavailable extends Error {
  constructor() {
    super("Forum posting is temporarily unavailable. Your draft remains on this device.");
    this.name = "ForumRateLimitUnavailable";
  }
}

export async function consumeForumRateLimit(
  actorId: string,
  action: "thread" | "reply" | "subscribe" | "moderate" | "search",
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const pepper = process.env.CRIPSQUARE_FORUM_RATE_PEPPER;
  if (!url || !token || !pepper || pepper.length < 20) {
    throw new ForumRateLimitUnavailable();
  }
  let endpoint: URL;
  try {
    endpoint = new URL(url);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) {
      throw new Error("Invalid URL");
    }
  } catch {
    throw new ForumRateLimitUnavailable();
  }
  const limits: Record<typeof action, number> = {
    thread: 8, reply: 24, subscribe: 40, moderate: 20, search: 80,
  };
  const digest = createHmac("sha256", pepper).update(actorId).digest("hex");
  const key = "csq:forum:v2:" + action + ":" + digest;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(["EVAL", LUA, "1", key, "60"]),
      signal: AbortSignal.timeout(3500),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Redis unavailable");
    const data = await response.json() as { result?: unknown; error?: string };
    if (data.error || typeof data.result !== "number" || !Number.isInteger(data.result)) {
      throw new Error("Unexpected Redis response");
    }
    return { allowed: data.result <= limits[action], retryAfterSeconds: 60 };
  } catch {
    throw new ForumRateLimitUnavailable();
  }
}
