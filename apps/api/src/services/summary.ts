import { z } from "zod";
import type { SummaryRequest, SummaryResult } from "@linguabridge/shared";
import { buildSummaryPrompt } from "../ai/prompts/summary";
import { TTLCache } from "../utils/TTLCache";
import { askStructured } from "./aiJson";
import { list as listField, text as textField } from "./assist";
import { cachedRun, hashKey } from "./assistCache";
import { numbersNotIn } from "./replyChecks";

/** Bump this whenever the summary prompt changes, so old saved answers are not reused. */
const PROMPT_VERSION = 1;

const outputSchema = z.object({
  wants: textField(500),
  requirements: listField(12, 200),
  budget: textField(200),
  deadline: textField(200),
  decisions: listField(10, 250),
  openQuestions: listField(8, 250),
  nextAction: textField(400),
});

/** Asks the AI (no database, no saved answers). Used by the API and by the test script. */
export async function generateSummary(opts: {
  messages: SummaryRequest["messages"];
  displayLanguage: string;
  signal?: AbortSignal;
  onUsage?: (tokens: number) => void;
}): Promise<SummaryResult> {
  const out = await askStructured({
    schema: outputSchema,
    system: buildSummaryPrompt(opts.displayLanguage),
    payload: { chat: opts.messages },
    // A summary is a simple job. If the quality is not good enough, change this to "smart".
    tier: "fast",
    reasoning: "low",
    maxTokens: 2500,
    signal: opts.signal,
    onUsage: opts.onUsage,
  });

  const chatText = opts.messages.map((m) => m.text).join("\n");
  const mentioned = [
    out.wants,
    ...out.requirements,
    out.budget,
    out.deadline,
    ...out.decisions,
    ...out.openQuestions,
    out.nextAction,
  ].join("\n");

  const warnings = numbersNotIn(mentioned, chatText).map(
    (n) => `The summary mentions the number ${n}, which is not in the chat. Check it.`
  );

  return { ...out, warnings };
}

const cache = new TTLCache<SummaryResult>(200, 30 * 60_000);

export function handleSummary(opts: {
  userId: string;
  request: SummaryRequest;
  displayLanguage: string;
  signal?: AbortSignal;
}) {
  const key = hashKey([PROMPT_VERSION, opts.userId, opts.displayLanguage, opts.request.messages]);

  return cachedRun({
    userId: opts.userId,
    key,
    fresh: opts.request.fresh,
    cache,
    run: (onUsage) =>
      generateSummary({
        messages: opts.request.messages,
        displayLanguage: opts.displayLanguage,
        signal: opts.signal,
        onUsage,
      }),
  });
}