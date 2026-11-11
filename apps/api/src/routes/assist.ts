import { Router, type Response } from "express";
import { Types } from "mongoose";
import { analyzeRequestSchema, profileSchema, type Tone } from "@linguabridge/shared";
import { analyzeRateLimit } from "../middleware/aiRateLimit";
import { requireAuth } from "../middleware/auth";
import { ProfileModel } from "../models/FreelancerProfile";
import { User } from "../models/User";
import { analyzeChat } from "../services/assist";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";

export const assistRouter = Router();

// Order matters: sign-in first, then the per-user limit.
assistRouter.use(requireAuth, analyzeRateLimit);

/** If the client disconnects/cancels before we answer, abort the AI call too. */
function cancelOnDisconnect(res: Response): AbortSignal {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}

// POST /assist/analyze  { messages: [{sender, text}], fresh? }
assistRouter.post(
  "/analyze",
  asyncHandler(async (req, res) => {
    const request = analyzeRequestSchema.parse(req.body);
    const userId: string = res.locals.userId;

    const user = await User.findById(userId).select("preferences");
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "Account not found. Please sign in again.");

    const profileDoc = await ProfileModel.findOne({ userId: new Types.ObjectId(userId) }).lean();
    const parsedProfile = profileDoc ? profileSchema.safeParse(profileDoc) : null;

    const { result, cached } = await analyzeChat({
      userId,
      request,
      prefs: {
        displayLanguage: user.preferences?.displayLanguage ?? "ur-Latn",
        writingLanguage: user.preferences?.writingLanguage ?? "ur-Latn",
        tone: (user.preferences?.tone ?? "professional") as Tone,
      },
      profile: parsedProfile?.success ? parsedProfile.data : null,
      signal: cancelOnDisconnect(res),
    });

    res.set("X-Cache", cached ? "HIT" : "MISS").json({ ...result, cached });
  })
);