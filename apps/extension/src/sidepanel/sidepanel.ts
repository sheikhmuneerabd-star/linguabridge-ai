import {
  LANGUAGES,
  getLanguageName,
  type AnalyzeResponse,
  type Stage,
} from "@linguabridge/shared";
import { ExtError, send } from "../shared/client";
import type { ChatPayload, MeData, TabReply, TabRequest } from "../shared/messages";
import { ANALYZE_KEY, PREFS_TS_KEY, TOKEN_KEY } from "../shared/storage";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let me: MeData | null = null;

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text; // text only, never HTML
  return e;
}

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

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id !== undefined ? tab : null;
}

/** Sends a message to a page. Returns undefined if the page does not answer. */
async function askTab(tabId: number, message: TabRequest): Promise<TabReply | undefined> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as TabReply | undefined;
  } catch {
    return undefined;
  }
}

// =====================================================================================
// Analyze this chat
// =====================================================================================
const PLACEHOLDER = /\[ADD:[^\]]*\]/i;

const STAGE_LABELS: Record<Stage, string> = {
  inquiry: "new inquiry",
  requirements: "gathering requirements",
  clarification: "clarifying details",
  trust: "building trust",
  value: "explaining value",
  budget: "talking about budget",
  objection: "handling an objection",
  negotiation: "negotiating",
  order: "ready to order",
  follow_up: "follow-up",
  unclear: "not clear yet",
};

const REPLY_LABELS = { professional: "Professional", friendly: "Friendly", persuasive: "Persuasive" } as const;

let consentOn = false;
let analyzing = false;
let analysisId: string | null = null;
/** Which tab and chat the visible results belong to. */
let session: { tabId: number; chatKey: string } | null = null;
let prepareId: string | null = null;
let applied: { text: string; before: string } | null = null;

const preview = (text: string) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 70 ? `${t.slice(0, 70)}…` : t;
};

function listOf(items: string[]): HTMLUListElement {
  const ul = make("ul", "plain");
  for (const item of items) ul.append(make("li", undefined, item));
  return ul;
}

function block(title: string, ...content: (HTMLElement | string)[]): HTMLElement {
  const b = make("div", "block");
  b.append(make("h3", undefined, title));
  for (const c of content) b.append(typeof c === "string" ? make("p", undefined, c) : c);
  return b;
}

function updateAnalyzeCard() {
  const ready = Boolean(me?.preferences.onboardingDone);
  $("analyze").hidden = !ready;
  $("analyzeOff").hidden = consentOn;
  $("analyzeReady").hidden = !consentOn;
  if (!consentOn) resetAnalysis();
}

function setBusy(busy: boolean) {
  $<HTMLButtonElement>("analyzeBtn").disabled = busy;
}

/** Forgets the results and cancels anything still running. */
function resetAnalysis() {
  if (analysisId) {
    send({ type: "CANCEL", requestId: analysisId }).catch(() => undefined);
    analysisId = null;
  }
  cancelPrepare();
  session = null;
  applied = null;
  $("results").replaceChildren();
  $("results").hidden = true;
  $("composer").hidden = true;
  setLine("analyzeStatus", null);
}

const CHAT_PROBLEMS: Record<string, string> = {
  NO_CHAT: "Open a Fiverr chat first (the page address looks like fiverr.com/inbox/name).",
};

async function analyze(fresh: boolean) {
  if (analyzing) return;
  analyzing = true;
  setBusy(true);
  resetAnalysis();
  setLine("analyzeStatus", "Reading the chat...");

  try {
    const tab = await activeTab();
    if (!tab || tab.id === undefined) {
      setLine("analyzeStatus", "Could not find the current tab.");
      return;
    }

    const reply = await askTab(tab.id, { type: "GET_CHAT" });
    if (!reply) {
      setLine("analyzeStatus", "Open a Fiverr chat, refresh the page once, and try again.");
      return;
    }
    if (!reply.ok || reply.kind !== "chat") {
      setLine("analyzeStatus", (!reply.ok && CHAT_PROBLEMS[reply.code]) || "Could not read the chat. Please try again.");
      return;
    }

    const chat = reply.chat;
    if (!chat.messages.some((m) => m.sender === "client")) {
      setLine("analyzeStatus", "There is no message from the client in this chat yet.");
      return;
    }

    setLine("analyzeStatus", "Analyzing... this can take 10 to 20 seconds.");
    const requestId = crypto.randomUUID();
    analysisId = requestId;

    const result = await send({ type: "ANALYZE", messages: chat.messages, fresh, requestId });
    if (analysisId !== requestId) return; // the user moved on (settings changed, signed out)
    analysisId = null;

    session = { tabId: tab.id, chatKey: chat.chatKey };
    setLine("analyzeStatus", null);
    renderResults(result, chat);
  } catch (err) {
    if (err instanceof ExtError && err.code === "CANCELLED") return;
    setLine("analyzeStatus", friendly(err));
  } finally {
    analyzing = false;
    setBusy(false);
  }
}

