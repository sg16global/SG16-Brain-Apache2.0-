import { test } from "node:test";
import assert from "node:assert/strict";
import { detectScript } from "../src/detect.ts";
import { systemPrompt, messagesFor } from "../src/prompt.ts";

test("universal script detection — no language is special-cased", () => {
  const bn = detectScript("আমি ভালো আছি");                       // Bengali
  assert.equal(bn.script, "bengali");
  const ar = detectScript("كيف حالك اليوم");                     // Arabic
  assert.equal(ar.script, "arabic");
  const hi = detectScript("आप कैसे हैं आज");                       // Hindi (Devanagari)
  assert.equal(hi.script, "devanagari");
  const en = detectScript("how are you today");
  assert.equal(en.script, "latin");
  const th = detectScript("สวัสดีครับ");
  assert.equal(th.script, "thai");
  const zh = detectScript("你好，今天怎么样");
  assert.equal(zh.script, "han");
});

test("mixed scripts resolve to the dominant one", () => {
  const mixed = detectScript("ami valo achi " + "আমি ".repeat(10));
  assert.equal(mixed.script, "bengali");
  assert.ok(mixed.confidence > 0.5);
});

test("no letters means no script", () => {
  assert.equal(detectScript("1234 !!!").script, null);
});

test("system prompt is language-neutral and carries the universal rule", () => {
  const p = systemPrompt({ script: null, confidence: 0, totalLetters: 0 });
  assert.match(p, /Always reply in the same language the user writes in/);
  // no language or country is named in the base prompt
  assert.ok(!/bengali|bangla|english|hindi|urdu|arabic|bangladesh|india/i.test(p));
});

test("detected script is passed generically, any script, same rule", () => {
  const bn = systemPrompt(detectScript("আমি ভালো আছি"));
  assert.match(bn, /bengali script/);
  const ar = systemPrompt(detectScript("كيف حالك"));
  assert.match(ar, /arabic script/);
});

test("messagesFor keeps system first, user last, history capped", () => {
  const history = Array.from({ length: 20 }, (_, i) => ({ role: "assistant" as const, content: String(i) }));
  const msgs = messagesFor("sys", "hello", history);
  assert.equal(msgs[0].role, "system");
  assert.equal(msgs[msgs.length - 1].content, "hello");
  assert.equal(msgs.length, 10);
});
