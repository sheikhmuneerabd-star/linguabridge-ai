import { z } from "zod";
import {
  OBJECTION_CATEGORIES,
  type FreelancerProfile,
  type ObjectionRequest,
  type ObjectionResult,
} from "@linguabridge/shared";
import { buildObjectionPrompt } from "../ai/prompts/objection";
import { TTLCache } from "../utils/TTLCache";
import { askStructured } from "./aiJson";
import { compactProfile, list as listField, text as textField, type AnalyzePrefs } from "./assist";
import { cachedRun, hashKey } from "./assistCache";
import { checkReplies } from "./replyChecks";

/** Bump this whenever the objection prompt changes, so old saved answers are not reused. */
const PROMPT_VERSION = 2;

const outputSchema = z
  .object({
    category: z.enum(OBJECTION_CATEGORIES).catch("other"),
    concern: textField(500),
    strategy: textField(800),
    reply: textField(1500),
    alternative: textField(500),
    needsYourInput: listField(8, 250),
    warnings: listField(5, 250),
  })
  .refine((o) => o.reply.length > 0, { message: "The reply is empty" });

/** Asks the AI (no database, no saved answers). Used by the API and by the test script. */
export async function generateObjection(opts: {
  messages: ObjectionRequest["messages"];
  objection: string;
  profile: FreelancerProfile | null;
  prefs: AnalyzePrefs;
  signal?: AbortSignal;
  onUsage?: (tokens: number) => void;
}): Promise<ObjectionResult> {
  const out = await askStructured({
    schema: outputSchema,
    system: buildObjectionPrompt(opts.prefs),
    payload: {
      chat: opts.messages,
      objection: opts.objection,
      freelancerProfile: compactProfile(opts.profile),
    },
    tier: "smart",
    reasoning: "medium",
    maxTokens: 3000,
    signal: opts.signal,
    onUsage: opts.onUsage,
  });

  const chatText = opts.messages.map((m) => m.text).join("\n");
  return { ...out, flags: checkReplies({ reply: out.reply }, opts.profile, chatText) };
}

const cache = new TTLCache<ObjectionResult>(200, 30 * 60_000);

export function handleObjection(opts: {
  userId: string;
  request: ObjectionRequest;
  prefs: AnalyzePrefs;
  profile: FreelancerProfile | null;
  signal?: AbortSignal;
}) {
  const key = hashKey([
    PROMPT_VERSION,
    opts.userId,
    opts.prefs,
    compactProfile(opts.profile),
    opts.request.messages,
    opts.request.objection,
  ]);

  return cachedRun({
    userId: opts.userId,
    key,
    fresh: opts.request.fresh,
    cache,
    run: (onUsage) =>
      generateObjection({
        messages: opts.request.messages,
        objection: opts.request.objection,
        profile: opts.profile,
        prefs: opts.prefs,
        signal: opts.signal,
        onUsage,
      }),
  });
}