function renderResults(r: AnalyzeResponse, chat: ChatPayload) {
  const box = $("results");
  box.replaceChildren();

  const last = chat.messages[chat.messages.length - 1];
  box.append(
    make(
      "p",
      "muted small",
      `Chat: ${chat.chatKey} · ${chat.messages.length} messages read` +
        (chat.trimmed ? " (older or very long parts left out)" : "") +
        (r.cached ? " · from memory" : "")
    )
  );
  box.append(
    make(
      "p",
      "muted small",
      `Last message the AI saw (${last.sender === "client" ? "client" : "you"}): "${preview(last.text)}". ` +
        `If this is not the newest message, refresh the Fiverr page and analyze again.`
    )
  );
  if (chat.unknown > 0) {
    box.append(make("p", "muted small", `${chat.unknown} message(s) could not be read and were left out.`));
  }

  if (r.needsYourInput.length > 0) {
    const c = make("div", "callout warn");
    c.append(make("strong", undefined, "You need to add:"), listOf(r.needsYourInput));
    box.append(c);
  }
  if (r.warnings.length > 0) {
    const c = make("div", "callout warn");
    c.append(make("strong", undefined, "Be careful:"), listOf(r.warnings));
    box.append(c);
  }

  box.append(block(`Where this chat stands: ${STAGE_LABELS[r.stage]}`, r.intent));
  box.append(block("Suggested approach", r.strategy));

  const more = make("details", "more");
  more.append(make("summary", undefined, "More details"));
  if (r.requirements.length > 0) more.append(block("What the client asked for", listOf(r.requirements)));
  if (r.budget) more.append(block("Budget", r.budget));
  if (r.deadline) more.append(block("Deadline", r.deadline));
  if (r.objections.length > 0) more.append(block("Concerns or objections", listOf(r.objections)));
  if (r.missingInfo.length > 0) more.append(block("Things you could still ask", listOf(r.missingInfo)));
  box.append(more);

  const replies = make("div", "block");
  replies.append(make("h3", undefined, "Suggested replies"));
  replies.append(
    make(
      "p",
      "muted small",
      "Written by AI. It can make mistakes. Check every fact before you send. You press Send yourself."
    )
  );
  if (r.flags.length > 0) {
    const c = make("div", "callout warn");
    c.append(make("strong", undefined, "Check before you use a reply:"), listOf(r.flags.map((f) => f.message)));
    replies.append(c);
  }

  for (const key of ["professional", "friendly", "persuasive"] as const) {
    const text = r.replies[key];
    const card = make("div", "reply");
    card.append(make("strong", undefined, REPLY_LABELS[key]));
    const body = make("p", "reply-text", text);
    body.setAttribute("dir", "auto"); // right-to-left languages display correctly
    card.append(body);
    const use = make("button", undefined, "Use this reply");
    use.type = "button";
    use.addEventListener("click", () => openComposer(text, chat.clientLanguage));
    card.append(use);
    replies.append(card);
  }

  const again = make("button", undefined, "Regenerate");
  again.type = "button";
  again.addEventListener("click", () => void analyze(true));
  replies.append(again);

  box.append(replies);
  box.hidden = false;
}

// ---------- Composer: edit, translate for the client, apply ----------
function cancelPrepare() {
  if (prepareId) {
    send({ type: "CANCEL", requestId: prepareId }).catch(() => undefined);
    prepareId = null;
  }
}

function hideFinal() {
  $("finalBox").hidden = true;
  $("undoApply").hidden = true;
  applied = null;
  setLine("applyStatus", null);
  setLine("prepareStatus", null);
}

