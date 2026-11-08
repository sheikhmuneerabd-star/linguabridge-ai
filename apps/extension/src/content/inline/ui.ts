export type CardState =
  | { kind: "loading" }
  | { kind: "done"; text: string; route: string }
  | { kind: "note"; message: string }
  | { kind: "error"; message: string; canRetry: boolean };

export interface InlineCard {
  /** The element we place on the page. */
  host: HTMLElement;
  update(state: CardState): void;
  destroy(): void;
}

interface Options {
  collapsed: boolean;
  onCollapsedChange(collapsed: boolean): void;
  onRetry(): void;
}

const CSS = `
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  .box {
    font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #0f172a;
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    border-left: 3px solid #2563eb;
    border-radius: 8px;
    padding: 8px 10px;
    text-align: start;
  }
  .box.error { border-left-color: #b91c1c; background: #fef2f2; }
  .head { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 12px; }
  .label { color: #475569; font-size: 12px; }
  .error .label { color: #b91c1c; }
  button {
    font: inherit; font-size: 12px; color: #1d4ed8; background: none; border: none;
    padding: 2px 4px; cursor: pointer; text-decoration: underline; border-radius: 4px;
  }
  button:focus-visible { outline: 2px solid #2563eb; outline-offset: 1px; }
  .body { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
`;

/** Clicks and keys inside our box must not reach Fiverr (it would open or select the message). */
const BLOCKED_EVENTS = ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown", "keyup"];

export function createCard(options: Options): InlineCard {
  const host = document.createElement("div");
  host.setAttribute("data-lb", "translation");
    host.style.cssText = "display:block;width:100%;min-width:0;align-self:stretch;flex:0 0 auto;box-sizing:border-box;margin:6px 0 2px;";

  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = CSS;

  const box = document.createElement("div");
  box.className = "box";
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", "LinguaBridge translation");

  const head = document.createElement("div");
  head.className = "head";
  const label = document.createElement("span");
  label.className = "label";
  const toggle = document.createElement("button");
  toggle.type = "button";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Try again";
  head.append(label, toggle, retry);

  const body = document.createElement("p");
  body.className = "body";
  body.setAttribute("dir", "auto"); // right-to-left languages (Urdu, Arabic) display correctly

  box.append(head, body);
  root.append(style, box);

  for (const type of BLOCKED_EVENTS) box.addEventListener(type, (e) => e.stopPropagation());

  let state: CardState = { kind: "loading" };
  let collapsed = options.collapsed;

  function render(): void {
    box.classList.toggle("error", state.kind === "error");
    toggle.hidden = true;
    retry.hidden = true;
    body.hidden = true;
    label.removeAttribute("title");
    body.textContent = "";

    switch (state.kind) {
      case "loading":
        label.textContent = "Translating...";
        break;
      case "done":
        label.textContent = `${state.route} · AI translation`;
        label.title = "Automatic translation. It can contain mistakes.";
        toggle.hidden = false;
        toggle.textContent = collapsed ? "Show translation" : "Hide";
        toggle.setAttribute("aria-expanded", String(!collapsed));
        body.textContent = state.text;
        body.hidden = collapsed;
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

  toggle.addEventListener("click", () => {
    collapsed = !collapsed;
    options.onCollapsedChange(collapsed);
    render();
  });
  retry.addEventListener("click", () => options.onRetry());

  render();

  return {
    host,
    update(next) {
      state = next;
      render();
    },
    destroy() {
      host.remove();
    },
  };
}