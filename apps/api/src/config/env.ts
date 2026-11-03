import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("30d"),

  // AI (Groq)
  GROQ_API_KEY: z.string().min(1, "GROQ_API_KEY is required"),
  GROQ_MODEL_FAST: z.string().default("openai/gpt-oss-20b"),
  GROQ_MODEL_SMART: z.string().default("openai/gpt-oss-120b"),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(20000),

  // Limits and cache
  AI_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(60),
  AI_DAILY_LIMIT: z.coerce.number().int().min(1).default(1000),
  CACHE_TTL_MINUTES: z.coerce.number().int().min(1).default(360),
  CACHE_MAX_ENTRIES: z.coerce.number().int().min(10).default(2000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(",").map((o) => o.trim()),
};