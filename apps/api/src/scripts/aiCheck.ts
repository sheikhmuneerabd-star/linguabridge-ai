import { getAIProvider } from "../ai";
import { AppError } from "../utils/AppError";

async function main() {
  const ai = getAIProvider();
  const sample = "Hello, I need a professional website for my clothing brand.";

  console.log("--- 1) Fast model: simple translation ---");
  const a = await ai.complete({
    tier: "fast",
    messages: [
      { role: "system", content: "You are a translator. Reply with the translation only." },
      { role: "user", content: `Translate into Roman Urdu (Urdu written in Latin letters):\n${sample}` },
    ],
  });
  console.log("Model:", a.model);
  console.log("Reply:", a.text);
  console.log("Tokens:", a.usage);

  console.log("\n--- 2) Fast model: JSON mode ---");
  const b = await ai.complete({
    tier: "fast",
    json: true,
    messages: [
      {
        role: "system",
        content: 'Reply with a JSON object only: {"detectedLang": "<ISO code>", "translation": "<text>"}',
      },
      { role: "user", content: `Detect the language and translate into English:\nMujhe apne brand ke liye website chahiye.` },
    ],
  });
  console.log("Reply:", b.text);
  console.log("Valid JSON?", (() => { try { JSON.parse(b.text); return "yes"; } catch { return "NO"; } })());

  console.log("\n--- 3) Smart model ---");
  const c = await ai.complete({
    tier: "smart",
    messages: [{ role: "user", content: "Say hello in one short sentence." }],
  });
  console.log("Model:", c.model);
  console.log("Reply:", c.text);
}

main()
  .then(() => console.log("\nAll checks passed."))
  .catch((err) => {
    if (err instanceof AppError) console.error(`\nFailed: [${err.code}] ${err.message}`);
    else console.error("\nFailed:", err);
    process.exit(1);
  });