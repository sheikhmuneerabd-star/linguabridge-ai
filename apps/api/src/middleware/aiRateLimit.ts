import rateLimit from "express-rate-limit";
import { env } from "../config/env";

export const aiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: env.AI_RATE_LIMIT_PER_MIN,
  standardHeaders: true,
  legacyHeaders: false,
  // One bucket per signed-in user (not per IP).
  keyGenerator: (_req, res) => `user:${res.locals.userId}`,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "You are translating very fast. Please wait a few seconds and try again.",
    },
  },
});