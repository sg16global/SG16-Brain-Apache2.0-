// Run with: npm test
// Chat is locked to the SG16 brain: no relay to other models, no persona wrappers,
// no fake delay.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { generateReply } from "./ai-engine.ts";

const SRC = path.resolve(import.meta.dirname, "..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(full);
  }
  return out;
}

test("the local guard answers instantly, with no simulated inference delay", async () => {
  const t0 = Date.now();
  const r = await generateReply("hello there");
  assert.ok(Date.now() - t0 < 100, "the old engine slept 120-730 ms to look busy");
  assert.ok(r.content.length > 0);
  assert.ok(r.latencyMs < 100);
});

test("answers never claim to be relayed through, or to be, another model", async () => {
  for (const prompt of ["hello", "compare claude and gpt", "tell me about gemini", "what is the sovereign model", "write python code"]) {
    const { content } = await generateReply(prompt);
    assert.doesNotMatch(content, /Relayed via|relayed through|Llama 3|Stable Diffusion|\[Configured local path\]/i, prompt);
  }
});

test("the history answer has the right dates", async () => {
  const { content } = await generateReply("give me the history of AI, a timeline");
  assert.match(content, /1956/);
  assert.doesNotMatch(content, /1855|1950.{1,6}1900s/);
});

test("no source file calls an outside AI provider", () => {
  const banned = /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY/;
  const hits = sourceFiles(SRC).filter((f) => banned.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(hits.map((f) => path.relative(SRC, f)), []);
});

test("the chat route ignores any requested model id", () => {
  const route = fs.readFileSync(path.join(SRC, "app/api/brain/route.ts"), "utf8");
  assert.match(route, /const modelId = SG16_MODEL_ID;/);
  assert.doesNotMatch(route, /body\??\.modelId/);
  assert.doesNotMatch(route, /brain: "relay"|selfHosted/);
});
