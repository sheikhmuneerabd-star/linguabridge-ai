import { LANGUAGES } from "@linguabridge/shared";

export type StripState =
  | { kind: "waiting" }
  | { kind: "loading" }
  | { kind: "done"; text: string; label: string; status?: string }
  | { kind: "applied" }
  | { kind: "manual"; text: string; status?: string }
  | { kind: "note"; message: string }
  | { kind: "error"; message: string; canRetry: boolean };

export interface LangInfo {
  code: string;
  source: "detected" | "chosen" | "default";
}

export interface StripHandlers {
  onApply(): void;
  onCopy(): void;
  onUndo(): void;
  onRetry(): void;
  onLanguage(code: string): void;
}

export interface DraftStrip {
  host: HTMLElement;
  update(state: StripState, lang: LangInfo): void;
  destroy(): void;
}

const CSS = `
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  .box {
    font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #0f172a; background: #f8fafc; border: 1px solid #cbd5e1; border-left: 3px solid #15803d;
    border-radius: 8px; padding: 8px 10px; text-align: start;
  }
  .box.error { border-left-color: #b91c1c; background: #fef2f2; }
  .head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; }
  .label { color: #334155; font-size: 12px; }
  .error .label { color: #b91c1c; }
  .lang { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #475569; }
  select {
    font: inherit; font-size: 12px; padding: 2px 4px; border: 1px solid #94a3b8;
    border-radius: 6px; background: #fff; color: #0f172a;
  }
  .body { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  button {
    font: inherit; font-size: 13px; padding: 4px 12px; border-radius: 6px;
    border: 1px solid #94a3b8; background: #fff; color: #0f172a; cursor: pointer;
  }
  button.primary { background: #15803d; border-color: #15803d; color: #fff; font-weight: 600; }
  button:focus-visible, select:focus-visible { outline: 2px solid #2563eb; outline-offset: 1px; }
`;

/** Clicks and keys inside our strip must not reach Fiverr. */
const BLOCKED_EVENTS = ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown", "keyup"];

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

function makeButton(text: string, primary = false): HTMLButtonElement {
  const b = make("button", primary ? "primary" : undefined);
  b.type = "button";
  b.textContent = text;
  return b;
}

export function createStrip(h: StripHandlers): DraftStrip {
  const host = document.createElement("div");
  host.setAttribute("data-lb", "draft");
  host.style.cssText = "display:block;width:100%;min-width:0;box-sizing:border-box;margin:0 0 8px;";

  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = CSS;

  const box = make("div", "box");
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", "LinguaBridge reply translation");

  const head = make("div", "head");
  const label = make("span", "label");
  label.setAttribute("role", "status");
  label.setAttribute("aria-live", "polite");

  const langWrap = make("div", "lang");
  const to = make("span");
  to.textContent = "To:";
  const select = make("select");
  select.setAttribute("aria-label", "Client's language");
  for (const l of LANGUAGES) {
    const o = make("option");
    o.value = l.code;
    o.textContent = l.name;
    select.append(o);
  }
  const hint = make("span");
  langWrap.append(to, select, hint);
  head.append(label, langWrap);

  const body = make("p", "body");
  body.setAttribute("dir", "auto"); // right-to-left languages display correctly

  const actions = make("div", "actions");
  const apply = makeButton("Apply to message box", true);
  const copy = makeButton("Copy");
  const undo = makeButton("Undo");
  const retry = makeButton("Try again");
  actions.append(apply, copy, undo, retry);

  box.append(head, body, actions);
  root.append(style, box);

  for (const type of BLOCKED_EVENTS) box.addEventListener(type, (e) => e.stopPropagation());

  apply.addEventListener("click", () => h.onApply());
  copy.addEventListener("click", () => h.onCopy());
  undo.addEventListener("click", () => h.onUndo());
  retry.addEventListener("click", () => h.onRetry());
  select.addEventListener("change", () => h.onLanguage(select.value));

  let state: StripState = { kind: "loading" };
  let lang: LangInfo = { code: "en", source: "default" };

  function render(): void {
    box.classList.toggle("error", state.kind === "error");
    for (const b of [apply, copy, undo, retry]) b.hidden = true;
    body.hidden = true;
    body.textContent = "";

    select.value = lang.code;
    langWrap.hidden = state.kind === "applied";
    hint.textContent =
      lang.source === "detected" ? "detected from the chat" : lang.source === "default" ? "not detected, please check" : "";

    switch (state.kind) {
      case "waiting":
        label.textContent = "Waiting for you to finish typing...";
        break;
      case "loading":
        label.textContent = "Translating...";
        break;
      case "done":
        label.textContent = state.label + (state.status ? ` · ${state.status}` : "");
        body.textContent = state.text;
        body.hidden = false;
        apply.hidden = false;
        copy.hidden = false;
        break;
      case "manual":
        label.textContent =
          "Could not fill the message box automatically. Copy the text and paste it yourself." +
          (state.status ? ` (${state.status})` : "");
        body.textContent = state.text;
        body.hidden = false;
        copy.hidden = false;
        break;
      case "applied":
        label.textContent = "Applied. Check the message, then press Send yourself.";
        undo.hidden = false;
        break;
      case "note":
        label.textContent = state.message;
        break;
      case "error":
        label.textContent = state.message;
        retry.hidden = !state.canRetry;
        break;
    }
  }

  render();

  return {
    host,
    update(next, nextLang) {
      state = next;
      lang = nextLang;
      render();
    },
    destroy() {
      host.remove();
    },
  };
}