function refreshGuards() {
  const draft = $<HTMLTextAreaElement>("draftText").value;
  const draftHasPlaceholder = PLACEHOLDER.test(draft);
  setLine(
    "draftWarn",
    draftHasPlaceholder ? "This reply still has [ADD: ...] parts. Write your own words in their place first." : null
  );
  $<HTMLButtonElement>("prepareBtn").disabled = draftHasPlaceholder || draft.trim().length < 2;

  const final = $<HTMLTextAreaElement>("finalText").value;
  const finalHasPlaceholder = PLACEHOLDER.test(final);
  setLine(
    "finalWarn",
    finalHasPlaceholder ? "This message still has [ADD: ...] parts. Write your own words in their place first." : null
  );
  const blocked = finalHasPlaceholder || final.trim() === "";
  $<HTMLButtonElement>("applyBtn").disabled = blocked;
  $<HTMLButtonElement>("copyFinal").disabled = blocked;
}

function openComposer(text: string, detected: string | null) {
  cancelPrepare();
  hideFinal();

  $<HTMLTextAreaElement>("draftText").value = text;
  $("writeLangName").textContent = me ? getLanguageName(me.preferences.writingLanguage) : "your language";

  const known = detected && LANGUAGES.some((l) => l.code === detected) ? detected : null;
  if (known) $<HTMLSelectElement>("clientLang").value = known;
  $("langHint").textContent = known ? "(detected from the chat)" : "(not detected: please check)";

  refreshGuards();
  $("composer").hidden = false;
  $("composer").scrollIntoView({ block: "nearest" });
}

function showFinal(text: string, note: string) {
  $<HTMLTextAreaElement>("finalText").value = text;
  $("finalBox").hidden = false;
  setLine("prepareStatus", note);
  refreshGuards();
}

async function prepare() {
  const text = $<HTMLTextAreaElement>("draftText").value.trim();
  if (text.length < 2 || PLACEHOLDER.test(text)) return;

  cancelPrepare();
  hideFinal();

  const target = $<HTMLSelectElement>("clientLang").value;
  // Same language: nothing to translate (and no request is made).
  if (me && target === me.preferences.writingLanguage) {
    showFinal(text, "Same language, so no translation was needed.");
    return;
  }

  const requestId = crypto.randomUUID();
  prepareId = requestId;
  $<HTMLButtonElement>("prepareBtn").disabled = true;
  setLine("prepareStatus", "Translating...");

  try {
    const r = await send({ type: "TRANSLATE_OUTGOING", text, targetLanguage: target, requestId });
    if (prepareId !== requestId) return; // the user changed the text or the language meanwhile
    prepareId = null;
    showFinal(r.translation, `${getLanguageName(target)}${r.cached ? " · from memory" : ""}`);
  } catch (err) {
    if (prepareId !== requestId) return;
    prepareId = null;
    if (err instanceof ExtError && err.code === "CANCELLED") return;
    setLine("prepareStatus", friendly(err));
  } finally {
    refreshGuards();
  }
}

const APPLY_PROBLEMS: Record<string, string> = {
  CHAT_CHANGED: "You opened another chat. Press Analyze again for the chat you want.",
  NO_INPUT: "The message box was not found. Use Copy and paste it yourself.",
  CHANGED: "The message box changed after you applied the text, so nothing was undone.",
  NO_CHAT: "Open the Fiverr chat first.",
};

async function applyFinal() {
  const text = $<HTMLTextAreaElement>("finalText").value.trim();
  if (!session || !text || PLACEHOLDER.test(text)) return;

  setLine("applyStatus", "Filling the message box...");
  const reply = await askTab(session.tabId, { type: "APPLY_DRAFT", text, chatKey: session.chatKey });

  if (!reply) {
    setLine("applyStatus", "The Fiverr tab did not answer. Use Copy and paste it yourself.");
    return;
  }
  if (!reply.ok || reply.kind !== "applied") {
    const code = reply.ok ? "FAILED" : reply.code;
    setLine("applyStatus", APPLY_PROBLEMS[code] ?? "Could not fill the message box. Use Copy and paste it yourself.");
    return;
  }

  applied = { text, before: reply.before };
  $("undoApply").hidden = false;
  setLine("applyStatus", "Done. Read the message in the box, then press Send yourself. (This replaced what was in the box. Undo brings it back.)");
}

