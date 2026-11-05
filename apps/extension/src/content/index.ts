import type { TabReply, TabRequest } from "../shared/messages";
import { findAdapter } from "./adapters";
import { ChatWatcher, type Snapshot } from "./core/watcher";
import type { PlatformAdapter } from "./core/types";

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

const adapter = findAdapter(new URL(location.href));

if (adapter) {
  // Read-only for now: this step does not change anything on the page.
  new ChatWatcher(adapter, (snapshot) => logSnapshot(adapter, snapshot)).start();

  chrome.runtime.onMessage.addListener((message: TabRequest, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;

    if (message?.type === "DIAGNOSE") {
      try {
        sendResponse({ ok: true, report: adapter.diagnose() } satisfies TabReply);
      } catch {
        sendResponse({ ok: false } satisfies TabReply);
      }
    }
    return false;
  });
}

export {};