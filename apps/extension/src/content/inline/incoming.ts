import { getLanguageName } from "@linguabridge/shared";
import { ExtError, send } from "../../shared/client";
import { CONSENT_KEY, PREFS_TS_KEY, TOKEN_KEY } from "../../shared/storage";
import type { ChatMessage, PlatformAdapter } from "../core/types";
import type { Snapshot } from "../core/watcher";
import { createCard, type InlineCard } from "./ui";

const MAX_PARALLEL = 2;
const MAX_CHARS = 4000;
const SETTINGS_RETRY_MS = 20_000;
const MAX_SETTINGS_RETRIES = 5;
/** After opening another chat, wait for the page to finish loading it before translating. */
const QUIET_MS = 800;
/** The newest identified client messages that decide which language the client uses. */
const LANG_SAMPLE = 8;

/** Errors that belong to one message only; everything else means "stop and let the user retry". */
const ITEM_ONLY_ERRORS = new Set(["AI_BAD_FORMAT", "AI_EMPTY", "VALIDATION_ERROR"]);

type Outcome =
  | { kind: "show"; from: string; text: string }
  | { kind: "skip"; lang: string } // already in the user's language, or nothing to translate
  | { kind: "note"; message: string };

interface Item {
  id: string;
  message: ChatMessage;
  status: "idle" | "queued" | "loading" | "settled" | "error";
  card: InlineCard | null;
  requestId: string | null;
  observed: HTMLElement | null;
}

export class IncomingTranslator {
  private enabled = false;
  private dead = false;
  private targetLang = "";
  private settingsRetries = 0;
  private settingsTimer: number | undefined;

  private snapshot: Snapshot | null = null;
  private conversationId: string | null = null;
  private quietUntil = 0;
  private quietTimer: number | undefined;

  private items = new Map<string, Item>();
  private outcomes = new Map<string, Outcome>();
  private collapsed = new Set<string>();
  private order = new Map<string, number>();
  private visible = new Set<string>();
  private elementToId = new WeakMap<Element, string>();

  private queue: string[] = [];
  private active = 0;
  private generation = 0;
  private halted: null | "soft" | "hard" = null;

  // Only messages near the screen are translated.
  private observer = new IntersectionObserver((entries) => this.onVisibility(entries), {
    rootMargin: "400px 0px",
  });

  constructor(private adapter: PlatformAdapter) {}

