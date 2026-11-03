import { z } from "zod";
import { LANGUAGE_CODES } from "./languages";

export const MAX_TRANSLATE_CHARS = 4000;

const textSchema = z.string().trim().min(1).max(MAX_TRANSLATE_CHARS);

// ---- Incoming: client message -> my language ----
export const translateIncomingSchema = z.object({
  text: textSchema,
});

export interface TranslateIncomingResponse {
  /** Language of the client's message, e.g. "en", "fr", "ur-Latn". "und" = no real text. */
  detectedLang: string;
  /** If needsTranslation is false, this is just the original text. */
  translation: string;
  needsTranslation: boolean;
}

// ---- Outgoing: my draft -> client's language ----
export const translateOutgoingSchema = z.object({
  text: textSchema,
  targetLanguage: z.enum(LANGUAGE_CODES),
});

export interface TranslateOutgoingResponse {
  translation: string;
  targetLanguage: string;
  /** Language the draft was written in (detected). */
  sourceLang: string;
}