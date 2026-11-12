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

export const OBJECTION_CATEGORIES = [
  "price_high",
  "cheaper_competitor",
  "faster_delivery",
  "discount",
  "need_to_think",
  "why_choose_you",
  "portfolio",
  "guarantee",
  "limited_budget",
  "other",
] as const;
export type ObjectionCategory = (typeof OBJECTION_CATEGORIES)[number];

/** The chat that is sent to the AI. The same limits apply to every assist request. */
const chatSchema = z
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
  );

export const analyzeRequestSchema = z.object({
  messages: chatSchema,
  /** true = ignore the saved answer and ask the AI again ("Regenerate"). */
  fresh: z.boolean().optional(),
});
export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

export const objectionRequestSchema = z.object({
  messages: chatSchema,
  /** The objection or concern to answer (one of the lines found by the analysis). */
  objection: z.string().trim().min(2).max(300),
  fresh: z.boolean().optional(),
});
export type ObjectionRequest = z.infer<typeof objectionRequestSchema>;

export const summaryRequestSchema = z.object({
  messages: chatSchema,
  fresh: z.boolean().optional(),
});
export type SummaryRequest = z.infer<typeof summaryRequestSchema>;

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

export interface ObjectionResult {
  category: ObjectionCategory;
  /** What the client may be worried about. */
  concern: string;
  strategy: string;
  reply: string;
  /** Another honest approach, as a note for the freelancer. It is not a message for the client. */
  alternative: string;
  needsYourInput: string[];
  warnings: string[];
  flags: ReplyFlag[];
}
export type ObjectionResponse = ObjectionResult & { cached: boolean };

export interface SummaryResult {
  wants: string;
  requirements: string[];
  budget: string;
  deadline: string;
  decisions: string[];
  openQuestions: string[];
  nextAction: string;
  /** Numbers in the summary that are not in the chat. */
  warnings: string[];
}
export type SummaryResponse = SummaryResult & { cached: boolean };