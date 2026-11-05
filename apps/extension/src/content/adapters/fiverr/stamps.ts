export type StampStatus =
  | "ok"
  | "page header"
  | "hidden"
  | "below message box"
  | "outside chat column";

export function classifyStamp(el: HTMLElement, inputRect: DOMRect | undefined): StampStatus {
  // The "9:04 AM (local time)" label in the chat header is not a message.
  if (el.closest("header, nav, aside, [role='banner'], [role='navigation']")) return "page header";

  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return "hidden";

  if (inputRect) {
    if (r.top >= inputRect.top) return "below message box";
    const centerX = (r.left + r.right) / 2;
    if (centerX < inputRect.left || centerX > inputRect.right) return "outside chat column";
  }
  return "ok";
}