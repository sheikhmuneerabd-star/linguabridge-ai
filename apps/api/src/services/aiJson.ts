import { z } from "zod";
import { getAIProvider, type ModelTier } from "../ai";
import { AppError } from "../utils/AppError";
import { parseJson } from "./assist";

/** Asks the AI for a JSON answer, checks its shape, and tries once more if the shape is wrong. */
export async function askStructured<T>(opts: {
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  system: string;
  payload: unknown;
  tier: ModelTier;
  reasoning?: "low" | "medium" | "high";
  maxTokens: number;
  signal?: AbortSignal;
  onUsage?: (tokens: number) => void;
}): Promise<T> {
  const ai = getAIProvider();

  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await ai.complete({
      tier: opts.tier,
      json: true,
      reasoning: opts.reasoning,
      maxTokens: opts.maxTokens,
      temperature: 0.3,
      signal: opts.signal,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: JSON.stringify(opts.payload) },
      ],
    });

    if (result.usage) opts.onUsage?.(result.usage.totalTokens);

    try {
      return opts.schema.parse(parseJson(result.text));
    } catch {
      console.warn(`[assist] AI returned a bad answer (attempt ${attempt})`);
    }
  }

  throw new AppError(502, "AI_BAD_FORMAT", "The answer could not be read. Please try again.");
}