import { env } from "../config/env";
import { AppError } from "../utils/AppError";
import type { AIProvider, CompletionRequest, CompletionResult } from "./AIProvider";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

interface GroqResponse {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GroqProvider implements AIProvider {
  readonly name = "groq";

  private modelFor(tier: CompletionRequest["tier"]): string {
    return tier === "smart" ? env.GROQ_MODEL_SMART : env.GROQ_MODEL_FAST;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const model = this.modelFor(req.tier);

    const body: Record<string, unknown> = {
      model,
      messages: req.messages,
      temperature: req.temperature ?? 0.2,
      // Reasoning models spend part of this budget on thinking, so keep it generous.
      max_completion_tokens: req.maxTokens ?? 2048,
    };
    if (req.json) body.response_format = { type: "json_object" };
    // gpt-oss models can "think" first; for translation we want it quick.
    if (model.startsWith("openai/gpt-oss")) body.reasoning_effort = "low";

    const res = await this.send(body, req.signal);
    const data = (await res.json().catch(() => ({}))) as GroqResponse;

    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      console.error("[Groq] Empty response from model", model);
      throw new AppError(502, "AI_EMPTY", "The AI did not return an answer. Please try again.");
    }

    return {
      text,
      model: data.model ?? model,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens ?? 0,
          }
        : undefined,
    };
  }

  /** Sends the request with timeout, cancel support, and one retry on server errors. */
  private async send(body: Record<string, unknown>, callerSignal?: AbortSignal): Promise<Response> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const timeout = AbortSignal.timeout(env.AI_TIMEOUT_MS);
      const signal = callerSignal ? AbortSignal.any([timeout, callerSignal]) : timeout;

      let res: Response;
      try {
        res = await fetch(GROQ_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.GROQ_API_KEY}`,
          },
          body: JSON.stringify(body),
          signal,
        });
      } catch (err) {
        if (callerSignal?.aborted) {
          throw new AppError(499, "AI_CANCELLED", "Request was cancelled.");
        }
        if (timeout.aborted) {
          throw new AppError(504, "AI_TIMEOUT", "The AI took too long to answer. Please try again.");
        }
        console.error("[Groq] Network error:", (err as Error).message);
        throw new AppError(502, "AI_UNAVAILABLE", "Cannot reach the AI service right now. Please try again.");
      }

      if (res.ok) return res;

      const detail = await res
        .clone()
        .json()
        .then((d) => (d as GroqResponse).error?.message)
        .catch(() => undefined);

      if (res.status === 429) {
        const wait = Math.max(1, Math.ceil(Number(res.headers.get("retry-after")) || 10));
        throw new AppError(
          429,
          "AI_BUSY",
          `Translation is busy right now. Please try again in about ${wait} seconds.`
        );
      }

      if (res.status >= 500 && attempt === 1) {
        await sleep(800);
        continue;
      }

      // Everything below is a problem on our side (key, model, request). Log it, don't show details.
      console.error(`[Groq] HTTP ${res.status}:`, detail);

      if (res.status === 401 || res.status === 403) {
        throw new AppError(503, "AI_NOT_CONFIGURED", "The AI service is not set up correctly. Please contact support.");
      }
      if (res.status === 400 || res.status === 404) {
        throw new AppError(503, "AI_MODEL_ERROR", "The AI model is unavailable right now. Please try again later.");
      }
      throw new AppError(502, "AI_UNAVAILABLE", "The AI service is having problems. Please try again.");
    }

    // Unreachable, but keeps TypeScript happy.
    throw new AppError(502, "AI_UNAVAILABLE", "The AI service is having problems. Please try again.");
  }
}