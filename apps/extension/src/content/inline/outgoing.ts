import { LANGUAGES, getLanguageName } from "@linguabridge/shared";
import { ExtError, send } from "../../shared/client";
import { PREFS_TS_KEY, REPLY_KEY, TOKEN_KEY } from "../../shared/storage";
import { readDraft } from "../core/input";
import type { PlatformAdapter } from "../core/types";
import type { Snapshot } from "../core/watcher";
import { createStrip, type DraftStrip, type LangInfo, type StripState } from "./draftUi";

const PAUSE_MS = 700;
const TICK_MS = 400;
const MIN_CHARS = 2;
const MAX_CHARS = 4000;
const SETTINGS_RETRY_MS = 20_000;
const MAX_SETTINGS_RETRIES = 5;
const KNOWN_LANGS = new Set(LANGUAGES.map((l) => l.code));

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export class OutgoingTranslator {
  private enabled = false;
  private dead = false;
  private isChat = false;
  private conversationId: string | null = null;

  private input: HTMLElement | null = null;
  private strip: DraftStrip | null = null;
  private lastDraft = "";
  private lastState: StripState | null = null;
/** True while WE are writing into the message box, so our own input event is not treated as typing. */
  private writing = false;

  private timer: number | undefined;
  private tickTimer: number | undefined;
  private settingsTimer: number | undefined;
  private settingsRetries = 0;

  /** The one request whose answer we still want. */
  private requestId: string | null = null;
  /** The latest translation, for Apply and Copy. */
  private result: string | null = null;
  /** What the box held before Apply, for Undo. */
  private original: string | null = null;
  /** What we put in the box; if the user edits it, Undo is no longer safe. */
  private applied: string | null = null;

  /** Language the user picked for each chat (kept in memory only). */
  private overrides = new Map<string, string>();

  constructor(
    private adapter: PlatformAdapter,
    private detectedClientLanguage: () => string | null
  ) {}

  init(): void {
    void this.loadSettings();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[REPLY_KEY] || changes[TOKEN_KEY] || changes[PREFS_TS_KEY]) {
        this.settingsRetries = 0;
        void this.loadSettings();
      }
    });
    document.addEventListener("input", () => this.check(), true);
    this.tickTimer = window.setInterval(() => this.check(), TICK_MS);
  }

  onSnapshot(s: Snapshot): void {
    this.isChat = s.isChat;
    if (s.conversationId !== this.conversationId) {
      this.conversationId = s.conversationId;
      this.clearAll();
    }
    this.check();
  }

  // ---------- settings ----------
  private async loadSettings(): Promise<void> {
    if (this.dead) return;
    window.clearTimeout(this.settingsTimer);

    let on = false;
    try {
      const stored = await chrome.storage.local.get(REPLY_KEY);
      if (stored[REPLY_KEY] === true) {
        const me = await send({ type: "GET_ME" });
        on = Boolean(me?.preferences.onboardingDone);
      }
    } catch (err) {
      if (err instanceof ExtError && err.code === "EXTENSION_ERROR") {
        this.shutdown();
        return;
      }
      if (this.settingsRetries++ < MAX_SETTINGS_RETRIES) {
        this.settingsTimer = window.setTimeout(() => void this.loadSettings(), SETTINGS_RETRY_MS);
      }
    }

    this.enabled = on;
    if (!on) this.clearAll();
    else this.check();
  }

  /** The extension was reloaded or removed while this page stayed open. */
  shutdown(): void {
    this.dead = true;
    this.enabled = false;
    this.clearAll();
    window.clearInterval(this.tickTimer);
    window.clearTimeout(this.settingsTimer);
  }

  // ---------- watching the message box ----------
  private findInput(): HTMLElement | null {
    if (this.input && this.input.isConnected) return this.input;
    this.input = this.adapter.getInputElement();
    return this.input;
  }

  private check(): void {
    if (this.dead) return;
    if (this.writing) return;
    if (!this.enabled || !this.isChat) {
      this.clearAll();
      return;
    }

    const el = this.findInput();
    if (!el) {
      this.clearAll();
      return;
    }

    const draft = readDraft(el);
    if (draft === this.lastDraft) {
      // Fiverr may have re-created the area around the box: put our strip back.
      if (this.strip && !this.strip.host.isConnected) this.adapter.mountDraftUI(this.strip.host);
      return;
    }
    this.lastDraft = draft;
    this.onDraftChanged(draft);
  }

  private onDraftChanged(draft: string): void {
    this.cancelPending();

    // The user edited the text after Apply: Undo would erase their edit, so it goes away.
    if (this.applied !== null && draft !== this.applied) {
      this.applied = null;
      this.original = null;
    }

    const text = draft.trim();
    if (text.length < MIN_CHARS) {
      this.result = null;
      this.destroyStrip();
      return;
    }
    if (text.length > MAX_CHARS) {
      this.result = null;
      this.show({ kind: "note", message: `This reply is too long to translate (limit ${MAX_CHARS} characters).` });
      return;
    }

    if (this.strip) this.show({ kind: "waiting" });
    this.timer = window.setTimeout(() => void this.translate(text), PAUSE_MS);
  }

  // ---------- translating ----------
  private langInfo(): LangInfo {
    const chosen = this.overrides.get(this.conversationId ?? "");
    if (chosen) return { code: chosen, source: "chosen" };
    const detected = this.detectedClientLanguage();
    if (detected && KNOWN_LANGS.has(detected)) return { code: detected, source: "detected" };
    return { code: "en", source: "default" };
  }

  private async translate(text: string): Promise<void> {
    const requestId = crypto.randomUUID();
    this.requestId = requestId;
    const lang = this.langInfo();
    this.result = null;
    this.show({ kind: "loading" });

    try {
      const r = await send({
        type: "TRANSLATE_OUTGOING",
        text,
        targetLanguage: lang.code,
        requestId,
      });
      if (this.requestId !== requestId) return; // the user typed something newer
      this.requestId = null;
      this.result = r.translation;

      if (norm(r.translation) === norm(text)) {
        this.show({
          kind: "note",
          message: `Your message is already in ${getLanguageName(lang.code)}. No changes needed.`,
        });
        return;
      }

      const from = r.sourceLang && r.sourceLang !== "und" ? `${getLanguageName(r.sourceLang)} → ` : "";
      this.show({
        kind: "done",
        text: r.translation,
        label: `${from}${getLanguageName(lang.code)} · preview, you send it yourself`,
        status: r.cached ? "from memory" : undefined,
      });
    } catch (err) {
      if (this.requestId !== requestId) return;
      this.requestId = null;

      const code = err instanceof ExtError ? err.code : "UNKNOWN";
      if (code === "CANCELLED") return;
      if (code === "EXTENSION_ERROR") {
        this.shutdown();
        return;
      }
      if (code === "UNAUTHORIZED" || code === "SESSION_EXPIRED") {
        this.enabled = false;
        this.clearAll();
        return;
      }
      this.show({
        kind: "error",
        message: err instanceof ExtError ? err.message : "Translation failed. Please try again.",
        canRetry: code !== "DAILY_LIMIT",
      });
    }
  }

  private cancelPending(): void {
    window.clearTimeout(this.timer);
    if (this.requestId) {
      // Stop the request (and the AI call behind it). Its answer would be ignored anyway.
      send({ type: "CANCEL", requestId: this.requestId }).catch(() => undefined);
      this.requestId = null;
    }
  }

  // ---------- the strip ----------
  private show(state: StripState): void {
    this.lastState = state;
    if (!this.strip) {
      this.strip = createStrip({
        onApply: () => this.applyResult(),
        onCopy: () => void this.copyResult(),
        onUndo: () => this.undo(),
        onRetry: () => this.retry(),
        onLanguage: (code) => this.changeLanguage(code),
      });
      this.adapter.mountDraftUI(this.strip.host);
    } else if (!this.strip.host.isConnected) {
      this.adapter.mountDraftUI(this.strip.host);
    }
    this.strip.update(state, this.langInfo());
  }

  private destroyStrip(): void {
    this.strip?.destroy();
    this.strip = null;
    this.lastState = null;
  }

  private clearAll(): void {
    this.cancelPending();
    this.destroyStrip();
    this.result = null;
    this.original = null;
    this.applied = null;
    this.lastDraft = "";
    this.input = null;
  }

    /**
   * Writes text sent by the side panel into the message box. It never presses Send.
   * With `expect` (used by Undo) nothing is written unless the box still holds exactly that text.
   */
  writeFromPanel(
    text: string,
    expect?: string
  ): { ok: boolean; before: string; reason?: "NO_INPUT" | "CHANGED" | "FAILED" } {
    const el = this.findInput();
    if (!el) return { ok: false, before: "", reason: "NO_INPUT" };

    const before = readDraft(el);
    if (expect !== undefined && norm(before) !== norm(expect)) {
      return { ok: false, before, reason: "CHANGED" };
    }

    this.cancelPending();
    this.writing = true; // our own input event must not be treated as the user typing
    let ok = false;
    try {
      ok = this.adapter.setDraftText(text);
      if (!ok) this.adapter.setDraftText(before); // put the user's own text back
    } finally {
      this.writing = false;
    }

    this.destroyStrip();
    this.result = null;
    this.original = null;
    this.applied = null;
    this.lastDraft = readDraft(el);

    return ok ? { ok: true, before } : { ok: false, before, reason: "FAILED" };
  }

  // ---------- buttons ----------
    private applyResult(): void {
    const el = this.findInput();
    const text = this.result;
    if (!el || text === null) return;

    const before = readDraft(el);
    let ok = false;
    this.writing = true;
    try {
      ok = this.adapter.setDraftText(text);
      if (!ok) this.adapter.setDraftText(before); // put the user's own text back
    } finally {
      this.writing = false;
    }
    this.cancelPending(); // drop anything our own input event may have scheduled

    if (!ok) {
      this.show({ kind: "manual", text });
      return;
    }

    this.original = before; // for Undo
    this.applied = readDraft(el);
    this.lastDraft = this.applied; // so the next check does not treat this as typing
    this.show({ kind: "applied" });
  }

    private undo(): void {
    const el = this.findInput();
    if (!el || this.original === null) return;

    const original = this.original;
    this.original = null;
    this.applied = null;

    this.writing = true;
    try {
      this.adapter.setDraftText(original);
    } finally {
      this.writing = false;
    }
    this.cancelPending();

    this.lastDraft = readDraft(el);
    this.onDraftChanged(this.lastDraft);
  }

  private async copyResult(): Promise<void> {
    const text = this.result;
    if (text === null) return;

    let status = "copied";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      status = "copying was blocked: select the text and press Ctrl+C";
    }
    const s = this.lastState;
    if (s && (s.kind === "done" || s.kind === "manual")) this.show({ ...s, status });
  }

  private retry(): void {
    const el = this.findInput();
    const text = el ? readDraft(el).trim() : "";
    if (text.length >= MIN_CHARS && text.length <= MAX_CHARS) void this.translate(text);
  }

  private changeLanguage(code: string): void {
    this.overrides.set(this.conversationId ?? "", code);
    const el = this.findInput();
    const text = el ? readDraft(el).trim() : "";
    this.cancelPending();
    if (text.length >= MIN_CHARS && text.length <= MAX_CHARS) void this.translate(text);
    else if (this.lastState) this.show(this.lastState);
  }
}