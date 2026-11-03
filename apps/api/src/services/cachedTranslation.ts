import crypto from "crypto";
import type {
  Tone,
  TranslateIncomingResponse,
  TranslateOutgoingResponse,
} from "@linguabridge/shared";
import { env } from "../config/env";
import { TTLCache } from "../utils/TTLCache";
import { singleFlight } from "../utils/singleFlight";
import { translateIncoming, translateOutgoing } from "./translation";
import { assertUnderDailyLimit, recordUsage } from "./usage";

// Bump this whenever the translation prompts change, so old cached answers are not reused.
const PROMPT_VERSION = 1;

const ttlMs = env.CACHE_TTL_MINUTES * 60_000;
const incomingCache = new TTLCache<TranslateIncomingResponse>(env.CACHE_MAX_ENTRIES, ttlMs);
const outgoingCache = new TTLCache<TranslateOutgoingResponse>(env.CACHE_MAX_ENTRIES, ttlMs);

function makeKey(parts: unknown[]): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([PROMPT_VERSION, ...parts]))
    .digest("hex");
}

/** HIT = from cache, SHARED = joined an identical request already running, MISS = fresh AI call. */
export type CacheStatus = "HIT" | "SHARED" | "MISS";

export async function incomingCached(opts: {
  userId: string;
  text: string;
  targetLanguage: string;
  signal?: AbortSignal;
}): Promise<{ result: TranslateIncomingResponse; cache: CacheStatus }> {
  const key = makeKey(["in", opts.targetLanguage, opts.text]);

  const hit = incomingCache.get(key);
  if (hit) {
    recordUsage(opts.userId, { cacheHits: 1 });
    return { result: hit, cache: "HIT" };
  }

  await assertUnderDailyLimit(opts.userId);

  const { value, shared } = await singleFlight(
    key,
    async (signal) => {
      let tokens = 0;
      const result = await translateIncoming({
        text: opts.text,
        targetLanguage: opts.targetLanguage,
        signal,
        onUsage: (t) => (tokens += t),
      });
      incomingCache.set(key, result);
      recordUsage(opts.userId, { requests: tokens > 0 ? 1 : 0, tokens });
      return result;
    },
    opts.signal
  );

  if (shared) recordUsage(opts.userId, { cacheHits: 1 });
  return { result: value, cache: shared ? "SHARED" : "MISS" };
}

export async function outgoingCached(opts: {
  userId: string;
  text: string;
  targetLanguage: string;
  sourceHint: string;
  tone: Tone;
  signal?: AbortSignal;
}): Promise<{ result: TranslateOutgoingResponse; cache: CacheStatus }> {
  const key = makeKey(["out", opts.targetLanguage, opts.sourceHint, opts.tone, opts.text]);

  const hit = outgoingCache.get(key);
  if (hit) {
    recordUsage(opts.userId, { cacheHits: 1 });
    return { result: hit, cache: "HIT" };
  }

  await assertUnderDailyLimit(opts.userId);

  const { value, shared } = await singleFlight(
    key,
    async (signal) => {
      let tokens = 0;
      const result = await translateOutgoing({
        text: opts.text,
        targetLanguage: opts.targetLanguage,
        sourceHint: opts.sourceHint,
        tone: opts.tone,
        signal,
        onUsage: (t) => (tokens += t),
      });
      outgoingCache.set(key, result);
      recordUsage(opts.userId, { requests: tokens > 0 ? 1 : 0, tokens });
      return result;
    },
    opts.signal
  );

  if (shared) recordUsage(opts.userId, { cacheHits: 1 });
  return { result: value, cache: shared ? "SHARED" : "MISS" };
}