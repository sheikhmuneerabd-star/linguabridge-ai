export type Sender = "client" | "me" | "unknown";

export interface ChatMessage {
  /** Stable id: the same message gets the same id on every scan. */
  id: string;
  sender: Sender;
  text: string;
  /** The time label shown next to the message, e.g. "Nov 04, 12:43 AM". */
  timeLabel: string;
  /** The whole message block on the page. We never modify it. */
  element: HTMLElement;
}

/** Everything platform-specific lives behind this interface. */
export interface PlatformAdapter {
  readonly name: string;
  matchesUrl(url: URL): boolean;
  isChatPage(): boolean;
  getConversationId(): string | null;
  getMessages(): ChatMessage[];
  getInputElement(): HTMLElement | null;
  getDraftText(): string;
  /** The part of the page to watch for changes. */
  getObserveRoot(): HTMLElement;
  /**
   * Puts our own box next to a message. Safe to call again and again:
   * it does nothing if the box is already in the right place.
   */
  mountInlineUI(message: ChatMessage, host: HTMLElement): void;
  /**
   * Replaces the text in the message box. It never sends anything.
   * Returns true if the box now holds the text.
   */
  setDraftText(text: string): boolean;
  /** Puts our reply strip just above the message box. Safe to call again. */
  mountDraftUI(host: HTMLElement): void;
  /** A text report about the page structure (never includes message text). */
  diagnose(): string;
}