async function undoApply() {
  if (!session || !applied) return;
  const reply = await askTab(session.tabId, {
    type: "APPLY_DRAFT",
    text: applied.before,
    chatKey: session.chatKey,
    undo: true,
    expect: applied.text,
  });

  if (reply?.ok && reply.kind === "applied") {
    applied = null;
    $("undoApply").hidden = true;
    setLine("applyStatus", "Undone. Your previous text is back in the box.");
    return;
  }
  const code = reply && !reply.ok ? reply.code : "FAILED";
  setLine("applyStatus", APPLY_PROBLEMS[code] ?? "Could not undo.");
}

$("analyzeBtn").addEventListener("click", () => void analyze(false));
$("prepareBtn").addEventListener("click", () => void prepare());
$("applyBtn").addEventListener("click", () => void applyFinal());
$("undoApply").addEventListener("click", () => void undoApply());
$("copyFinal").addEventListener("click", async () => {
  const text = $<HTMLTextAreaElement>("finalText").value.trim();
  if (!text || PLACEHOLDER.test(text)) return;
  try {
    await navigator.clipboard.writeText(text);
    setLine("applyStatus", "Copied.");
  } catch {
    $<HTMLTextAreaElement>("finalText").select();
    setLine("applyStatus", "Copying was blocked. Press Ctrl+C.");
  }
});
$("draftText").addEventListener("input", () => {
  cancelPrepare();
  hideFinal();
  refreshGuards();
});
$("clientLang").addEventListener("change", () => {
  cancelPrepare();
  hideFinal();
  $("langHint").textContent = "";
});
$("finalText").addEventListener("input", refreshGuards);

// =====================================================================================
// Page, sign-in state
// =====================================================================================
async function refresh() {
  show("loading");

  send({ type: "HEALTH" })
    .then((r) => {
      $("dot").className = `dot ${r.online ? "online" : "offline"}`;
      $("serverText").textContent = r.online ? "Server is online" : "Server is offline";
    })
    .catch(() => undefined);

  try {
    consentOn = ((await chrome.storage.local.get(ANALYZE_KEY))[ANALYZE_KEY] as boolean | undefined) === true;
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
  updateAnalyzeCard();
}

// ---------- Translate a client message (extra tool) ----------
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

// ---------- Translate my reply (extra tool, auto after a pause in typing) ----------
const TYPING_PAUSE_MS = 700;
let outTimer: number | undefined;
let outRequest: string | null = null; // the one request whose answer we still want
let outTranslation = "";

function cancelOutgoing() {
  window.clearTimeout(outTimer);
  if (outRequest) {
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
  outTimer = window.setTimeout(() => void runOutgoing(text, target), TYPING_PAUSE_MS);
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

// Language lists. English is the usual choice for the client.
function languageOptions(select: HTMLSelectElement, selected: string) {
  select.replaceChildren(
    ...LANGUAGES.map((l) => {
      const option = document.createElement("option");
      option.value = l.code;
      option.textContent = l.name;
      option.selected = l.code === selected;
      return option;
    })
  );
}
languageOptions($<HTMLSelectElement>("outLang"), "en");
languageOptions($<HTMLSelectElement>("clientLang"), "en");

// ---------- Fiverr page check (extra tool) ----------
async function runDiagnostic() {
  setLine("diagStatus", "Checking...");
  $("diagOut").hidden = true;
  $("copyDiag").hidden = true;

  try {
    const tab = await activeTab();
    if (!tab || tab.id === undefined) {
      setLine("diagStatus", "Could not find the current tab.");
      return;
    }

    const reply = await askTab(tab.id, { type: "DIAGNOSE" });
    if (!reply || !reply.ok || reply.kind !== "report") {
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

$("diagnoseBtn").addEventListener("click", () => void runDiagnostic());

$("copyDiag").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($<HTMLTextAreaElement>("diagOut").value);
    setLine("diagStatus", "Copied.");
  } catch {
    $<HTMLTextAreaElement>("diagOut").select();
    setLine("diagStatus", "Press Ctrl+C to copy.");
  }
});

// Update when the user signs in/out, changes settings, or turns analysis on/off in the popup.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[TOKEN_KEY] || changes[PREFS_TS_KEY]) {
    resetAnalysis(); // results belong to the previous account or settings
    void refresh();
  } else if (changes[ANALYZE_KEY]) {
    consentOn = changes[ANALYZE_KEY].newValue === true;
    updateAnalyzeCard();
  }
});

void refresh();