import type { AuthResponse, Preferences } from "@linguabridge/shared";
import { ApiError, apiFetch } from "../shared/api";
import type { MeData, RequestMessage, Reply } from "../shared/messages";
import { PREFS_TS_KEY, clearToken, getToken, setToken } from "../shared/storage";
import { getGoogleIdToken } from "./googleSignIn";
import { clearTranslationCache, translateIncoming, translateOutgoing } from "./translate";

// The toolbar icon opens the popup; the side panel is opened from the popup button.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error);

/** Requests that are running now, so the side panel can cancel them (e.g. the user kept typing). */
const inFlight = new Map<string, AbortController>();

async function withRequest<T>(requestId: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  inFlight.get(requestId)?.abort();
  const controller = new AbortController();
  inFlight.set(requestId, controller);
  try {
    return await run(controller.signal);
  } finally {
    if (inFlight.get(requestId) === controller) inFlight.delete(requestId);
  }
}

/** A different person may now be signed in, so cached translations must not carry over. */
async function startSession(token: string): Promise<void> {
  await setToken(token);
  await clearTranslationCache();
}

async function handle(msg: RequestMessage): Promise<unknown> {
  switch (msg.type) {
    case "PING":
      return { pong: true, signedIn: (await getToken()) !== null };

    case "HEALTH": {
      try {
        const d = await apiFetch<{ status: string }>("/health");
        return { online: d.status === "ok" };
      } catch {
        return { online: false };
      }
    }

    case "AUTH_LOGIN": {
      const d = await apiFetch<AuthResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: msg.email, password: msg.password }),
      });
      await startSession(d.token);
      return { user: d.user };
    }

    case "AUTH_REGISTER": {
      const d = await apiFetch<AuthResponse>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ name: msg.name, email: msg.email, password: msg.password }),
      });
      await startSession(d.token);
      return { user: d.user };
    }

    case "AUTH_GOOGLE": {
      const { idToken, nonce } = await getGoogleIdToken();
      const d = await apiFetch<AuthResponse>("/auth/google", {
        method: "POST",
        body: JSON.stringify({ idToken, nonce }),
      });
      await startSession(d.token);
      return { user: d.user };
    }

    case "AUTH_LOGOUT":
      await clearToken();
      await clearTranslationCache();
      return {};

    case "GET_ME": {
      if (!(await getToken())) return null;
      try {
        return await apiFetch<MeData>("/users/me");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    }

    case "SAVE_PREFERENCES": {
      const d = await apiFetch<{ preferences: Preferences }>("/users/me/preferences", {
        method: "PATCH",
        body: JSON.stringify({ ...msg.values, onboardingDone: true }),
      });
      // Language/tone changed: old translations may no longer match.
      await clearTranslationCache();
      await chrome.storage.local.set({ [PREFS_TS_KEY]: Date.now() });
      return { preferences: d.preferences };
    }

    case "TRANSLATE_INCOMING":
      return withRequest(msg.requestId, (signal) => translateIncoming(msg.text, signal));

    case "TRANSLATE_OUTGOING":
      return withRequest(msg.requestId, (signal) =>
        translateOutgoing(msg.text, msg.targetLanguage, signal)
      );

    case "CANCEL":
      inFlight.get(msg.requestId)?.abort();
      return {};
  }
}

chrome.runtime.onMessage.addListener((message: RequestMessage, sender, sendResponse) => {
  // Only accept messages from our own extension.
  if (sender.id !== chrome.runtime.id) return false;

  handle(message)
    .then((data) => sendResponse({ ok: true, data } satisfies Reply<unknown>))
    .catch((err: unknown) => {
      if (!(err instanceof ApiError)) console.error("[LinguaBridge] unexpected error:", err);
      const error =
        err instanceof ApiError
          ? { code: err.code, message: err.message }
          : { code: "UNKNOWN", message: "Something went wrong. Please try again." };
      sendResponse({ ok: false, error } satisfies Reply<unknown>);
    });

  return true; // we answer asynchronously
});