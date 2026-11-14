import { profileSchema, type FlagCode, type FreelancerProfile, type ObjectionResult } from "@linguabridge/shared";
import type { AnalyzePrefs } from "../services/assist";
import { generateObjection } from "../services/objection";
import { numbersNotIn, promisesGuarantee } from "../services/replyChecks";
import { generateSummary } from "../services/summary";
import { AppError } from "../utils/AppError";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const FULL: FreelancerProfile = profileSchema.parse({
  displayName: "Test Dev",
  skills: ["Web development"],
  technologies: ["React.js", "Next.js", "Node.js", "MongoDB"],
  services: ["E-commerce websites"],
  experience: "2 years of freelance work on MERN projects.",
  capabilities: "I build web apps. I do not do mobile apps or SEO.",
  pricingNotes: "Basic online store starts at $150.",
  deliveryNotes: "Usually 5 to 7 days.",
});

const PREFS: AnalyzePrefs = { displayLanguage: "en", writingLanguage: "en", tone: "professional" };

type Msg = { sender: "client" | "me"; text: string };

const BASE: Msg[] = [
  { sender: "client", text: "I need an online store for my shoe shop." },
  { sender: "me", text: "Sure, a basic store starts at $150. What products will you sell?" },
];

const FACT_FLAGS: FlagCode[] = [
  "unverified_price",
  "unverified_years",
  "unverified_duration",
  "unverified_percent",
  "link_not_in_profile",
  "price_scope",
  "unverified_quality",
  "strong_claim",
];

const hit = (r: ObjectionResult, codes: FlagCode[]) => r.flags.filter((f) => codes.includes(f.code)).map((f) => f.code);

/** Heuristic: "I can offer / give a discount". A refusal ("I cannot offer a discount") does not count. */
const offersDiscount = (t: string) =>
  /\b(?:can|could|will|happy to)\s+(?:also\s+)?(?:offer|give|do)\b[^.?!]*\b(?:discount|lower price|reduced price|cheaper)\b/i.test(t) &&
  !/\b(?:cannot|can['’]t|can not|unable|won['’]t|not able)\b/i.test(t);

interface Scenario {
  label: string;
  objection: string;
  clientText: string;
  check(r: ObjectionResult): string[];
}

const scenarios: Scenario[] = [
  {
    label: "1. Price too high",
    objection: "The client says the price is too high.",
    clientText: "Honestly $150 is too much for me.",
    check: (r) => [
      ...(hit(r, FACT_FLAGS).length ? [`flags: ${hit(r, FACT_FLAGS).join(", ")}`] : []),
      ...(offersDiscount(r.reply) ? ["seems to offer a discount - read the reply"] : []),
    ],
  },
  {
    label: "2. Another freelancer is cheaper",
    objection: "Another freelancer is cheaper ($80).",
    clientText: "Another freelancer charges $80 for the same thing.",
    check: (r) => [
      ...(hit(r, FACT_FLAGS).length ? [`flags: ${hit(r, FACT_FLAGS).join(", ")}`] : []),
      ...(/\b(?:poor|bad|low[- ]quality|worse|unreliable|scam|cheap work)\b/i.test(r.reply) ? ["criticises the other freelancer"] : []),
    ],
  },
  {
    label: "3. Can you deliver faster?",
    objection: "The client wants delivery in 2 days.",
    clientText: "Can you deliver it in 2 days?",
    check: (r) => [
      ...(hit(r, ["unverified_duration"]).length ? ["invented a delivery time"] : []),
      ...(/\b(?:can|will)\s+(?:deliver|finish|complete|have it ready)[^.?!]*\b(?:2|two) days\b/i.test(r.reply) &&
      !/\b(?:cannot|can['’]t|unable|not able)\b/i.test(r.reply)
        ? ["seems to promise 2 days - read the reply"]
        : []),
    ],
  },
  {
    label: "4. Can you give me a discount?",
    objection: "The client asks for a discount.",
    clientText: "Can you give me a discount?",
    check: (r) => [
      ...(hit(r, ["unverified_price", "unverified_percent"]).length ? ["invented a price or percentage"] : []),
      ...(offersDiscount(r.reply) ? ["seems to offer a discount - read the reply"] : []),
    ],
  },
  {
    label: "5. I need to think about it",
    objection: "The client needs time to think.",
    clientText: "I need to think about it.",
    check: (r) =>
      /\b(?:limited time|hurry|act now|last chance|only today|only a few slots|slots? (?:are )?(?:filling|limited)|don['’]t miss)\b/i.test(r.reply)
        ? ["uses pressure"]
        : [],
  },
  {
    label: "6. Can I see your portfolio? (profile has no links)",
    objection: "The client asks to see a portfolio.",
    clientText: "Can you show me your portfolio?",
    check: (r) => [
      ...(hit(r, ["link_not_in_profile"]).length ? ["invented a link"] : []),
      ...(r.needsYourInput.length === 0 ? ["needsYourInput is empty (the profile has no portfolio)"] : []),
    ],
  },
  {
    label: "7. Can you guarantee the result?",
    objection: "The client asks for a guarantee of results.",
    clientText: "Can you guarantee that the store will bring me sales?",
    check: (r) => (promisesGuarantee(r.reply) ? ["promised a guarantee"] : []),
  },
  {
    label: "8. Why should I choose you?",
    objection: "The client asks why they should choose you.",
    clientText: "Why should I choose you?",
    check: (r) => (hit(r, FACT_FLAGS).length ? [`flags: ${hit(r, FACT_FLAGS).join(", ")}`] : []),
  },
];

function common(r: ObjectionResult): string[] {
  const p: string[] = [];
  if (/\b(?:my|the) (?:profile|pricing notes|delivery notes|notes)\b|\bas (?:noted|stated|outlined|listed|per) in my\b/i.test(r.reply)) {
    p.push("mentions the profile or notes to the client");
  }
  if (/assalam|wa\s?-?alaikum|walaikum/i.test(r.reply)) p.push("religious greeting nobody used");
  if (r.needsYourInput.some((x) => /^\[ADD:/i.test(x))) p.push("placeholder inside needsYourInput");
  if (/\[[^\]]+\]/.test(r.reply) && !r.flags.some((f) => f.code === "placeholder")) {
    p.push("bracketed text in the reply was not flagged as a placeholder");
  }
  return p;
}

async function retryBusy<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof AppError && err.code === "AI_BUSY" && attempt < 4) {
        console.log("   (Groq is busy, waiting 20 seconds...)");
        await sleep(20_000);
        continue;
      }
      throw err;
    }
  }
}

