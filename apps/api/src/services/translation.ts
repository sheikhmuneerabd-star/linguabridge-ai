import { z } from "zod";
import type {
  Tone,
  TranslateIncomingResponse,
  TranslateOutgoingResponse,
} from "@linguabridge/shared";
import { getAIProvider } from "../ai";
import { buildIncomingPrompt, buildOutgoingPrompt } from "../ai/prompts/translation";
import { AppError } from "../utils/AppError";

const hasLetters = (s: string) => /\p{L}/u.test(s);

/** Makes AI language codes consistent: "UR-latn" / "roman urdu" -> "ur-Latn", "zh-CN" -> "zh". */
export function normalizeLang(code: string): string {
  const c = code.trim().replace("_", "-").toLowerCase();
  if (c === "ur-latn" || c === "roman-urdu" || c === "roman urdu") return "ur-Latn";
  return c.split("-")[0];
}

function parseJson(text: string): unknown {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  return JSON.parse(cleaned);
}

/** Calls the AI expecting JSON, validates it, retries once if the format is wrong. */
async function askJson<T>(
  schema: z.ZodType<T>,
  system: string,
  payload: { text: string },
  signal?: AbortSignal,
  onUsage?: (tokens: number) => void
): Promise<T> {
  const ai = getAIProvider();

  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await ai.complete({
      tier: "fast",
      json: true,
      signal,
      maxTokens: 3000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(payload) },
      ],
    });

    if (result.usage) onUsage?.(result.usage.totalTokens);

    try {
      return schema.parse(parseJson(result.text));
    } catch {
      console.warn(`[translation] AI returned bad JSON (attempt ${attempt})`);
    }
  }

  throw new AppError(502, "AI_BAD_FORMAT", "The translation could not be read. Please try again.");
}

const incomingOutput = z.object({
  detectedLang: z.string().min(2).max(16),
  translation: z.string().min(1),
});

const outgoingOutput = z.object({
  sourceLang: z.string().min(2).max(16),
  translation: z.string().min(1),
});

export async function translateIncoming(opts: {
  text: string;
  targetLanguage: string;
  signal?: AbortSignal;
  onUsage?: (tokens: number) => void;
}): Promise<TranslateIncomingResponse> {
  // Emoji-only / numbers-only messages: nothing to translate, don't spend an AI call.
  if (!hasLetters(opts.text)) {
    return { detectedLang: "und", translation: opts.text, needsTranslation: false };
  }

  const out = await askJson(
    incomingOutput,
    buildIncomingPrompt(opts.targetLanguage),
    { text: opts.text },
    opts.signal,
    opts.onUsage
  );

  const detectedLang = normalizeLang(out.detectedLang);
  const needsTranslation = detectedLang !== opts.targetLanguage;

  return {
    detectedLang,
    needsTranslation,
    translation: needsTranslation ? out.translation : opts.text,
  };
}

export async function translateOutgoing(opts: {
  text: string;
  targetLanguage: string;
  sourceHint: string;
  tone: Tone;
  signal?: AbortSignal;
  onUsage?: (tokens: number) => void;
}): Promise<TranslateOutgoingResponse> {
  if (!hasLetters(opts.text)) {
    return { translation: opts.text, targetLanguage: opts.targetLanguage, sourceLang: "und" };
  }

  const out = await askJson(
    outgoingOutput,
    buildOutgoingPrompt({
      targetLanguage: opts.targetLanguage,
      sourceHint: opts.sourceHint,
      tone: opts.tone,
    }),
    { text: opts.text },
    opts.signal,
    opts.onUsage
  );

  return {
    translation: out.translation,
    targetLanguage: opts.targetLanguage,
    sourceLang: normalizeLang(out.sourceLang),
  };
}