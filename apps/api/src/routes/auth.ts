import { Router } from "express";
import { z } from "zod";
import { loginSchema, registerSchema, type AuthResponse } from "@linguabridge/shared";
import { env } from "../config/env";
import { User } from "../models/User";
import { verifyGoogleIdToken } from "../services/googleAuth";
import { checkPassword, hashPassword } from "../services/password";
import { signToken } from "../utils/jwt";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";

export const authRouter = Router();

/** Development-only notes for the developer. Never logs passwords. */
function debug(message: string) {
  if (env.NODE_ENV === "development") console.log(`[auth] ${message}`);
}

function toAuthResponse(user: {
  _id: { toString(): string };
  email: string;
  name: string;
  picture?: string | null;
}): AuthResponse {
  const id = user._id.toString();
  return {
    token: signToken(id),
    user: {
      id,
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
    debug(`register request: ${email}`);

    const existing = await User.findOne({ email }).select("+passwordHash");
    if (existing) {
      debug(
        `register refused, already exists: ${email} (hasPassword=${Boolean(existing.passwordHash)}, hasGoogle=${Boolean(existing.googleId)})`
      );
      throw new AppError(
        409,
        "EMAIL_IN_USE",
        "This email is already registered. Please sign in instead."
      );
    }

    try {
      const user = await User.create({ name, email, passwordHash: await hashPassword(password) });
      debug(`register created: ${email}`);
      res.status(201).json(toAuthResponse(user));
    } catch (err) {
      const e = err as { code?: number; keyPattern?: Record<string, unknown> };
      if (e.code === 11000) {
        // Only the email index means "email already used". Anything else is a database setup problem.
        if (e.keyPattern && "email" in e.keyPattern) {
          debug(`register lost a race, already exists: ${email}`);
          throw new AppError(409, "EMAIL_IN_USE", "This email is already registered. Please sign in instead.");
        }
        console.error("[auth] duplicate key on another field. Check database indexes:", e.keyPattern);
        throw new AppError(500, "INTERNAL_ERROR", "Something went wrong. Please try again.");
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
      const why = !user
        ? "no account with this email"
        : !user.passwordHash
          ? "account has no password (created with Google)"
          : "password does not match";
      debug(`login failed for ${email}: ${why}`);

      // The user always sees the same safe message.
      throw new AppError(
        401,
        "INVALID_CREDENTIALS",
        "Email or password is incorrect. If you signed up with Google, use the Google button."
      );
    }

    debug(`login ok: ${email}`);
    res.json(toAuthResponse(user));
  })
);

// ---------- Google ----------
// ---------- Google ----------
const googleLoginSchema = z.object({
  idToken: z.string().min(20).max(4096),
  // Sent by the extension. The web dashboard doesn't send one.
  nonce: z.string().min(8).max(128).optional(),
});

authRouter.post(
  "/google",
  asyncHandler(async (req, res) => {
    const { idToken, nonce } = googleLoginSchema.parse(req.body);
    const profile = await verifyGoogleIdToken(idToken);

    // If the caller used a nonce, the token must carry the very same one.
    if (nonce !== undefined && profile.nonce !== nonce) {
      debug("google login refused: nonce mismatch");
      throw new AppError(401, "INVALID_GOOGLE_TOKEN", "Google sign-in failed. Please try again.");
    }

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

    debug(`google login ok: ${user.email}`);
    res.json(toAuthResponse(user));
  })
);