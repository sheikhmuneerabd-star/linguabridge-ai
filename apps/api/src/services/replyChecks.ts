import type { FlagCode, FreelancerProfile, ReplyFlag } from "@linguabridge/shared";

// Numbers: thousands commas are removed first ("1,500" becomes "1500").
const NUMBER = /\d+(?:\.\d+)?/g;
const MONEY =
  /(?:[$€£]|\b(?:usd|pkr|rs\.?)\s?)\s?(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s?(?:dollars?|usd|rupees?|pkr|euros?)\b/gi;
const YEARS = /(\d+)\+?\s?(?:years?|yrs?|saal|sal)\b/gi;
const DURATION =
  /(\d+)(?:\s?-\s?(\d+))?\s?(?:days?|din|hours?|ghante|weeks?|hafte|hafta|months?|mahine)\b/gi;
const PERCENT = /(\d+(?:\.\d+)?)\s?%/g;
const URL_ANY = /https?:\/\/[^\s)>\]"']+/gi;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
const PLATFORMS = /\b(whatsapp|telegram|skype|discord|paypal|payoneer|western union)\b/i;
const PLACEHOLDER = /\[ADD:[^\]]*\]/i;
// Religious greetings ("Assalam o Alaikum", "Waalaikum salam").
const RELIGIOUS_GREETING = /\b(?:assalam\w*|asalam\w*|salaam|salam|wa-?alaikum|waalaikum|walaikum)\b/i;
const GREETING_IN_CHAT = /salam|alaikum/i;
// Offers of help the profile does not list: referrals, introductions, "I can recommend a specialist".
const UNLISTED_OFFER =
  /\b(?:refer\s+you|referral|connect\s+you|introduce\s+you|recommend\s+(?:you\s+)?(?:a|an|some|trusted|specialists?)|suggest\s+(?:a|an|some)\s+specialist)\b/i;

// "I guarantee ...", "we can guarantee ..." (but not "I cannot guarantee", which is an honest refusal).
const GUARANTEE_ME = /\b(?:i|we)\s+(?:can\s+|will\s+|do\s+|would\s+)?guarantee\b/gi;
// "guaranteed results", "100% guaranteed" (but not "a guaranteed outcome" quoted from the client).
const GUARANTEED_THING =
  /\bguaranteed\s+(?:results?|success|rankings?|sales|satisfaction|refund|delivery|traffic)\b|\b100\s?%\s+guaranteed\b/gi;

// Self-praise words. "best" alone is not flagged ("the best fit", "my best"), only "best developer" and similar.
const STRONG_WORDS =
  /\b(expert|specialist|specializ\w*|specialis\w*|experienced|top[- ]rated|world[- ]class|award[- ]winning|certified|certification|best\s+(?:developer|freelancer|designer|choice|quality|in\s+the))\b/gi;
// Quality and availability claims that need a source (profile or chat).
const QUALITY =
  /\b(reliable|fully[- ]functional|high[- ]quality|top[- ]notch|flawless|perfect\s+(?:fit|match)|expertise|right\s+away|immediately|turant|maahir|mahir)\b/gi;
// Words that say what a price or package contains.
const SCOPE_VERB = /\b(?:includes?|covers?|comes?\s+with|consists?\s+of|shamil)\b/i;
const PRICE_WORD = /\b(?:price|package|rate|cost|quote|qeemat)\b/i;

