import type {
  AnalyzeResponse,
  Preferences,
  PublicUser,
  TranslateIncomingResponse,
  TranslateOutgoingResponse,
} from "@linguabridge/shared";

export type PreferenceValues = Pick<Preferences, "displayLanguage" | "writingLanguage" | "tone">;

export interface ChatLine {
  sender: "client" | "me";
  text: string;
}

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
  | { type: "ANALYZE"; messages: ChatLine[]; fresh?: boolean; requestId: string }
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
  ANALYZE: AnalyzeResponse;
  CANCEL: Record<string, never>;
}

export type Reply<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

// ---- Messages to the content script on a page (from the side panel) ----
export type TabRequest =
  | { type: "DIAGNOSE" }
  | { type: "GET_CHAT" }
  | {
      type: "APPLY_DRAFT";
      text: string;
      /** The chat this text was made for. The page refuses if another chat is open. */
      chatKey: string;
      undo?: boolean;
      /** For undo: what we put in the box. If the box holds something else now, nothing is undone. */
      expect?: string;
    };

export interface ChatPayload {
  chatKey: string;
  messages: ChatLine[];
  /** Language of the client, if "Translate Fiverr messages" has found it. */
  clientLanguage: string | null;
  /** Messages whose sender could not be told. They are left out. */
  unknown: number;
  /** True if older messages or very long parts were left out. */
  trimmed: boolean;
}

export type TabReply =
  | { ok: true; kind: "report"; report: string }
  | { ok: true; kind: "chat"; chat: ChatPayload }
  | { ok: true; kind: "applied"; before: string }
  | { ok: false; code: "NO_CHAT" | "NO_INPUT" | "CHAT_CHANGED" | "CHANGED" | "FAILED" };