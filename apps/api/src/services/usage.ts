import { Types } from "mongoose";
import { UsageLog } from "../models/UsageLog";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";

const RETENTION_DAYS = 90;
const today = () => new Date().toISOString().slice(0, 10);

interface UsageIncrement {
  requests?: number;
  cacheHits?: number;
  tokens?: number;
}

async function increment(userId: string, inc: UsageIncrement, retry = true): Promise<void> {
  try {
    await UsageLog.updateOne(
      { userId: new Types.ObjectId(userId), day: today() },
      {
        $inc: {
          requests: inc.requests ?? 0,
          cacheHits: inc.cacheHits ?? 0,
          tokens: inc.tokens ?? 0,
        },
        $setOnInsert: { expiresAt: new Date(Date.now() + RETENTION_DAYS * 86_400_000) },
      },
      { upsert: true }
    );
  } catch (err) {
    // Two requests created today's record at the same moment: just try once more.
    if (retry && (err as { code?: number }).code === 11000) return increment(userId, inc, false);
    console.warn("[usage] could not record usage:", (err as Error).message);
  }
}

/** Fire and forget: never slows down or breaks a translation. */
export function recordUsage(userId: string, inc: UsageIncrement): void {
  void increment(userId, inc);
}

export async function assertUnderDailyLimit(userId: string): Promise<void> {
  const doc = await UsageLog.findOne({
    userId: new Types.ObjectId(userId),
    day: today(),
  })
    .select("requests")
    .lean();

  if (doc && doc.requests >= env.AI_DAILY_LIMIT) {
    throw new AppError(
      429,
      "DAILY_LIMIT",
      "You have reached today's translation limit. It will reset tomorrow."
    );
  }
}

export async function getUsageToday(userId: string) {
  const doc = await UsageLog.findOne({
    userId: new Types.ObjectId(userId),
    day: today(),
  }).lean();

  return {
    day: today(),
    requests: doc?.requests ?? 0,
    cacheHits: doc?.cacheHits ?? 0,
    tokens: doc?.tokens ?? 0,
    dailyLimit: env.AI_DAILY_LIMIT,
  };
}