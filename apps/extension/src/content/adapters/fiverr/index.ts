import { hash } from "../../core/hash";
import type { ChatMessage, PlatformAdapter, Sender } from "../../core/types";
import { diagnoseFiverr } from "./diagnose";
import { findTimestampLeaves, isVisible, textPieces } from "./dom";
import { INPUT_HINT, INPUT_SELECTORS, MAX_CLIMB, MESSAGE_PART } from "./selectors";
import { classifyStamp } from "./stamps";

/** Fiverr chat addresses look like /inbox/<username>. */
const CHAT_PATH = /^\/inbox\/([^/]+)\/?$/;

function hintText(el: HTMLElement): string {
  return ["placeholder", "aria-label", "data-placeholder", "aria-placeholder"]
    .map((a) => el.getAttribute(a) ?? "")
    .join(" ");
}

function countStamps(root: HTMLElement, stamps: Set<HTMLElement>): number {
  let n = 0;
  for (const s of stamps) if (root.contains(s)) n++;
  return n;
}

/**
 * Finds the block that holds exactly one message.
 * 1) Preferred: the parent of Fiverr's ".message-content" part, if it holds only this time label.
 * 2) Fallback: climb up while the parent still holds only this one time label
 *    (and not the message box, and not the page header's time label).
 */
function messageBlock(stamp: HTMLElement, allStamps: Set<HTMLElement>, input: HTMLElement | null): HTMLElement {
  const holdsInput = (el: HTMLElement) => input !== null && el.contains(input);

  const candidate = stamp.closest<HTMLElement>(MESSAGE_PART)?.parentElement ?? null;
  if (
    candidate &&
    candidate !== document.body &&
    !holdsInput(candidate) &&
    countStamps(candidate, allStamps) === 1
  ) {
    return candidate;
  }

  let block = stamp;
  for (let i = 0; i < MAX_CLIMB; i++) {
    const parent = block.parentElement;
    if (!parent || parent === document.body) break;
    if (holdsInput(parent)) break;
    if (countStamps(parent, allStamps) > 1) break;
    block = parent;
  }
  return block;
}

export class FiverrAdapter implements PlatformAdapter {
  readonly name = "Fiverr";

  matchesUrl(url: URL): boolean {
    return url.hostname === "www.fiverr.com" || url.hostname === "fiverr.com";
  }

  isChatPage(): boolean {
    return CHAT_PATH.test(location.pathname);
  }

  getConversationId(): string | null {
    const m = location.pathname.match(CHAT_PATH);
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }

  getObserveRoot(): HTMLElement {
    // Will be narrowed to the chat container once we know exactly where it is.
    return document.body;
  }

  getInputElement(): HTMLElement | null {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(INPUT_SELECTORS.join(","))
    ).filter((el) => isVisible(el) && !el.closest("[data-lb]"));

    const hinted = candidates.filter((el) => INPUT_HINT.test(hintText(el)));
    const pool = hinted.length > 0 ? hinted : candidates;

    // The chat box sits at the bottom of the screen: take the lowest one.
    pool.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
    return pool[0] ?? null;
  }

  getDraftText(): string {
    const el = this.getInputElement();
    if (!el) return "";
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value;
    return (el.innerText ?? "").replace(/\u00a0/g, " ").trim();
  }

  /** The other person's display name from the chat header (it can differ from the URL name). */
  private partnerName(): string {
    const stamp = findTimestampLeaves(document.body).find((s) => s.closest("header"));
    const header = stamp?.closest<HTMLElement>("header");
    if (!stamp || !header) return "";
    return textPieces(header, stamp)[0]?.text.trim() ?? "";
  }

  getMessages(): ChatMessage[] {
    const urlName = (this.getConversationId() ?? "").toLowerCase();
    const headerName = this.partnerName().toLowerCase();
    const clientNames = [urlName, headerName].filter((n) => n !== "");

    const input = this.getInputElement();
    const inputRect = input?.getBoundingClientRect();

    const all = findTimestampLeaves(document.body);
    const allSet = new Set(all);
    const stamps = all.filter((el) => classifyStamp(el, inputRect) === "ok");

    const seen = new Map<string, number>();
    const messages: ChatMessage[] = [];

    for (const stamp of stamps) {
      const block = messageBlock(stamp, allSet, input);
      const pieces = textPieces(block, stamp);
      if (pieces.length === 0) continue;

      const first = pieces[0].text.trim().toLowerCase();
      const isClientName = clientNames.includes(first);
      const isMeName = first === "me";
      const hasName = isClientName || isMeName;

      const text = (hasName ? pieces.slice(1) : pieces)
        .map((p) => p.text)
        .join("\n")
        .trim();
      if (!text) continue;

      const sender: Sender = isClientName ? "client" : isMeName ? "me" : "unknown";
      const timeLabel = (stamp.textContent ?? "").trim();

      // Same text sent twice at the same time still gets two different ids.
      const key = `${urlName}|${sender}|${timeLabel}|${text}`;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);

      messages.push({ id: hash(`${key}#${n}`), sender, text, timeLabel, element: block });
    }

    return messages;
  }

  diagnose(): string {
    return diagnoseFiverr(this);
  }
}