import crypto from "crypto";
import { z } from "zod";
import {
  STAGES,
  type AnalyzeRequest,
  type AnalyzeResult,
  type FreelancerProfile,
  type Tone,
} from "@linguabridge/shared";
import { getAIProvider } from "../ai";
import { buildAnalyzePrompt } from "../ai/prompts/assist";
import { AppError } from "../utils/AppError";
import { TTLCache } from "../utils/TTLCache";
import { checkReplies } from "./replyChecks";
import { assertUnderDailyLimit, recordUsage } from "./usage";

/** Bump this whenever the analysis prompt changes, so old saved answers are not reused. */
const PROMPT_VERSION = 8;

export interface AnalyzePrefs {
  displayLanguage: string;
  writingLanguage: string;
  tone: Tone;
}

type ChatItem = { sender: "client" | "me"; text: string };

/** Unusual characters the model used and that we replaced (the test script reports them). */
export const cleaned = new Map<string, number>();
/** Invisible characters we only looked at and did not change (the test script reports them). */
export const seen = new Map<string, number>();

const SPECIAL_SPACE = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
const SPECIAL_HYPHEN = /[\u2010-\u2012]/g;
// Invisible "format" characters (zero-width space, soft hyphen, word joiner...). Some are needed
// in Urdu script, so for now we only count them instead of removing them.
const INVISIBLE = /[\p{Cf}\p{Zl}\p{Zp}]/gu;

function codeOf(ch: string): string {
  return `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
}

function count(map: Map<string, number>, ch: string): void {
  const code = codeOf(ch);
  map.set(code, (map.get(code) ?? 0) + 1);
}

/** Turns special spaces and hyphens into plain ones, so the text looks the same wherever it is pasted. */
export function tidy(s: string): string {
  for (const m of s.matchAll(INVISIBLE)) count(seen, m[0]);
  return s
    .replace(SPECIAL_SPACE, (ch) => {
      count(cleaned, ch);
      return " ";
    })
    .replace(SPECIAL_HYPHEN, (ch) => {
      count(cleaned, ch);
      return "-";
    })
    .replace(/(\d) %/g, "$1%")
    // The model sometimes forgets the space after , ; ! ? ("features,design"). Links are left alone.
    // "5 to7" and "5-7days": a number stuck to the next word.
    
.replace(/\b(to)(?=\d)/gi, "$1 ")
.replace(/(\d)(?=[A-Za-z]{2,}\b)(?!(?:st|nd|rd|th|k|m|am|pm|kb|mb|gb)\b)/gi, "$1 ")

    .replace(/(https?:\/\/\S+)|([,;!?])(?=[A-Za-z])/g, (_m: string, url?: string, mark?: string) =>
      url ? url : `${mark} `
    );
}

let lastRaw = "";
/** The last raw answer from the AI, before any cleaning. For the test script only. */
export function getLastRaw(): string {
  return lastRaw;
}

export const text = (max: number) =>
  z
    .string()
    .nullish()
    .transform((v) => tidy(v ?? "").trim().slice(0, max));

export const list = (count: number, max: number) =>
  z
    .array(z.string())
    .nullish()
    .transform((v) =>
      (v ?? [])
        .map((s) => tidy(s).trim().slice(0, max))
        .filter(Boolean)
        .slice(0, count)
    );

const outputSchema = z
  .object({
    stage: z.enum(STAGES).catch("unclear"),
    intent: text(500),
    requirements: list(12, 200),
    budget: text(200),
    deadline: text(200),
    objections: list(6, 250),
    missingInfo: list(8, 250),
    strategy: text(800),
    needsYourInput: list(8, 250),
    warnings: list(5, 250),
    replies: z.object({
      professional: text(1500),
      friendly: text(1500),
      persuasive: text(1500),
    }),
  })
  .refine((o) => o.replies.professional && o.replies.friendly && o.replies.persuasive, {
    message: "A reply is empty",
  });

export function parseJson(raw: string): unknown {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  return JSON.parse(cleaned);
}

/** Only the fields that have something in them. Null if the profile is empty. */
export function compactProfile(p: FreelancerProfile | null): Record<string, unknown> | null {
  if (!p) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(p)) {
    const filled = Array.isArray(value) ? value.length > 0 : typeof value === "string" && value.trim() !== "";
    if (filled) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Asks the AI (no database, no saved answers). Used by the API and by the test script. */
export async function runAnalysis(opts: {
  messages: ChatItem[];
  profile: FreelancerProfile | null;
  prefs: AnalyzePrefs;
  signal?: AbortSignal;
  onUsage?: (tokens: number) => void;
}): Promise<AnalyzeResult> {
  const ai = getAIProvider();
  const system = buildAnalyzePrompt(opts.prefs);
  const payload = { chat: opts.messages, freelancerProfile: compactProfile(opts.profile) };
  const chatText = opts.messages.map((m) => m.text).join("\n");

  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await ai.complete({
      tier: "smart",
      json: true,
      reasoning: "medium",
      maxTokens: 4000,
      temperature: 0.3,
      signal: opts.signal,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(payload) },
      ],
    });
    lastRaw = result.text;
    if (result.usage) opts.onUsage?.(result.usage.totalTokens);

    try {
      const out = outputSchema.parse(parseJson(result.text));
      return { ...out, flags: checkReplies(out.replies, opts.profile, chatText) };
    } catch {
      console.warn(`[assist] AI returned a bad answer (attempt ${attempt})`);
    }
  }

  throw new AppError(502, "AI_BAD_FORMAT", "The analysis could not be read. Please try again.");
}

// Saved answers: memory only, 30 minutes, and only for the same user (the answer contains their profile).
const cache = new TTLCache<AnalyzeResult>(200, 30 * 60_000);

export async function analyzeChat(opts: {
  userId: string;
  request: AnalyzeRequest;
  prefs: AnalyzePrefs;
  profile: FreelancerProfile | null;
  signal?: AbortSignal;
}): Promise<{ result: AnalyzeResult; cached: boolean }> {
  const key = crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        PROMPT_VERSION,
        opts.userId,
        opts.prefs,
        compactProfile(opts.profile),
        opts.request.messages,
      ])
    )
    .digest("hex");

  if (!opts.request.fresh) {
    const hit = cache.get(key);
    if (hit) {
      recordUsage(opts.userId, { cacheHits: 1 });
      return { result: hit, cached: true };
    }
  }

  await assertUnderDailyLimit(opts.userId);

  let tokens = 0;
  const result = await runAnalysis({
    messages: opts.request.messages,
    profile: opts.profile,
    prefs: opts.prefs,
    signal: opts.signal,
    onUsage: (t) => (tokens += t),
  });

  cache.set(key, result);
  recordUsage(opts.userId, { requests: 1, tokens });
  return { result, cached: false };
}