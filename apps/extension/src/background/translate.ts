import { MAX_TRANSLATE_CHARS } from "@linguabridge/shared";
import type { TranslateIncomingResponse, TranslateOutgoingResponse } from "@linguabridge/shared";
import { ApiError, apiFetch } from "../shared/api";
import { TranslationCache } from "./cache";

const cache = new TranslationCache();

async function sha256(input: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

function cleanText(text: string): string {
  const t = text.trim();
  if (t.length === 0 || t.length > MAX_TRANSLATE_CHARS) {
    throw new ApiError(
      "VALIDATION_ERROR",
      `Please enter between 1 and ${MAX_TRANSLATE_CHARS} characters.`,
      0
    );
  }
  return t;
}

/** A cache problem (e.g. full storage) must never break a translation. */
const quiet = () => undefined;

export async function translateIncoming(
  rawText: string,
  signal: AbortSignal
): Promise<TranslateIncomingResponse & { cached: boolean }> {
  const text = cleanText(rawText);
  const key = await sha256(`in\n${text}`);

  const hit = await cache.get<TranslateIncomingResponse>(key).catch(quiet);
  if (hit) return { ...hit, cached: true };

  const result = await apiFetch<TranslateIncomingResponse>("/translate/incoming", {
    method: "POST",
    body: JSON.stringify({ text }),
    signal,
  });
  await cache.set(key, result).catch(quiet);
  return { ...result, cached: false };
}

export async function translateOutgoing(
  rawText: string,
  targetLanguage: string,
  signal: AbortSignal
): Promise<TranslateOutgoingResponse & { cached: boolean }> {
  const text = cleanText(rawText);
  const key = await sha256(`out\n${targetLanguage}\n${text}`);

  const hit = await cache.get<TranslateOutgoingResponse>(key).catch(quiet);
  if (hit) return { ...hit, cached: true };

  const result = await apiFetch<TranslateOutgoingResponse>("/translate/outgoing", {
    method: "POST",
    body: JSON.stringify({ text, targetLanguage }),
    signal,
  });
  await cache.set(key, result).catch(quiet);
  return { ...result, cached: false };
}

export function clearTranslationCache(): Promise<void> {
  return cache.clear().catch(quiet);
}