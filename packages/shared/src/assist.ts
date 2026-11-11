import { z } from "zod";

export const ASSIST_LIMITS = {
  maxMessages: 40,
  maxTextPerMessage: 2000,
  maxTotalChars: 20000,
} as const;

export const STAGES = [
  "inquiry",
  "requirements",
  "clarification",
  "trust",
  "value",
  "budget",
  "objection",
  "negotiation",
  "order",
  "follow_up",
  "unclear",
] as const;
export type Stage = (typeof STAGES)[number];

export const FLAG_CODES = [
  "placeholder",
  "unverified_price",
  "unverified_years",
  "unverified_duration",
  "unverified_percent",
  "link_not_in_profile",
  "contact_details",
  "off_platform",
  "guarantee",
  "strong_claim",
  "unverified_quality",
  "price_scope",
  "greeting",
  "unlisted_offer",
] as const;
export type FlagCode = (typeof FLAG_CODES)[number];

export const analyzeRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        sender: z.enum(["client", "me"]),
        text: z.string().trim().min(1).max(ASSIST_LIMITS.maxTextPerMessage),
      })
    )
    .min(1)
    .max(ASSIST_LIMITS.maxMessages)
    .refine((m) => m.some((x) => x.sender === "client"), "The chat must contain at least one client message")
    .refine(
      (m) => m.reduce((n, x) => n + x.text.length, 0) <= ASSIST_LIMITS.maxTotalChars,
      "The chat is too long"
    ),
  /** true = ignore the saved answer and ask the AI again ("Regenerate"). */
  fresh: z.boolean().optional(),
});

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

/** A warning found by our own checks (not by the AI) in the suggested replies. */
export interface ReplyFlag {
  code: FlagCode;
  message: string;
}

export interface AnalyzeResult {
  stage: Stage;
  intent: string;
  requirements: string[];
  budget: string;
  deadline: string;
  objections: string[];
  missingInfo: string[];
  strategy: string;
  /** Things the client asked that the profile cannot answer. Only the freelancer can fill these in. */
  needsYourInput: string[];
  /** Warnings from the AI itself (for example the client wants to move off-platform). */
  warnings: string[];
  replies: { professional: string; friendly: string; persuasive: string };
  /** Warnings from our own code checks on the replies. */
  flags: ReplyFlag[];
}

export type AnalyzeResponse = AnalyzeResult & { cached: boolean };