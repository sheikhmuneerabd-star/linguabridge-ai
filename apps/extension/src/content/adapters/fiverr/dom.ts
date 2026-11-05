import { TIMESTAMP } from "./selectors";

export function isVisible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

/** Text written directly inside this element (not inside its children). */
export function ownText(el: Element): string {
  let s = "";
  for (const n of el.childNodes) {
    if (n.nodeType === Node.TEXT_NODE) s += n.textContent ?? "";
  }
  return s.trim();
}

/** Elements with no children whose whole text looks like a time label. In page order. */
export function findTimestampLeaves(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    const el = node as HTMLElement;
    if (el.childElementCount === 0 && !el.closest("[data-lb]")) {
      const t = (el.textContent ?? "").trim();
      if (t.length > 3 && t.length < 30 && TIMESTAMP.test(t)) out.push(el);
    }
    node = walker.nextNode();
  }
  return out;
}

const SKIP = "button, [role='button'], svg, figure, img, script, style, [data-lb]";

/**
 * Pieces of visible text inside a message block, in reading order.
 * A piece is an element that has its own text; its children are not repeated.
 * Buttons, icons, avatars and the time label are skipped, but only when they are
 * INSIDE the block. (Fiverr wraps a whole message in a role="button" element, and that
 * wrapper must not hide the message itself.)
 */
export function textPieces(block: HTMLElement, stamp: HTMLElement): { el: HTMLElement; text: string }[] {
  const out: { el: HTMLElement; text: string }[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    const el = node as HTMLElement;
    const hit = el.closest(SKIP);
    const insideSkipped = hit !== null && hit !== block && block.contains(hit);

    const skip =
      insideSkipped ||
      el === stamp ||
      stamp.contains(el) ||
      el.contains(stamp) ||
      out.some((p) => p.el.contains(el));

    if (!skip && ownText(el)) {
      const text = (el.textContent ?? "").trim();
      if (text) out.push({ el, text });
    }
    node = walker.nextNode();
  }
  return out;
}

/** A short description of an element: tag, id, classes, a few safe attributes. Never its text. */
export function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id.slice(0, 30)}` : "";
  const cls = Array.from(el.classList)
    .slice(0, 4)
    .map((c) => `.${c.slice(0, 40)}`)
    .join("");

  const attrs: string[] = [];
  for (const name of [
    "role",
    "contenteditable",
    "type",
    "aria-label",
    "placeholder",
    "data-placeholder",
    "data-testid",
    "data-qa",
    "datetime",
  ]) {
    const v = el.getAttribute(name);
    if (v !== null) attrs.push(`${name}="${v.slice(0, 40)}"`);
  }
  return `${tag}${id}${cls}${attrs.length ? ` [${attrs.join(" ")}]` : ""}`;
}