  init(): void {
    void this.loadSettings();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[CONSENT_KEY] || changes[TOKEN_KEY] || changes[PREFS_TS_KEY]) {
        this.settingsRetries = 0;
        void this.loadSettings();
      }
    });
  }

  onSnapshot(snapshot: Snapshot): void {
    this.snapshot = snapshot;
    this.refresh();
  }

  /**
   * The language the client writes in, judged from the newest client messages we have identified.
   * The most common one wins; on a tie the newer one wins. Null if nothing is known yet.
   */
  clientLanguage(): string | null {
    const known: { index: number; lang: string }[] = [];
    for (const [id, outcome] of this.outcomes) {
      const lang = outcome.kind === "show" ? outcome.from : outcome.kind === "skip" ? outcome.lang : null;
      if (lang && lang !== "und") known.push({ index: this.order.get(id) ?? -1, lang });
    }
    if (known.length === 0) return null;

    const recent = known.sort((a, b) => b.index - a.index).slice(0, LANG_SAMPLE);
    const counts = new Map<string, number>();
    for (const r of recent) counts.set(r.lang, (counts.get(r.lang) ?? 0) + 1);

    let best = recent[0].lang;
    let bestCount = 0;
    for (const r of recent) {
      const n = counts.get(r.lang) ?? 0;
      if (n > bestCount) {
        best = r.lang;
        bestCount = n;
      }
    }
    return best;
  }

  // ---------- settings ----------
  private async loadSettings(): Promise<void> {
    if (this.dead) return;
    window.clearTimeout(this.settingsTimer);

    let enabled = false;
    try {
      const stored = await chrome.storage.local.get(CONSENT_KEY);
      if (stored[CONSENT_KEY] === true) {
        const me = await send({ type: "GET_ME" });
        if (me?.preferences.onboardingDone) {
          enabled = true;
          this.targetLang = me.preferences.displayLanguage;
        }
      }
    } catch (err) {
      if (err instanceof ExtError && err.code === "EXTENSION_ERROR") {
        this.shutdown();
        return;
      }
      // Server may be starting or offline: try again a few times.
      if (this.settingsRetries++ < MAX_SETTINGS_RETRIES) {
        this.settingsTimer = window.setTimeout(() => void this.loadSettings(), SETTINGS_RETRY_MS);
      }
    }

    this.enabled = enabled;
    this.halted = null;
    this.reset(); // language or account may have changed, so old translations may be wrong
    this.refresh();
  }

  /** The extension was reloaded or removed while this page stayed open. */
  shutdown(): void {
    this.dead = true;
    this.enabled = false;
    this.reset();
    this.observer.disconnect();
    window.clearTimeout(this.settingsTimer);
    window.clearTimeout(this.quietTimer);
  }

  // ---------- keeping the page in sync ----------
  private refresh(): void {
    const s = this.snapshot;
    if (!s || this.dead) return;

    if (s.conversationId !== this.conversationId) {
      this.reset();
      this.conversationId = s.conversationId;
      // Give the page a moment to finish loading the new chat before we look at its messages.
      this.quietUntil = Date.now() + QUIET_MS;
      window.clearTimeout(this.quietTimer);
      this.quietTimer = window.setTimeout(() => this.refresh(), QUIET_MS + 50);
    }

    if (!s.isChat || !this.enabled) {
      if (this.items.size > 0) this.reset();
      return;
    }
    if (Date.now() < this.quietUntil) return;

    const clients = s.messages.filter((m) => m.sender === "client");
    this.order = new Map(s.messages.map((m, i) => [m.id, i]));
    const present = new Set(clients.map((m) => m.id));

    for (const item of [...this.items.values()]) {
      if (!present.has(item.id)) this.dropItem(item);
    }

    for (const m of clients) {
      let item = this.items.get(m.id);
      if (!item) {
        item = { id: m.id, message: m, status: "idle", card: null, requestId: null, observed: null };
        this.items.set(m.id, item);
      } else {
        item.message = m;
      }

      this.watchElement(item);
      if (item.card) this.mount(item); // re-attach if the page re-created the message

      if (item.status === "idle") {
        const known = this.outcomes.get(m.id);
        if (known) this.applyOutcome(item, known);
        else if (this.visible.has(m.id)) this.enqueue(item);
      }
    }

    this.pump();
  }

  private watchElement(item: Item): void {
    const el = item.message.element;
    if (item.observed === el) return;
    if (item.observed) this.observer.unobserve(item.observed);
    item.observed = el;
    this.elementToId.set(el, item.id);
    this.observer.observe(el);
  }

  private onVisibility(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const id = this.elementToId.get(entry.target);
      if (!id) continue;

      if (!entry.isIntersecting) {
        this.visible.delete(id);
        continue;
      }
      this.visible.add(id);

      const item = this.items.get(id);
      if (item && item.status === "idle") {
        const known = this.outcomes.get(id);
        if (known) this.applyOutcome(item, known);
        else this.enqueue(item);
      }
    }
    this.pump();
  }

  // ---------- queue ----------
  private enqueue(item: Item): void {
    if (this.halted) return;
    item.status = "queued";
    this.queue.push(item.id);
  }

  private pump(): void {
    while (!this.halted && this.active < MAX_PARALLEL && this.queue.length > 0) {
      // Newest messages first: people usually read the bottom of the chat.
      let best = 0;
      for (let i = 1; i < this.queue.length; i++) {
        if ((this.order.get(this.queue[i]) ?? -1) > (this.order.get(this.queue[best]) ?? -1)) best = i;
      }
      const id = this.queue.splice(best, 1)[0];
      const item = this.items.get(id);
      if (!item || item.status !== "queued") continue;

      // The user scrolled away while this was waiting: skip it. It joins the line again
      // if the message comes back into view.
      if (!this.visible.has(id)) {
        item.status = "idle";
        continue;
      }
      void this.run(item);
    }
  }

  private async run(item: Item): Promise<void> {
    const generation = this.generation;
    const text = item.message.text;

    if (text.length > MAX_CHARS) {
      const outcome: Outcome = { kind: "note", message: "This message is too long to translate automatically." };
      this.outcomes.set(item.id, outcome);
      this.applyOutcome(item, outcome);
      return;
    }

    this.active++;
    item.status = "loading";
    this.card(item).update({ kind: "loading" });
    const requestId = crypto.randomUUID();
    item.requestId = requestId;

    const stale = () =>
      generation !== this.generation || this.items.get(item.id) !== item || item.requestId !== requestId;

    try {
      const r = await send({ type: "TRANSLATE_INCOMING", text, requestId });
      if (stale()) return; // the user moved on (another chat, message gone, settings changed)

      const outcome: Outcome =
        r.needsTranslation && r.translation
          ? { kind: "show", from: r.detectedLang, text: r.translation }
          : { kind: "skip", lang: r.detectedLang };
      this.outcomes.set(item.id, outcome);
      this.applyOutcome(item, outcome);
    } catch (err) {
      if (stale()) return;
      this.handleError(item, err);
    } finally {
      if (generation === this.generation) {
        this.active--;
        this.pump();
      }
    }
  }

  private handleError(item: Item, err: unknown): void {
    const code = err instanceof ExtError ? err.code : "UNKNOWN";
    const message = err instanceof ExtError ? err.message : "Translation failed. Please try again.";

    if (code === "CANCELLED") {
      item.status = "idle";
      this.removeCard(item);
      return;
    }
    if (code === "EXTENSION_ERROR") {
      this.shutdown();
      return;
    }
    if (code === "UNAUTHORIZED" || code === "SESSION_EXPIRED") {
      this.enabled = false;
      this.reset();
      return;
    }

    item.status = "error";

    if (code === "DAILY_LIMIT") {
      this.halt("hard");
      this.card(item).update({ kind: "error", message, canRetry: false });
      return;
    }

    // Server busy, offline, and so on: stop sending more and let the user decide.
    if (!ITEM_ONLY_ERRORS.has(code)) this.halt("soft");
    this.card(item).update({ kind: "error", message, canRetry: true });
  }

  private halt(kind: "soft" | "hard"): void {
    this.halted = kind;
    for (const id of this.queue) {
      const it = this.items.get(id);
      if (it && it.status === "queued") it.status = "idle";
    }
    this.queue = [];
  }

  private retry(): void {
    if (this.halted === "hard") return;
    this.halted = null;

    for (const item of this.items.values()) {
      if (item.status === "error") {
        this.removeCard(item);
        item.status = "idle";
      }
    }
    for (const item of this.items.values()) {
      if (item.status === "idle" && this.visible.has(item.id) && !this.outcomes.has(item.id)) {
        this.enqueue(item);
      }
    }
    this.pump();
  }

  // ---------- cards ----------
  private card(item: Item): InlineCard {
    const card =
      item.card ??
      createCard({
        collapsed: this.collapsed.has(item.id),
        onCollapsedChange: (c) => {
          if (c) this.collapsed.add(item.id);
          else this.collapsed.delete(item.id);
        },
        onRetry: () => this.retry(),
      });
    item.card = card;
    this.adapter.mountInlineUI(item.message, card.host);
    return card;
  }

  private mount(item: Item): void {
    if (item.card) this.adapter.mountInlineUI(item.message, item.card.host);
  }

  private removeCard(item: Item): void {
    item.card?.destroy();
    item.card = null;
  }

  private applyOutcome(item: Item, outcome: Outcome): void {
    item.status = "settled";
    item.requestId = null;

    if (outcome.kind === "skip") {
      this.removeCard(item);
    } else if (outcome.kind === "note") {
      this.card(item).update({ kind: "note", message: outcome.message });
    } else {
      this.card(item).update({
        kind: "done",
        text: outcome.text,
        route: `${getLanguageName(outcome.from)} → ${getLanguageName(this.targetLang)}`,
      });
    }
  }

  // ---------- cleaning up ----------
  private dropItem(item: Item): void {
    this.cancelRequest(item);
    if (item.observed) this.observer.unobserve(item.observed);
    this.visible.delete(item.id);
    this.removeCard(item);
    this.items.delete(item.id);
  }

  private cancelRequest(item: Item): void {
    if (item.status === "loading" && item.requestId) {
      send({ type: "CANCEL", requestId: item.requestId }).catch(() => undefined);
    }
  }

  /** Removes everything we put on the page and forgets the current chat. */
  private reset(): void {
    this.generation++;
    this.active = 0;
    for (const item of this.items.values()) {
      this.cancelRequest(item);
      if (item.observed) this.observer.unobserve(item.observed);
      item.card?.destroy();
    }
    this.items.clear();
    this.outcomes.clear();
    this.visible.clear();
    this.order.clear();
    this.queue = [];
    if (this.halted === "soft") this.halted = null;
  }
}