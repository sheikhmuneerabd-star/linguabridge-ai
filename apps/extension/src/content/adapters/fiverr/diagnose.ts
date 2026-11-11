import type { PlatformAdapter } from "../../core/types";
import { describe, findTimestampLeaves, ownText } from "./dom";
import { classifyStamp } from "./stamps";

function outline(el: Element, depth: number, lines: string[], budget: { left: number }): void {
  if (budget.left <= 0) return;
  budget.left--;
  const own = ownText(el).length;
  lines.push(`${"  ".repeat(depth)}${describe(el)}${own ? ` (text: ${own} chars)` : ""}`);
  if (depth >= 6) return;
  for (const child of Array.from(el.children).slice(0, 6)) outline(child, depth + 1, lines, budget);
}

function chain(el: Element | null, levels: number): string[] {
  const out: string[] = [];
  let cur = el;
  for (let i = 0; i < levels && cur; i++) {
    const siblings = cur.parentElement?.children.length ?? 0;
    out.push(`  ${i}: ${describe(cur)}  (siblings: ${siblings}, children: ${cur.childElementCount})`);
    cur = cur.parentElement;
  }
  return out;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function diagnoseFiverr(adapter: PlatformAdapter): string {
  const id = adapter.getConversationId() ?? "";
  const lines: string[] = [];

  lines.push("LinguaBridge diagnostic (no message text; time labels are included)");
  lines.push(`page: ${location.pathname}`);
  lines.push(`window size: ${innerWidth} x ${innerHeight}`);
  lines.push(`chat page: ${adapter.isChatPage()}`);

  const input = adapter.getInputElement();
  const inputRect = input?.getBoundingClientRect();
  lines.push("", `message box: ${input ? describe(input) : "NOT FOUND"}`);
  if (input) lines.push(`draft length: ${adapter.getDraftText().length} chars`);

  const all = findTimestampLeaves(document.body);
  const okCount = all.filter((s) => classifyStamp(s, inputRect) === "ok").length;
  lines.push("", `time-label elements on the page: ${all.length} (counted as messages: ${okCount})`);
    // Show the first 2, the last 3, and every label that was NOT counted (with the reason).
  const notOk = all.filter((s) => classifyStamp(s, inputRect) !== "ok");
  const shown = new Set([...all.slice(0, 2), ...all.slice(-3), ...notOk]);
  all.forEach((s, i) => {
    if (!shown.has(s)) return;
    const r = s.getBoundingClientRect();
    lines.push(
      `  #${i + 1} "${(s.textContent ?? "").trim()}" -> ${classifyStamp(s, inputRect)} (top ${Math.round(r.top)}, size ${Math.round(r.width)}x${Math.round(r.height)})`
    );
  });

    const scanStart = performance.now();
  const messages = adapter.getMessages();
  const scanMs = Math.round(performance.now() - scanStart);
  const count = (s: string) => messages.filter((m) => m.sender === s).length;
  lines.push(
    "",
    `parsed messages: ${messages.length} (client ${count("client")}, me ${count("me")}, unknown ${count("unknown")})`
  );
  lines.push(`scan time: ${scanMs} ms (the page has ${document.getElementsByTagName("*").length} elements)`);
  if (messages[0]) lines.push(`message block element: ${describe(messages[0].element)}`);

  // Compact list: sender and size of every message (so we can see grouping patterns).
  messages.slice(0, 30).forEach((m, i) => {
    lines.push(`  #${i + 1} ${m.sender.padEnd(7)} ${String(m.text.length).padStart(4)} chars  "${m.timeLabel}"`);
  });

  const samples: [string, (typeof messages)[number] | undefined][] = [
    ["client", messages.find((m) => m.sender === "client")],
    ["me", messages.find((m) => m.sender === "me")],
    ["unknown", messages.find((m) => m.sender === "unknown")],
  ];
  for (const [label, m] of samples) {
    if (!m) continue;
    lines.push("", `structure of one "${label}" message:`);
    outline(m.element, 0, lines, { left: 60 });
  }

  let report = lines.join("\n");
  if (id) report = report.replace(new RegExp(escapeRegExp(id), "gi"), ":id");
  return report;
}