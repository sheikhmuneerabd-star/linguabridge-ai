import { Router, type Response } from "express";
import {
  translateIncomingSchema,
  translateOutgoingSchema,
  type Tone,
} from "@linguabridge/shared";
import { User } from "../models/User";
import { requireAuth } from "../middleware/auth";
import { aiRateLimit } from "../middleware/aiRateLimit";
import { incomingCached, outgoingCached } from "../services/cachedTranslation";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";

export const translateRouter = Router();

// Order matters: sign-in first, then the per-user limit.
translateRouter.use(requireAuth, aiRateLimit);

/** If the client disconnects/cancels before we answer, abort the AI call too. */
function cancelOnDisconnect(res: Response): AbortSignal {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}

async function loadPreferences(userId: string) {
  const user = await User.findById(userId).select("preferences");
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "Account not found. Please sign in again.");
  return user.preferences;
}

// POST /translate/incoming  { text }
translateRouter.post(
  "/incoming",
  asyncHandler(async (req, res) => {
    const { text } = translateIncomingSchema.parse(req.body);
    const prefs = await loadPreferences(res.locals.userId);

    const { result, cache } = await incomingCached({
      userId: res.locals.userId,
      text,
      targetLanguage: prefs?.displayLanguage ?? "ur-Latn",
      signal: cancelOnDisconnect(res),
    });

    res.set("X-Cache", cache).json(result);
  })
);

// POST /translate/outgoing  { text, targetLanguage }
translateRouter.post(
  "/outgoing",
  asyncHandler(async (req, res) => {
    const { text, targetLanguage } = translateOutgoingSchema.parse(req.body);
    const prefs = await loadPreferences(res.locals.userId);

    const { result, cache } = await outgoingCached({
      userId: res.locals.userId,
      text,
      targetLanguage,
      sourceHint: prefs?.writingLanguage ?? "ur-Latn",
      tone: (prefs?.tone ?? "professional") as Tone,
      signal: cancelOnDisconnect(res),
    });

    res.set("X-Cache", cache).json(result);
  })
);