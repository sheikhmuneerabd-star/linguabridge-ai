import { Router, type Response } from "express";
import { Types } from "mongoose";
import {
  analyzeRequestSchema,
  objectionRequestSchema,
  profileSchema,
  summaryRequestSchema,
  type FreelancerProfile,
  type Tone,
} from "@linguabridge/shared";
import { analyzeRateLimit } from "../middleware/aiRateLimit";
import { requireAuth } from "../middleware/auth";
import { ProfileModel } from "../models/FreelancerProfile";
import { User } from "../models/User";
import { analyzeChat, type AnalyzePrefs } from "../services/assist";
import { handleObjection } from "../services/objection";
import { handleSummary } from "../services/summary";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";

export const assistRouter = Router();

// Order matters: sign-in first, then the per-user limit (shared by all analysis requests).
assistRouter.use(requireAuth, analyzeRateLimit);

/** If the client disconnects/cancels before we answer, abort the AI call too. */
function cancelOnDisconnect(res: Response): AbortSignal {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}

async function loadContext(userId: string, withProfile: boolean) {
  const user = await User.findById(userId).select("preferences");
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "Account not found. Please sign in again.");

  const prefs: AnalyzePrefs = {
    displayLanguage: user.preferences?.displayLanguage ?? "ur-Latn",
    writingLanguage: user.preferences?.writingLanguage ?? "ur-Latn",
    tone: (user.preferences?.tone ?? "professional") as Tone,
  };

  let profile: FreelancerProfile | null = null;
  if (withProfile) {
    const doc = await ProfileModel.findOne({ userId: new Types.ObjectId(userId) }).lean();
    const parsed = doc ? profileSchema.safeParse(doc) : null;
    profile = parsed?.success ? parsed.data : null;
  }
  return { prefs, profile };
}

// POST /assist/analyze  { messages: [{sender, text}], fresh? }
assistRouter.post(
  "/analyze",
  asyncHandler(async (req, res) => {
    const request = analyzeRequestSchema.parse(req.body);
    const userId: string = res.locals.userId;
    const { prefs, profile } = await loadContext(userId, true);

    const { result, cached } = await analyzeChat({
      userId,
      request,
      prefs,
      profile,
      signal: cancelOnDisconnect(res),
    });

    res.set("X-Cache", cached ? "HIT" : "MISS").json({ ...result, cached });
  })
);

// POST /assist/objection  { messages, objection, fresh? }
assistRouter.post(
  "/objection",
  asyncHandler(async (req, res) => {
    const request = objectionRequestSchema.parse(req.body);
    const userId: string = res.locals.userId;
    const { prefs, profile } = await loadContext(userId, true);

    const { result, cached } = await handleObjection({
      userId,
      request,
      prefs,
      profile,
      signal: cancelOnDisconnect(res),
    });

    res.set("X-Cache", cached ? "HIT" : "MISS").json({ ...result, cached });
  })
);

// POST /assist/summary  { messages, fresh? }
assistRouter.post(
  "/summary",
  asyncHandler(async (req, res) => {
    const request = summaryRequestSchema.parse(req.body);
    const userId: string = res.locals.userId;
    const { prefs } = await loadContext(userId, false);

    const { result, cached } = await handleSummary({
      userId,
      request,
      displayLanguage: prefs.displayLanguage,
      signal: cancelOnDisconnect(res),
    });

    res.set("X-Cache", cached ? "HIT" : "MISS").json({ ...result, cached });
  })
);