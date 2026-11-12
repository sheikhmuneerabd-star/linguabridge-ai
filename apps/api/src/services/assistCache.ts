import crypto from "crypto";
import type { TTLCache } from "../utils/TTLCache";
import { assertUnderDailyLimit, recordUsage } from "./usage";

export const hashKey = (parts: unknown[]) =>
  crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");

/**
 * Memory-only saved answers. The key contains the user id, so one user never gets another user's answer.
 * One call counts as one request in the daily limit and the usage numbers.
 */
export async function cachedRun<T>(opts: {
  userId: string;
  key: string;
  fresh?: boolean;
  cache: TTLCache<T>;
  run: (onUsage: (tokens: number) => void) => Promise<T>;
}): Promise<{ result: T; cached: boolean }> {
  if (!opts.fresh) {
    const hit = opts.cache.get(opts.key);
    if (hit) {
      recordUsage(opts.userId, { cacheHits: 1 });
      return { result: hit, cached: true };
    }
  }

  await assertUnderDailyLimit(opts.userId);

  let tokens = 0;
  const result = await opts.run((t) => (tokens += t));

  opts.cache.set(opts.key, result);
  recordUsage(opts.userId, { requests: 1, tokens });
  return { result, cached: false };
}