import { Router } from "express";
import { z } from "zod";
import { loginSchema, registerSchema, type AuthResponse } from "@linguabridge/shared";
import { User } from "../models/User";
import { verifyGoogleIdToken } from "../services/googleAuth";
import { checkPassword, hashPassword } from "../services/password";
import { signToken } from "../utils/jwt";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";

export const authRouter = Router();

function toAuthResponse(user: {
  id: string;
  email: string;
  name: string;
  picture?: string | null;
}): AuthResponse {
  return {
    token: signToken(user.id),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture ?? undefined,
    },
  };
}

// ---------- Register ----------
authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { name, email, password } = registerSchema.parse(req.body);

    const existing = await User.findOne({ email });
    if (existing) {
      // Never touch an existing account (e.g. a Google one) from the register route.
      throw new AppError(
        409,
        "EMAIL_IN_USE",
        "This email is already registered. Please sign in instead."
      );
    }

    try {
      const user = await User.create({ name, email, passwordHash: await hashPassword(password) });
      res.status(201).json(toAuthResponse(user));
    } catch (err) {
      // Two people registering the same email at the same moment.
      if ((err as { code?: number }).code === 11000) {
        throw new AppError(409, "EMAIL_IN_USE", "This email is already registered. Please sign in instead.");
      }
      throw err;
    }
  })
);

// ---------- Login ----------
authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const user = await User.findOne({ email }).select("+passwordHash");
    const ok = await checkPassword(password, user?.passwordHash ?? undefined);

    if (!user || !ok) {
      throw new AppError(
        401,
        "INVALID_CREDENTIALS",
        "Email or password is incorrect. If you signed up with Google, use the Google button."
      );
    }

    res.json(toAuthResponse(user));
  })
);

// ---------- Google ----------
const googleLoginSchema = z.object({
  idToken: z.string().min(20).max(4096),
});

authRouter.post(
  "/google",
  asyncHandler(async (req, res) => {
    const { idToken } = googleLoginSchema.parse(req.body);
    const profile = await verifyGoogleIdToken(idToken);

    let user = await User.findOne({ googleId: profile.googleId });

    if (!user) {
      const sameEmail = await User.findOne({ email: profile.email.toLowerCase() });
      if (sameEmail) {
        // Link Google to the existing account. Google has verified this email,
        // but the old password was never verified, so we remove it for safety.
        user = sameEmail;
        user.googleId = profile.googleId;
        user.set("passwordHash", undefined);
      } else {
        user = new User({ googleId: profile.googleId, email: profile.email });
      }
    }

    user.name = user.name || profile.name;
    if (profile.picture) user.picture = profile.picture;
    await user.save();

    res.json(toAuthResponse(user));
  })
);