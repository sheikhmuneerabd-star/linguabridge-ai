import { translateIncoming, translateOutgoing } from "../services/translation";
import { AppError } from "../utils/AppError";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const longChat = Array.from(
  { length: 12 },
  (_, i) => `Point ${i + 1}: I need the homepage to load fast and the checkout to work on mobile.`
).join("\n");

interface InCase {
  label: string;
  text: string;
  target: string;
  expectLang: string[];
  mustKeep?: string[];
  minLines?: number;
}

const incoming: InCase[] = [
  { label: "Arabic", text: "مرحبا، أحتاج إلى تصميم شعار لمطعمي. كم التكلفة؟", target: "ur-Latn", expectLang: ["ar"] },
  { label: "Turkish", text: "Merhaba, e-ticaret sitesi için teklif alabilir miyim?", target: "ur-Latn", expectLang: ["tr"] },
  { label: "Chinese", text: "你好，我需要一个手机应用程序，预算是500美元。", target: "ur-Latn", expectLang: ["zh"], mustKeep: ["500"] },
  { label: "Japanese", text: "こんにちは、ロゴを作成していただけますか？", target: "ur-Latn", expectLang: ["ja"] },
  { label: "Korean", text: "안녕하세요, 웹사이트 제작 기간이 얼마나 걸리나요?", target: "ur-Latn", expectLang: ["ko"] },
  { label: "Hindi (Devanagari)", text: "नमस्ते, मुझे अपनी दुकान के लिए वेबसाइट चाहिए।", target: "ur-Latn", expectLang: ["hi"] },
  { label: "Russian", text: "Здравствуйте, сколько стоит разработка сайта?", target: "ur-Latn", expectLang: ["ru"] },
  { label: "Italian", text: "Ciao, vorrei un sito web per il mio negozio di scarpe.", target: "ur-Latn", expectLang: ["it"] },
  { label: "Portuguese", text: "Olá, preciso de um logotipo para a minha empresa.", target: "ur-Latn", expectLang: ["pt"] },
  { label: "Dutch", text: "Hallo, kunt u mijn website voor volgende week afmaken?", target: "ur-Latn", expectLang: ["nl"] },
  { label: "Mixed Roman Urdu + English", text: "Hi bro, mujhe logo chahiye urgent, budget 50 dollar hai.", target: "ur-Latn", expectLang: ["ur-Latn", "en"], mustKeep: ["50"] },
  { label: "Very short (Thanks!)", text: "Thanks!", target: "ur-Latn", expectLang: ["en"] },
  {
    label: "Price + link + date kept",
    text: "My budget is $250. Please see https://example.com/brief before you start. Deadline: 15 Dec.",
    target: "ur-Latn",
    expectLang: ["en"],
    mustKeep: ["$250", "https://example.com/brief", "15"],
  },
  { label: "Long multi-line chat (12 lines)", text: longChat, target: "ur-Latn", expectLang: ["en"], mustKeep: ["12"], minLines: 10 },
  {
    label: "Roman Urdu -> English (detection)",
    text: "Bhai, mujhe apni dukaan ke liye website chahiye, kitna kharcha aayega?",
    target: "en",
    expectLang: ["ur-Latn"],
  },
  { label: "Urdu script -> English", text: "مجھے اپنی دکان کے لیے لوگو چاہیے", target: "en", expectLang: ["ur"] },
];

interface OutCase {
  label: string;
  text: string;
  target: string;
  mustKeep?: string[];
  keepAny?: string[];
  forbid: RegExp;
}

const outgoing: OutCase[] = [
  { label: "No invented claims (EN)", text: "Ji bilkul, main aap ki madad kar sakta hoon.", target: "en", forbid: /guarantee|100\s?%|years|expert|best/i },
  { label: "Number kept + no guarantee (FR)", text: "Main 2 din mein pehla design bhej dunga.", target: "fr", keepAny: ["2", "deux"], forbid: /garanti|100\s?%|\b\d+\s+ans\b/i },
  { label: "Price kept (DE)", text: "Mera price 50 dollar hai.", target: "de", mustKeep: ["50"], forbid: /garantie|erfahrung|jahre/i },
];

let passed = 0;
let failed = 0;

function report(label: string, problems: string[], details: string) {
  if (problems.length === 0) {
    passed++;
    console.log(`PASS  ${label}\n      ${details}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}\n      ${problems.join(" | ")}\n      ${details}`);
  }
}

/** If Groq says "busy", wait and try once more. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError && err.code === "AI_BUSY") {
      console.log("      (Groq is busy, waiting 15 seconds...)");
      await sleep(15_000);
      return fn();
    }
    throw err;
  }
}

async function main() {
  console.log("===== INCOMING =====\n");
  for (const c of incoming) {
    try {
      const r = await withRetry(() => translateIncoming({ text: c.text, targetLanguage: c.target }));
      const problems: string[] = [];

      if (!c.expectLang.includes(r.detectedLang)) {
        problems.push(`language: got "${r.detectedLang}", expected ${c.expectLang.join(" or ")}`);
      }
      if (r.needsTranslation && r.translation.trim() === c.text.trim()) {
        problems.push("returned the original text without translating");
      }
      // Clients who did not write in Urdu must not get an Islamic greeting added.
      if (!["ur", "ur-Latn"].includes(c.expectLang[0]) && /salam|alaikum/i.test(r.translation)) {
        problems.push("added an Islamic greeting the client did not write");
      }
      for (const k of c.mustKeep ?? []) {
        if (!r.translation.includes(k)) problems.push(`lost "${k}"`);
      }
      if (c.minLines && r.translation.split("\n").length < c.minLines) {
        problems.push(`line breaks lost (${r.translation.split("\n").length} lines)`);
      }

      const preview = r.translation.replace(/\n/g, " / ").slice(0, 110);
      report(c.label, problems, `[${r.detectedLang}] ${preview}`);
    } catch (err) {
      failed++;
      const msg = err instanceof AppError ? `[${err.code}] ${err.message}` : String(err);
      console.log(`FAIL  ${c.label}\n      ${msg}`);
    }
    await sleep(1200);
  }

  console.log("\n===== OUTGOING =====\n");
  for (const c of outgoing) {
    try {
      const r = await withRetry(() =>
        translateOutgoing({ text: c.text, targetLanguage: c.target, sourceHint: "ur-Latn", tone: "professional" })
      );
      const problems: string[] = [];

      for (const k of c.mustKeep ?? []) {
        if (!r.translation.includes(k)) problems.push(`lost "${k}"`);
      }
      if (c.keepAny && !c.keepAny.some((k) => r.translation.toLowerCase().includes(k))) {
        problems.push(`lost the number (expected one of: ${c.keepAny.join(", ")})`);
      }
      if (c.forbid.test(r.translation)) problems.push("added a claim that was not in the draft");

      report(c.label, problems, `[${r.sourceLang} -> ${c.target}] ${r.translation}`);
    } catch (err) {
      failed++;
      const msg = err instanceof AppError ? `[${err.code}] ${err.message}` : String(err);
      console.log(`FAIL  ${c.label}\n      ${msg}`);
    }
    await sleep(1200);
  }

  console.log(`\n===== RESULT: ${passed} passed, ${failed} failed =====`);
  if (failed > 0) process.exit(1);
}

main();