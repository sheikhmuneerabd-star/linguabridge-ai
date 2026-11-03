import { z } from "zod";
import { LANGUAGE_CODES } from "./languages";

// ---- Tone (communication style) ----
export const TONES = [
  "professional",
  "friendly",
  "formal",
  "confident",
  "persuasive",
] as const;

export type Tone = (typeof TONES)[number];

// ---- User preferences ----
export const preferencesSchema = z.object({
  displayLanguage: z.enum(LANGUAGE_CODES).default("ur-Latn"),
  writingLanguage: z.enum(LANGUAGE_CODES).default("ur-Latn"),
  tone: z.enum(TONES).default("professional"),
  autoTranslate: z.boolean().default(true),
  onboardingDone: z.boolean().default(false),
});

export type Preferences = z.infer<typeof preferencesSchema>;

// ---- Email + password auth ----
const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: emailSchema,
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(72),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

// ---- User (sent to the frontend; no secrets) ----
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

// ---- Auth ----
export interface AuthResponse {
  token: string;
  user: PublicUser;
}

// ---- API errors (user-friendly) ----
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}