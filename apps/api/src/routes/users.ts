import { Router } from "express";
import { preferencesSchema } from "@linguabridge/shared";
import { User } from "../models/User";
import { requireAuth } from "../middleware/auth";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";
import { getUsageToday } from "../services/usage";

export const usersRouter = Router();

usersRouter.use(requireAuth);

// GET /users/me  -> profile + preferences
usersRouter.get(
  "/me",
  asyncHandler(async (_req, res) => {
    const user = await User.findById(res.locals.userId);
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "Account not found. Please sign in again.");

    res.json({
      user: { id: user.id, email: user.email, name: user.name, picture: user.picture ?? undefined },
      preferences: user.preferences,
    });
  })
);

// PATCH /users/me/preferences  -> change any preference(s)
usersRouter.patch(
  "/me/preferences",
  asyncHandler(async (req, res) => {
    const changes = preferencesSchema.partial().parse(req.body);

    const $set = Object.fromEntries(
      Object.entries(changes).map(([key, value]) => [`preferences.${key}`, value])
    );

    const user = await User.findByIdAndUpdate(res.locals.userId, { $set }, { new: true });
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "Account not found. Please sign in again.");

    res.json({ preferences: user.preferences });
  })
);

// GET /users/me/usage  -> today's usage numbers (counts only, no message content)
usersRouter.get(
  "/me/usage",
  asyncHandler(async (_req, res) => {
    res.json(await getUsageToday(res.locals.userId));
  })
);