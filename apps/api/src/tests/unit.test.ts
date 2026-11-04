import { test } from "node:test";
import assert from "node:assert/strict";
import { TTLCache } from "../utils/TTLCache";
import { singleFlight } from "../utils/singleFlight";
import { normalizeLang } from "../services/translation";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- TTLCache ----------
test("TTLCache stores and returns a value", () => {
  const c = new TTLCache<string>(10, 10_000);
  c.set("a", "1");
  assert.equal(c.get("a"), "1");
  assert.equal(c.get("missing"), undefined);
});

test("TTLCache entries expire", async () => {
  const c = new TTLCache<string>(10, 30);
  c.set("a", "1");
  assert.equal(c.get("a"), "1");
  await sleep(70);
  assert.equal(c.get("a"), undefined);
});

test("TTLCache removes the least recently used entry when full", () => {
  const c = new TTLCache<number>(2, 10_000);
  c.set("a", 1);
  c.set("b", 2);
  c.get("a"); // "a" is now recently used
  c.set("c", 3); // cache is full -> "b" should go
  assert.equal(c.get("b"), undefined);
  assert.equal(c.get("a"), 1);
  assert.equal(c.get("c"), 3);
});

// ---------- singleFlight ----------
test("singleFlight runs identical requests only once", async () => {
  let runs = 0;
  const run = async () => {
    runs++;
    await sleep(30);
    return "ok";
  };

  const [a, b] = await Promise.all([singleFlight("same", run), singleFlight("same", run)]);

  assert.equal(runs, 1);
  assert.equal(a.value, "ok");
  assert.equal(b.value, "ok");
  assert.equal(a.shared, false);
  assert.equal(b.shared, true);
});

test("singleFlight cancels the work only after everybody has left", async () => {
  let aborted = false;
  const run = (signal: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(new Error("aborted"));
      });
      setTimeout(() => resolve("late"), 500);
    });

  const c1 = new AbortController();
  const c2 = new AbortController();
  const p1 = singleFlight("cancel-test", run, c1.signal).catch(() => "gone");
  const p2 = singleFlight("cancel-test", run, c2.signal).catch(() => "gone");

  c1.abort();
  await sleep(10);
  assert.equal(aborted, false, "one waiter is still there, so work must continue");

  c2.abort();
  await sleep(10);
  assert.equal(aborted, true, "everybody left, so work must be cancelled");

  await Promise.all([p1, p2]);
});

// ---------- normalizeLang ----------
test("normalizeLang cleans up AI language codes", () => {
  assert.equal(normalizeLang("UR-latn"), "ur-Latn");
  assert.equal(normalizeLang("ur_Latn"), "ur-Latn");
  assert.equal(normalizeLang("Roman Urdu"), "ur-Latn");
  assert.equal(normalizeLang("zh-CN"), "zh");
  assert.equal(normalizeLang(" EN "), "en");
  assert.equal(normalizeLang("fr"), "fr");
});