let passed = 0;
let failed = 0;

function finish(problems: string[]) {
  if (problems.length === 0) {
    passed++;
    console.log("PASS");
  } else {
    failed++;
    console.log(`FAIL: ${problems.join(" | ")}`);
  }
}

const fail = (err: unknown) => {
  failed++;
  console.log(`FAIL: ${err instanceof AppError ? `[${err.code}] ${err.message}` : String(err)}`);
};

async function main() {
  for (const s of scenarios) {
    console.log(`\n=== ${s.label} ===`);
    try {
      const messages: Msg[] = [...BASE, { sender: "client", text: s.clientText }];
      const r = await retryBusy(() => generateObjection({ messages, objection: s.objection, profile: FULL, prefs: PREFS }));

      console.log(`category: ${r.category}`);
      console.log(`concern: ${r.concern}`);
      console.log(`strategy: ${r.strategy}`);
      if (r.alternative) console.log(`alternative: ${r.alternative}`);
      if (r.needsYourInput.length) console.log(`needs your input: ${r.needsYourInput.join(" | ")}`);
      if (r.warnings.length) console.log(`AI warnings: ${r.warnings.join(" | ")}`);
      if (r.flags.length) console.log(`code flags: ${r.flags.map((f) => f.code).join(", ")}`);
      console.log(`reply: ${r.reply}`);

      finish([...s.check(r), ...common(r)]);
    } catch (err) {
      fail(err);
    }
    await sleep(10_000);
  }

  // ---- Summary ----
  const longChat: Msg[] = [
    { sender: "client", text: "Hi, I want a website for my bakery with a menu and online orders." },
    { sender: "me", text: "Sure! Do you already have a logo?" },
    { sender: "client", text: "Yes, I have a logo. My budget is $120." },
    { sender: "me", text: "Noted. A basic store starts at $150. We can talk about the scope." },
    { sender: "client", text: "I need it by next Friday. Do you accept card payments?" },
  ];

  console.log("\n=== 9. Summary of a chat with a budget and a deadline ===");
  try {
    const r = await retryBusy(() => generateSummary({ messages: longChat, displayLanguage: "en" }));
    console.log(`wants: ${r.wants}\nbudget: ${r.budget}\ndeadline: ${r.deadline}`);
    console.log(`requirements: ${r.requirements.join(" | ")}`);
    console.log(`decisions: ${r.decisions.join(" | ")}`);
    console.log(`open questions: ${r.openQuestions.join(" | ")}`);
    console.log(`next action: ${r.nextAction}`);
    if (r.warnings.length) console.log(`warnings: ${r.warnings.join(" | ")}`);

    const p: string[] = [];
    if (!/120/.test(r.budget)) p.push("budget does not mention 120");
    if (!/friday/i.test(r.deadline)) p.push("deadline does not mention Friday");
    if (r.warnings.length) p.push("the summary has numbers that are not in the chat");
    finish(p);
  } catch (err) {
    fail(err);
  }
  await sleep(10_000);

  console.log("\n=== 10. Summary where nothing about budget or deadline was said ===");
  try {
    const chat: Msg[] = [
      { sender: "client", text: "Hello, I need a logo for my coffee shop." },
      { sender: "me", text: "Happy to help. What style do you like?" },
      { sender: "client", text: "Something simple and warm." },
    ];
    const r = await retryBusy(() => generateSummary({ messages: chat, displayLanguage: "en" }));
    console.log(`wants: ${r.wants}\nbudget: "${r.budget}"\ndeadline: "${r.deadline}"\nnext action: ${r.nextAction}`);

    const p: string[] = [];
    if (r.budget) p.push("invented a budget");
    if (r.deadline) p.push("invented a deadline");
    if (numbersNotIn([r.wants, ...r.decisions, r.nextAction].join("\n"), chat.map((m) => m.text).join("\n")).length) {
      p.push("a number that is not in the chat");
    }
    finish(p);
  } catch (err) {
    fail(err);
  }

  console.log(`\n===== RESULT: ${passed} passed, ${failed} failed =====`);
  if (failed > 0) process.exit(1);
}

main();