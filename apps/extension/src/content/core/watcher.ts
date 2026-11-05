import type { ChatMessage, PlatformAdapter } from "./types";

export interface Snapshot {
  isChat: boolean;
  conversationId: string | null;
  messages: ChatMessage[];
  hasInput: boolean;
}

const DEBOUNCE_MS = 300;
const URL_POLL_MS = 500;

function isOurs(node: Node | null): boolean {
  const el = node instanceof Element ? node : node?.parentElement;
  return !!el?.closest("[data-lb]");
}

/** True if a mutation was caused only by elements WE added or removed. */
function onlyOurChanges(m: MutationRecord): boolean {
  if (isOurs(m.target)) return true;
  if (m.type !== "childList") return false;
  const changed = [...m.addedNodes, ...m.removedNodes];
  return changed.length > 0 && changed.every((n) => isOurs(n));
}

export class ChatWatcher {
  private observer: MutationObserver | null = null;
  private observedRoot: HTMLElement | null = null;
  private debounceTimer: number | undefined;
  private urlTimer: number | undefined;
  private lastUrl = location.href;
  private lastKey = "";

  constructor(
    private adapter: PlatformAdapter,
    private onChange: (snapshot: Snapshot) => void
  ) {}

  start(): void {
    this.attach();
    this.scan();

    // Fiverr is a single-page app: the address changes without a page reload.
    this.urlTimer = window.setInterval(() => {
      if (location.href !== this.lastUrl) {
        this.lastUrl = location.href;
        this.schedule();
      }
      // If the page replaced the element we were watching, watch the new one.
      if (this.observedRoot && !this.observedRoot.isConnected) this.attach();
    }, URL_POLL_MS);
  }

  stop(): void {
    this.observer?.disconnect();
    window.clearTimeout(this.debounceTimer);
    window.clearInterval(this.urlTimer);
  }

  private attach(): void {
    this.observer?.disconnect();
    this.observedRoot = this.adapter.getObserveRoot();
    this.observer = new MutationObserver((mutations) => {
      if (mutations.every(onlyOurChanges)) return;
      this.schedule();
    });
    this.observer.observe(this.observedRoot, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  private schedule(): void {
    window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => this.scan(), DEBOUNCE_MS);
  }

  private scan(): void {
    try {
      const isChat = this.adapter.isChatPage();
      const messages = isChat ? this.adapter.getMessages() : [];
      const conversationId = isChat ? this.adapter.getConversationId() : null;
      const hasInput = isChat && this.adapter.getInputElement() !== null;

      // Only report when something really changed.
      const key = [conversationId ?? "-", hasInput, ...messages.map((m) => m.id)].join("|");
      if (key === this.lastKey) return;
      this.lastKey = key;

      this.onChange({ isChat, conversationId, messages, hasInput });
    } catch (err) {
      console.warn("[LinguaBridge] could not read the page:", err);
    }
  }
}