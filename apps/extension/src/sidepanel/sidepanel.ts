import { LANGUAGES, getLanguageName } from "@linguabridge/shared";
import { ExtError, send } from "../shared/client";
import type { MeData, TabReply, TabRequest } from "../shared/messages";
import { PREFS_TS_KEY, TOKEN_KEY } from "../shared/storage";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let me: MeData | null = null;

function show(view: "loading" | "signedOut" | "signedIn") {
  $("loading").hidden = view !== "loading";
  $("signedOut").hidden = view !== "signedOut";
  $("signedIn").hidden = view !== "signedIn";
}

function setLine(id: string, text: string | null) {
  const el = $(id);
  el.textContent = text ?? "";
  el.hidden = !text;
}

function friendly(err: unknown): string {
  return err instanceof ExtError ? err.message : "Something went wrong. Please try again.";
}

async function refresh() {
  show("loading");

  send({ type: "HEALTH" })
    .then((r) => {
      $("dot").className = `dot ${r.online ? "online" : "offline"}`;
      $("serverText").textContent = r.online ? "Server is online" : "Server is offline";
    })
    .catch(() => undefined);

  try {
    me = await send({ type: "GET_ME" });
    if (me) {
      $("userName").textContent = me.user.name;
      $("userEmail").textContent = me.user.email;

      const done = me.preferences.onboardingDone;
      $("setupNote").hidden = done;
      $("prefsLine").hidden = !done;
      $("prefsLine").textContent = done
        ? `Read in ${getLanguageName(me.preferences.displayLanguage)} · Write in ${getLanguageName(me.preferences.writingLanguage)}`
        : "";
      $("tools").hidden = !done;
      show("signedIn");
    } else {
      $("tools").hidden = true;
      $("message").textContent = "Click the LinguaBridge icon in the Chrome toolbar to sign in.";
      show("signedOut");
    }
  } catch (err) {
    me = null;
    $("tools").hidden = true;
    $("message").textContent = friendly(err);
    show("signedOut");
  }
}

// ---------- Translate a client message (button) ----------
let inBusy = false;

$("inBtn").addEventListener("click", async () => {
  if (inBusy) return;
  const text = $<HTMLTextAreaElement>("inText").value.trim();
  setLine("inOut", null);

  if (!text) {
    setLine("inStatus", "Paste a message first.");
    return;
  }

  inBusy = true;
  $<HTMLButtonElement>("inBtn").disabled = true;
  setLine("inStatus", "Translating...");

  try {
    const r = await send({ type: "TRANSLATE_INCOMING", text, requestId: crypto.randomUUID() });
    const mine = me ? getLanguageName(me.preferences.displayLanguage) : "your language";
    const note = r.cached ? " · from memory" : "";

    if (r.detectedLang === "und") {
      setLine("inStatus", "Nothing to translate (no words found).");
    } else if (!r.needsTranslation) {
      setLine("inStatus", `Already in ${getLanguageName(r.detectedLang)}. No translation needed.`);
    } else {
      setLine("inStatus", `${getLanguageName(r.detectedLang)} → ${mine}${note}`);
      setLine("inOut", r.translation);
    }
  } catch (err) {
    setLine("inStatus", friendly(err));
  } finally {
    inBusy = false;
    $<HTMLButtonElement>("inBtn").disabled = false;
  }
});

// ---------- Translate my reply (auto, after a pause in typing) ----------
const TYPING_PAUSE_MS = 700;
let outTimer: number | undefined;
let outRequest: string | null = null; // the one request whose answer we still want
let outTranslation = "";

function cancelOutgoing() {
  window.clearTimeout(outTimer);
  if (outRequest) {
    // Stop the old request (and the AI call behind it). Its answer will be ignored.
    send({ type: "CANCEL", requestId: outRequest }).catch(() => undefined);
    outRequest = null;
  }
}

function onReplyChanged() {
  cancelOutgoing();
  outTranslation = "";
  setLine("outOut", null);
  $("outCopy").hidden = true;

  const text = $<HTMLTextAreaElement>("outText").value.trim();
  if (text.length < 2) {
    setLine("outStatus", null);
    return;
  }

  setLine("outStatus", "Waiting for you to finish typing...");
  const target = $<HTMLSelectElement>("outLang").value;
  outTimer = window.setTimeout(() => runOutgoing(text, target), TYPING_PAUSE_MS);
}

async function runOutgoing(text: string, target: string) {
  const requestId = crypto.randomUUID();
  outRequest = requestId;
  setLine("outStatus", "Translating...");

  try {
    const r = await send({ type: "TRANSLATE_OUTGOING", text, targetLanguage: target, requestId });
    if (outRequest !== requestId) return; // stale: the user typed something newer

    outTranslation = r.translation;
    setLine("outStatus", `${getLanguageName(target)}${r.cached ? " · from memory" : ""}`);
    setLine("outOut", r.translation);
    $("outCopy").hidden = false;
  } catch (err) {
    if (outRequest !== requestId) return;
    if (err instanceof ExtError && err.code === "CANCELLED") return;
    setLine("outStatus", friendly(err));
  } finally {
    if (outRequest === requestId) outRequest = null;
  }
}

$("outText").addEventListener("input", onReplyChanged);
$("outLang").addEventListener("change", onReplyChanged);

$("outCopy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(outTranslation);
    setLine("outStatus", "Copied.");
  } catch {
    setLine("outStatus", "Could not copy. Select the text and press Ctrl+C.");
  }
});

// Fill the "client's language" list once. English is the usual choice.
$<HTMLSelectElement>("outLang").replaceChildren(
  ...LANGUAGES.map((l) => {
    const option = document.createElement("option");
    option.value = l.code;
    option.textContent = l.name;
    option.selected = l.code === "en";
    return option;
  })
);

// ---------- Fiverr page check ----------
async function runDiagnostic() {
  setLine("diagStatus", "Checking...");
  $("diagOut").hidden = true;
  $("copyDiag").hidden = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined) {
      setLine("diagStatus", "Could not find the current tab.");
      return;
    }

    const reply = (await chrome.tabs.sendMessage(tab.id, { type: "DIAGNOSE" } satisfies TabRequest)) as
      | TabReply
      | undefined;

    if (!reply || !reply.ok) {
      setLine("diagStatus", "The page did not answer. Please refresh the Fiverr tab and try again.");
      return;
    }

    $<HTMLTextAreaElement>("diagOut").value = reply.report;
    $("diagOut").hidden = false;
    $("copyDiag").hidden = false;
    setLine("diagStatus", null);
  } catch {
    setLine("diagStatus", "Open a Fiverr chat page, refresh it once, and try again.");
  }
}

$("diagnoseBtn").addEventListener("click", runDiagnostic);

$("copyDiag").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($<HTMLTextAreaElement>("diagOut").value);
    setLine("diagStatus", "Copied.");
  } catch {
    $<HTMLTextAreaElement>("diagOut").select();
    setLine("diagStatus", "Press Ctrl+C to copy.");
  }
});

// Update automatically when the user signs in/out or changes settings in the popup.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[TOKEN_KEY] || changes[PREFS_TS_KEY])) refresh();
});

refresh();