import type { ObjectionCategory, ObjectionResponse, SummaryResponse } from "@linguabridge/shared";
import { ExtError, send } from "../shared/client";
import type { ChatPayload } from "../shared/messages";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

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

function setLine(id: string, text: string | null) {
  const el = $(id);
  el.textContent = text ?? "";
  el.hidden = !text;
}

const friendly = (err: unknown) =>
  err instanceof ExtError ? err.message : "Something went wrong. Please try again.";

const short = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 70 ? `${t.slice(0, 70)}…` : t;
};

function listOf(items: string[]): HTMLUListElement {
  const ul = make("ul", "plain");
  for (const item of items) ul.append(make("li", undefined, item));
  return ul;
}

function section(title: string, content: string | HTMLElement): HTMLElement {
  const b = make("div", "block");
  b.append(make("h3", undefined, title), typeof content === "string" ? make("p", undefined, content) : content);
  return b;
}

function callout(title: string, items: string[]): HTMLElement {
  const c = make("div", "callout warn");
  c.append(make("strong", undefined, title), listOf(items));
  return c;
}

const CATEGORY_LABELS: Record<ObjectionCategory, string> = {
  price_high: "the price is too high",
  cheaper_competitor: "someone else is cheaper",
  faster_delivery: "wants faster delivery",
  discount: "asks for a discount",
  need_to_think: "needs time to think",
  why_choose_you: "asks why choose you",
  portfolio: "asks for your portfolio",
  guarantee: "asks for a guarantee",
  limited_budget: "has a limited budget",
  other: "other concern",
};

export interface Hooks {
  openComposer(text: string, clientLanguage: string | null): void;
}

/** The one request this file has running. A new one cancels the old one. */
let currentRequest: string | null = null;

function cancelCurrent() {
  if (currentRequest) {
    send({ type: "CANCEL", requestId: currentRequest }).catch(() => undefined);
    currentRequest = null;
  }
}

/** Forgets the objection answer and the summary, and cancels anything still running. */
export function resetExtras() {
  cancelCurrent();
  for (const id of ["objectionOut", "summaryOut"]) {
    $(id).replaceChildren();
    $(id).hidden = true;
  }
  setLine("objectionStatus", null);
  setLine("summaryStatus", null);
}

// ---------- Objection ----------
export function objectionButton(objection: string, chat: ChatPayload, hooks: Hooks): HTMLButtonElement {
  const b = make("button", undefined, "Help me answer this");
  b.type = "button";
  b.addEventListener("click", () => void handleObjection(objection, chat, hooks));
  return b;
}

async function handleObjection(objection: string, chat: ChatPayload, hooks: Hooks) {
  cancelCurrent();
  $("objectionOut").replaceChildren();
  $("objectionOut").hidden = true;
  setLine("objectionStatus", "Thinking about this concern... this can take 10 to 20 seconds.");

  const requestId = crypto.randomUUID();
  currentRequest = requestId;

  try {
    const r = await send({ type: "OBJECTION", messages: chat.messages, objection, requestId });
    if (currentRequest !== requestId) return; // the user moved on
    currentRequest = null;
    setLine("objectionStatus", null);
    renderObjection(r, objection, chat, hooks);
  } catch (err) {
    if (currentRequest !== requestId) return;
    currentRequest = null;
    if (err instanceof ExtError && err.code === "CANCELLED") return;
    setLine("objectionStatus", friendly(err));
  }
}

function renderObjection(r: ObjectionResponse, objection: string, chat: ChatPayload, hooks: Hooks) {
  const out = $("objectionOut");
  out.replaceChildren();

  out.append(make("h3", undefined, `Concern: ${CATEGORY_LABELS[r.category]}`));
  out.append(make("p", "muted small", `About: "${short(objection)}"${r.cached ? " · from memory" : ""}`));

  if (r.needsYourInput.length > 0) out.append(callout("You need to add:", r.needsYourInput));
  if (r.warnings.length > 0) out.append(callout("Be careful:", r.warnings));

  out.append(section("What the client may be worried about", r.concern));
  out.append(section("How to approach it", r.strategy));
  if (r.alternative) out.append(section("Another honest approach to consider (a note for you)", r.alternative));

  out.append(
    make("p", "muted small", "Written by AI. It can make mistakes. Check every fact before you send. You press Send yourself.")
  );
  if (r.flags.length > 0) out.append(callout("Check before you use this reply:", r.flags.map((f) => f.message)));

  const card = make("div", "reply");
  card.append(make("strong", undefined, "Suggested reply"));
  const body = make("p", "reply-text", r.reply);
  body.setAttribute("dir", "auto"); // right-to-left languages display correctly
  card.append(body);
  const use = make("button", undefined, "Use this reply");
  use.type = "button";
  use.addEventListener("click", () => hooks.openComposer(r.reply, chat.clientLanguage));
  card.append(use);
  out.append(card);

  out.hidden = false;
  out.scrollIntoView({ block: "nearest" });
}

// ---------- Summary ----------
export async function runSummary(chat: ChatPayload, fresh: boolean, onAgain: () => void) {
  cancelCurrent();
  $("summaryOut").replaceChildren();
  $("summaryOut").hidden = true;

  if (!chat.messages.some((m) => m.sender === "client")) {
    setLine("summaryStatus", "There is no message from the client in this chat yet.");
    return;
  }

  setLine("summaryStatus", "Summarizing...");
  const requestId = crypto.randomUUID();
  currentRequest = requestId;

  try {
    const r = await send({ type: "SUMMARY", messages: chat.messages, fresh, requestId });
    if (currentRequest !== requestId) return;
    currentRequest = null;
    setLine("summaryStatus", null);
    renderSummary(r, chat, onAgain);
  } catch (err) {
    if (currentRequest !== requestId) return;
    currentRequest = null;
    if (err instanceof ExtError && err.code === "CANCELLED") return;
    setLine("summaryStatus", friendly(err));
  }
}

function renderSummary(r: SummaryResponse, chat: ChatPayload, onAgain: () => void) {
  const out = $("summaryOut");
  out.replaceChildren();

  out.append(make("h3", undefined, "Summary of this chat"));
  out.append(
    make(
      "p",
      "muted small",
      `${chat.messages.length} messages read` +
        (chat.trimmed ? " (older or very long parts left out)" : "") +
        (r.cached ? " · from memory" : "") +
        ". Written by AI, so check it against the chat."
    )
  );

  if (r.warnings.length > 0) out.append(callout("Check this:", r.warnings));

  if (r.wants) out.append(section("What the client wants", r.wants));
  if (r.requirements.length > 0) out.append(section("Requirements so far", listOf(r.requirements)));
  if (r.budget) out.append(section("Budget", r.budget));
  if (r.deadline) out.append(section("Deadline", r.deadline));
  if (r.decisions.length > 0) out.append(section("Agreed or stated", listOf(r.decisions)));
  if (r.openQuestions.length > 0) out.append(section("Questions still open", listOf(r.openQuestions)));
  if (r.nextAction) out.append(section("Your next step", r.nextAction));

  const again = make("button", undefined, "Summarize again (new answer)");
  again.type = "button";
  again.addEventListener("click", onAgain);
  out.append(again);

  out.hidden = false;
  out.scrollIntoView({ block: "nearest" });
}