import { test } from "node:test";
import assert from "node:assert/strict";
import { profileSchema } from "@linguabridge/shared";
import { checkReplies, numbersNotIn } from "../services/replyChecks";
import { tidy } from "../services/assist";

const profile = profileSchema.parse({
  experience: "2 years of freelance work",
  pricingNotes: "Basic store starts at $150",
  deliveryNotes: "Usually 5 to 7 days",
  skills: ["Web development"],
  portfolioLinks: ["https://example.com/work"],
});

const codes = (reply: string, chat = "", p = profile) =>
  checkReplies({ professional: reply, friendly: "", persuasive: "" }, p, chat).map((f) => f.code);

test("an invented number of years is flagged, a real one is not", () => {
  assert.ok(codes("I have 10 years of experience.").includes("unverified_years"));
  assert.ok(!codes("I have 2 years of experience.").includes("unverified_years"));
});

test("prices must come from the profile or the chat", () => {
  assert.ok(codes("It costs $200.").includes("unverified_price"));
  assert.ok(!codes("It starts at $150.").includes("unverified_price"));
  assert.ok(!codes("Your budget of $80 is noted.", "my budget is $80").includes("unverified_price"));
});

test("delivery times must come from the profile or the chat", () => {
  assert.ok(codes("I can finish in 3 days.").includes("unverified_duration"));
  assert.ok(!codes("Usually 5-7 days.").includes("unverified_duration"));
  assert.ok(codes("Delivery in 3 din.").includes("unverified_duration"));
});

test("discount percentages are flagged", () => {
  assert.ok(codes("I can give you 20% off.").includes("unverified_percent"));
});

test("links must be in the profile", () => {
  assert.ok(codes("See https://other.com/me").includes("link_not_in_profile"));
  assert.ok(!codes("See https://example.com/work").includes("link_not_in_profile"));
});

test("contact details and other apps are flagged", () => {
  assert.ok(codes("Write to me at test@example.com").includes("contact_details"));
  assert.ok(codes("Call +92 300 1234567").includes("contact_details"));
  assert.ok(codes("Let's continue on WhatsApp").includes("off_platform"));
  assert.ok(!codes("Delivery on 2026-11-09 is fine", "2026-11-09").includes("contact_details"));
});

test("guarantees and strong claims are flagged", () => {
  assert.ok(codes("I guarantee the result.").includes("guarantee"));
  assert.ok(!codes("I cannot guarantee a ranking.").includes("guarantee"));
  assert.ok(codes("I am an expert in this.").includes("strong_claim"));
  assert.ok(!codes("Best regards, Ali").includes("strong_claim"));
});

test("placeholders are flagged so they are not sent by mistake", () => {
  assert.ok(codes("Here is my work: [ADD: portfolio link]").includes("placeholder"));
});

test("a normal honest reply has no flags", () => {
  assert.deepEqual(codes("Thanks! Could you tell me which pages you need for your store?"), []);
});

test("refusing to guarantee is not a promise", () => {
  assert.ok(!codes("A #1 ranking is not something I can guarantee.").includes("guarantee"));
  assert.ok(!codes("I'm unable to guarantee 100% results.").includes("guarantee"));
  assert.ok(!codes("I can't guarantee that.").includes("guarantee"));
  assert.ok(!codes("I understand you'd like a guaranteed outcome.").includes("guarantee"));
  assert.ok(codes("I can guarantee a #1 ranking.").includes("guarantee"));
  assert.ok(codes("We guarantee success.").includes("guarantee"));
  assert.ok(codes("You get guaranteed results.").includes("guarantee"));
});

test("strong words are only flagged when the freelancer says them about themselves", () => {
  assert.ok(!codes("I can connect you with a trusted SEO expert.").includes("strong_claim"));
  assert.ok(!codes("I will do my best.").includes("strong_claim"));
  assert.ok(codes("I am an expert in this.").includes("strong_claim"));
});

test("self-praise words are flagged, ordinary phrases are not", () => {
  assert.ok(codes("I specialize in e-commerce sites.").includes("strong_claim"));
  assert.ok(codes("I am an experienced developer.").includes("strong_claim"));
  assert.ok(!codes("We can figure out the best fit together.").includes("strong_claim"));
  assert.ok(!codes("Best regards, Ali").includes("strong_claim"));
});

test("quality words and 'what the price includes' are flagged", () => {
  assert.ok(codes("I can build a reliable, fully functional store.").includes("unverified_quality"));
  assert.ok(codes("The $150 price covers a complete store.").includes("price_scope"));
  assert.ok(codes("That price includes the core store setup.").includes("price_scope"));
  assert.ok(!codes("SEO is outside my expertise.").includes("unverified_quality"));
  assert.ok(!codes("A basic store starts at $150. Which features do you need?").includes("price_scope"));
});

test("tidy replaces special hyphens and spaces", () => {
  assert.equal(tidy("e\u2011commerce in 5\u20117 days, 100\u202F% sure"), "e-commerce in 5-7 days, 100% sure");
});

test("a religious greeting nobody used in the chat is flagged", () => {
  assert.ok(codes("Assalam o Alaikum! How can I help?", "Hi, I need a store").includes("greeting"));
  assert.ok(!codes("Waalaikum salam! Sure.", "Assalam o Alaikum, I need a store").includes("greeting"));
  assert.ok(!codes("Hello! Sure.", "Hi").includes("greeting"));
});

test("tidy adds the missing space after punctuation but leaves links and numbers alone", () => {
  assert.equal(tidy("features,design and why?Because"), "features, design and why? Because");
  assert.equal(tidy("See https://x.com/p?id=5 and 10,000 items"), "See https://x.com/p?id=5 and 10,000 items");
});

test("offers of referrals are flagged", () => {
  assert.ok(codes("We can refer you to a specialist.").includes("unlisted_offer"));
  assert.ok(codes("I can recommend a trusted SEO partner.").includes("unlisted_offer"));
  assert.ok(!codes("SEO is outside my service scope.").includes("unlisted_offer"));
});

test("tidy separates a number from the word stuck to it, but not ordinary units", () => {
  assert.equal(tidy("usually 5 to7 days"), "usually 5 to 7 days");
  assert.equal(tidy("on the 5th, at 2pm, 10k users, 100mb"), "on the 5th, at 2pm, 10k users, 100mb");
});

test("numbersNotIn finds numbers that the source does not contain", () => {
  assert.deepEqual(numbersNotIn("Budget 120 and 5 days", "budget is $120"), ["5"]);
  assert.deepEqual(numbersNotIn("Budget 1,500", "I can pay 1500"), []);
});

test("any bracketed 'add' placeholder is flagged", () => {
  assert.ok(codes("Here is my work: [Add your portfolio link]").includes("placeholder"));
  assert.ok(codes("[ADD: link]").includes("placeholder"));
  assert.ok(codes("Please see [add your link here]").includes("placeholder"));
  assert.ok(!codes("Please check the [address] field.").includes("placeholder"));
});