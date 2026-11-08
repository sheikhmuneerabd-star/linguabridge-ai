/** Reads what is currently typed in the message box. */
export function readDraft(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value;
  return (el.innerText ?? "").replace(/\u00a0/g, " ").trim();
}

const norm = (s: string) => s.replace(/\u00a0/g, " ").replace(/\r\n/g, "\n").trim();

function inputEvent(text: string): InputEvent {
  return new InputEvent("input", { bubbles: true, inputType: "insertText", data: text });
}

/**
 * Replaces the text in the message box and tells the page about it (so a React app notices).
 * It never presses Send and never sends key events.
 * Returns true if the box really holds the text afterwards.
 */
export function writeDraft(el: HTMLElement, text: string): boolean {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, text);
    else el.value = text;
    el.dispatchEvent(inputEvent(text));
    return el.value === text;
  }

  // contenteditable box
  el.focus();
  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  const done = document.execCommand("insertText", false, text);
  if (!done) {
    el.textContent = text;
    el.dispatchEvent(inputEvent(text));
  }
  return norm(readDraft(el)) === norm(text);
}