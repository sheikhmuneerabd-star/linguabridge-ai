import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/env";
import { healthRouter } from "./routes/health";
import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
import { errorHandler, notFound } from "./middleware/errorHandler";
import { translateRouter } from "./routes/translate";

export function createApp() {
  const app = express();

  app.use(helmet());

  app.use(
    cors({
      origin(origin, callback) {
        // Allow: no origin (curl/Postman), listed web origins, and Chrome extensions.
        if (!origin || env.corsOrigins.includes(origin) || origin.startsWith("chrome-extension://")) {
          return callback(null, true);
        }
        return callback(new Error("Not allowed by CORS"));
      },
    })
  );

  app.use(express.json({ limit: "100kb" }));

  // Global rate limit
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 120,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: { code: "RATE_LIMITED", message: "Too many requests. Please wait a moment." },
      },
    })
  );

  // Stricter limit for login attempts
  const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: { code: "RATE_LIMITED", message: "Too many sign-in attempts. Please wait a minute." },
    },
  });

  app.use("/health", healthRouter);
  app.use("/auth", authLimiter, authRouter);
  app.use("/users", usersRouter);
  app.use("/translate", translateRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}