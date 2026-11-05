import type {
  Preferences,
  PublicUser,
  TranslateIncomingResponse,
  TranslateOutgoingResponse,
} from "@linguabridge/shared";

export type PreferenceValues = Pick<Preferences, "displayLanguage" | "writingLanguage" | "tone">;

// ---- Messages to the service worker ----
export type RequestMessage =
  | { type: "PING" }
  | { type: "HEALTH" }
  | { type: "AUTH_LOGIN"; email: string; password: string }
  | { type: "AUTH_REGISTER"; name: string; email: string; password: string }
  | { type: "AUTH_GOOGLE" }
  | { type: "AUTH_LOGOUT" }
  | { type: "GET_ME" }
  | { type: "SAVE_PREFERENCES"; values: PreferenceValues }
  | { type: "TRANSLATE_INCOMING"; text: string; requestId: string }
  | { type: "TRANSLATE_OUTGOING"; text: string; targetLanguage: string; requestId: string }
  | { type: "CANCEL"; requestId: string };

export interface MeData {
  user: PublicUser;
  preferences: Preferences;
}

export interface ResponseMap {
  PING: { pong: true; signedIn: boolean };
  HEALTH: { online: boolean };
  AUTH_LOGIN: { user: PublicUser };
  AUTH_REGISTER: { user: PublicUser };
  AUTH_GOOGLE: { user: PublicUser };
  AUTH_LOGOUT: Record<string, never>;
  GET_ME: MeData | null; // null = not signed in
  SAVE_PREFERENCES: { preferences: Preferences };
  /** cached = answered from the extension's memory, no server request was made. */
  TRANSLATE_INCOMING: TranslateIncomingResponse & { cached: boolean };
  TRANSLATE_OUTGOING: TranslateOutgoingResponse & { cached: boolean };
  CANCEL: Record<string, never>;
}

export type Reply<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

// ---- Messages to the content script on a page (from the side panel) ----
export type TabRequest = { type: "DIAGNOSE" };
export type TabReply = { ok: true; report: string } | { ok: false };