// A sentence that talks about the freelancer (English and Roman Urdu).
const FIRST_PERSON = /\b(?:i|i['’]m|i['’]ve|my|we|we['’]re|our|main|mera|mere|meri|hum)\b/i;
// Sentences about somebody else ("I can connect you with a trusted SEO expert") are not claims about the freelancer.
const OTHER_PERSON = /\b(?:connect you|recommend|refer|hire|find (?:an?|the)|another|other|trusted)\b/i;

const NEGATION = /\b(?:not|never|no|cannot|can['’]t|cant|won['’]t|unable|don['’]t|doesn['’]t|isn['’]t|aren['’]t|wouldn['’]t)\b|n['’]t\b/i;
const LIMIT_WORDS = /\b(?:outside|beyond|except)\b/i;

const noCommas = (s: string) => s.replace(/(\d),(?=\d{3}\b)/g, "$1");
const norm = (n: string) => String(parseFloat(n));
const normUrl = (u: string) => u.toLowerCase().replace(/[.,;:!?]+$/, "").replace(/\/+$/, "");

function numbersIn(text: string): string[] {
  return (noCommas(text).match(NUMBER) ?? []).map(norm);
}

/** Every number that appears inside a pattern. Only the digits we captured, not the whole match. */
function captured(text: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const m of noCommas(text).matchAll(re)) {
    for (const g of m.slice(1)) if (g !== undefined) out.push(norm(g));
  }
  return out;
}

/** True if a "not / can't / unable ..." comes earlier in the same sentence. */
function negatedBefore(text: string, index: number): boolean {
  const sentence = (text.slice(0, index).split(/[.!?\n]/).pop() ?? "").slice(-60);
  return NEGATION.test(sentence);
}

/** True if the text promises a guarantee. A refusal such as "I cannot guarantee" is not a promise. */
export function promisesGuarantee(text: string): boolean {
  for (const re of [GUARANTEE_ME, GUARANTEED_THING]) {
    for (const m of text.matchAll(re)) {
      if (!negatedBefore(text, m.index ?? 0)) return true;
    }
  }
  return false;
}

function profileAsText(p: FreelancerProfile | null): string {
  if (!p) return "";
  return [
    p.displayName,
    p.intro,
    ...p.skills,
    ...p.technologies,
    ...p.services,
    p.experience,
    p.capabilities,
    ...p.portfolioLinks,
    p.pricingNotes,
    p.deliveryNotes,
  ].join("\n");
}

/**
 * Looks for things in the suggested replies that the freelancer's profile or the chat do not support.
 * This catches common mistakes only. It cannot catch numbers written in words, claims with no number,
 * or claims in wording we did not think of.
 */
export function checkReplies(
  replies: Record<string, string>,
  profile: FreelancerProfile | null,
  chatText: string
): ReplyFlag[] {
  const profileText = profileAsText(profile);
  const known = `${profileText}\n${chatText}`;
  const allowedNumbers = new Set(numbersIn(known));
  const allowedLinks = new Set([...(profile?.portfolioLinks ?? []), ...(known.match(URL_ANY) ?? [])].map(normUrl));
  const profileLower = profileText.toLowerCase();

  const flags = new Map<string, ReplyFlag>();
  const add = (code: FlagCode, detail: string, message: string) => {
    const key = `${code}:${detail}`;
    if (!flags.has(key)) flags.set(key, { code, message });
  };

  for (const text of Object.values(replies)) {
    for (const n of captured(text, MONEY)) {
      if (!allowedNumbers.has(n)) {
        add("unverified_price", n, `A reply mentions an amount (${n}) that is not in your profile or in this chat.`);
      }
    }
    for (const n of captured(text, YEARS)) {
      if (!allowedNumbers.has(n)) {
        add("unverified_years", n, `A reply mentions ${n} years, which is not in your profile or in this chat.`);
      }
    }
    for (const n of captured(text, DURATION)) {
      if (!allowedNumbers.has(n)) {
        add("unverified_duration", n, `A reply mentions a time (${n}) that is not in your profile or in this chat.`);
      }
    }
    for (const n of captured(text, PERCENT)) {
      if (!allowedNumbers.has(n)) {
        add("unverified_percent", n, `A reply mentions ${n}%, which is not in your profile or in this chat.`);
      }
    }

    for (const url of text.match(URL_ANY) ?? []) {
      if (!allowedLinks.has(normUrl(url))) {
        add("link_not_in_profile", normUrl(url), "A reply contains a link that is not in your profile or in this chat.");
      }
    }

    const emailHit = EMAIL.exec(text);
    if (emailHit) add("contact_details", emailHit[0], "A reply contains an email address. Keep the conversation on the platform.");
    for (const m of text.matchAll(PHONE)) {
      if (m[0].replace(/\D/g, "").length >= 9) {
        add("contact_details", m[0], "A reply contains a phone number. Keep the conversation on the platform.");
      }
    }

    const platform = PLATFORMS.exec(text);
    if (platform) {
      add(
        "off_platform",
        platform[1].toLowerCase(),
        `A reply mentions ${platform[1]}. Make sure it keeps the conversation and payment on the platform.`
      );
    }

    if (promisesGuarantee(text)) {
      add("guarantee", "g", "A reply sounds like a guarantee. Do not promise results you cannot control.");
    }

    for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
      // What the price covers: only your profile can say that.
      const scope = SCOPE_VERB.exec(sentence);
      if (scope && (PRICE_WORD.test(sentence) || MONEY.test(sentence))) {
        MONEY.lastIndex = 0;
        if (!profileLower.includes(scope[0].toLowerCase())) {
          add(
            "price_scope",
            scope[0].toLowerCase(),
            "A reply says what the price includes. Your profile does not say this. Check that it is true."
          );
        }
      }
      MONEY.lastIndex = 0;

      if (!FIRST_PERSON.test(sentence) || OTHER_PERSON.test(sentence)) continue;

      for (const m of sentence.matchAll(STRONG_WORDS)) {
        const word = m[1].toLowerCase();
        if (!profileLower.includes(word)) {
          add("strong_claim", word, `A reply says "${word}", which is not in your profile. Check that it is true.`);
        }
      }

      for (const m of sentence.matchAll(QUALITY)) {
        const before = sentence.slice(0, m.index ?? 0);
        if (NEGATION.test(before) || LIMIT_WORDS.test(before)) continue; // "outside my expertise" is honest
        const word = m[1].toLowerCase().replace(/\s+/g, " ");
        if (!profileLower.includes(word)) {
          add("unverified_quality", word, `A reply says "${word}", which is not in your profile. Check that it is true.`);
        }
      }
    }

    if (PLACEHOLDER.test(text)) {
      add("placeholder", "p", "A reply contains [ADD: ...]. Fill in those parts yourself before you send it.");
    }
    if (RELIGIOUS_GREETING.test(text) && !GREETING_IN_CHAT.test(chatText)) {
      add(
        "greeting",
        "g",
        "A reply opens with a religious greeting that nobody used in this chat. Check that it suits this client."
      );
    }
    if (UNLISTED_OFFER.test(text)) {
      add(
        "unlisted_offer",
        "o",
        "A reply offers a referral or introduction. Your profile does not list this. Check that you really offer it."
      );
    }
  }

  return [...flags.values()];
}