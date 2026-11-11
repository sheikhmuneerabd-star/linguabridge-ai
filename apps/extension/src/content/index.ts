import { ASSIST_LIMITS } from "@linguabridge/shared";
import type { ChatPayload, TabReply, TabRequest } from "../shared/messages";
import { findAdapter } from "./adapters";
import { ChatWatcher, type Snapshot } from "./core/watcher";
import type { PlatformAdapter } from "./core/types";
import { IncomingTranslator } from "./inline/incoming";
import { OutgoingTranslator } from "./inline/outgoing";

const MAX_APPLY_CHARS = 4000;

function logSnapshot(adapter: PlatformAdapter, s: Snapshot): void {
  if (!s.isChat) {
    console.info(`[LinguaBridge] ${adapter.name}: not a chat page`);
    return;
  }
  const count = (sender: string) => s.messages.filter((m) => m.sender === sender).length;
  // Counts only. Message text is never logged.
  console.info(
    `[LinguaBridge] ${adapter.name} chat: ${s.messages.length} messages ` +
      `(${count("client")} from client, ${count("me")} from you, ${count("unknown")} unknown) · ` +
      `message box: ${s.hasInput ? "found" : "NOT found"}`
  );
}

/**
 * Reads the open chat for "Analyze". This runs only when the side panel asks for it.
 * The newest messages are kept; the limits match what the server accepts.
 */
function collectChat(adapter: PlatformAdapter, incoming: IncomingTranslator): ChatPayload | null {
  if (!adapter.isChatPage()) return null;
  const chatKey = adapter.getConversationId();
  if (!chatKey) return null;

  const all = adapter.getMessages();
  const unknown = all.filter((m) => m.sender === "unknown").length;

  let trimmed = false;
  let items: ChatPayload["messages"] = [];
  for (const m of all) {
    if (m.sender === "unknown") continue;
    let text = m.text.trim();
    if (!text) continue;
    if (text.length > ASSIST_LIMITS.maxTextPerMessage) {
      text = text.slice(0, ASSIST_LIMITS.maxTextPerMessage);
      trimmed = true;
    }
    items.push({ sender: m.sender, text });
  }

  if (items.length > ASSIST_LIMITS.maxMessages) {
    items = items.slice(-ASSIST_LIMITS.maxMessages);
    trimmed = true;
  }
  let total = items.reduce((n, m) => n + m.text.length, 0);
  while (total > ASSIST_LIMITS.maxTotalChars && items.length > 1) {
    total -= items[0].text.length;
    items = items.slice(1);
    trimmed = true;
  }

  return { chatKey, messages: items, clientLanguage: incoming.clientLanguage(), unknown, trimmed };
}

const adapter = findAdapter(new URL(location.href));

if (adapter) {
  // All three features stay off until the user turns them on in the popup.
  const incoming = new IncomingTranslator(adapter);
  incoming.init();

  const outgoing = new OutgoingTranslator(adapter, () => incoming.clientLanguage());
  outgoing.init();

  new ChatWatcher(
    adapter,
    (snapshot) => {
      logSnapshot(adapter, snapshot);
      incoming.onSnapshot(snapshot);
      outgoing.onSnapshot(snapshot);
    },
    // The extension was reloaded while this tab stayed open: remove our boxes and stop quietly.
    () => {
      incoming.shutdown();
      outgoing.shutdown();
    }
  ).start();

  chrome.runtime.onMessage.addListener((message: TabRequest, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;

    if (message?.type === "DIAGNOSE") {
      try {
        sendResponse({ ok: true, kind: "report", report: adapter.diagnose() } satisfies TabReply);
      } catch {
        sendResponse({ ok: false, code: "FAILED" } satisfies TabReply);
      }
      return false;
    }

    if (message?.type === "GET_CHAT") {
      try {
        const chat = collectChat(adapter, incoming);
        sendResponse(
          chat
            ? ({ ok: true, kind: "chat", chat } satisfies TabReply)
            : ({ ok: false, code: "NO_CHAT" } satisfies TabReply)
        );
      } catch {
        sendResponse({ ok: false, code: "FAILED" } satisfies TabReply);
      }
      return false;
    }

    if (message?.type === "APPLY_DRAFT") {
      const text = message.text;
      const valid =
        typeof text === "string" &&
        text.length <= MAX_APPLY_CHARS &&
        (message.undo === true || text.trim().length > 0);
      if (!valid) {
        sendResponse({ ok: false, code: "FAILED" } satisfies TabReply);
        return false;
      }
      // The text was made for one chat. If another chat is open now, do nothing.
      if (!adapter.isChatPage() || message.chatKey !== adapter.getConversationId()) {
        sendResponse({ ok: false, code: "CHAT_CHANGED" } satisfies TabReply);
        return false;
      }

      // This only fills the message box. Nothing is ever sent from here.
      const result = outgoing.writeFromPanel(text, message.undo ? message.expect : undefined);
      sendResponse(
        result.ok
          ? ({ ok: true, kind: "applied", before: result.before } satisfies TabReply)
          : ({ ok: false, code: result.reason ?? "FAILED" } satisfies TabReply)
      );
      return false;
    }

    return false;
  });
}

export {};