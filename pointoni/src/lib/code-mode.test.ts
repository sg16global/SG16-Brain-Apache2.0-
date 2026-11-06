import test from "node:test";
import assert from "node:assert/strict";
import { isTechnicalRequest, turnLimit, codeTokenBudget, CODE_HINT } from "./code-mode.ts";
import { sanitizeHistory } from "./chat-history.ts";

test("raw scripts, fenced code and build requests are technical; small talk is not", () => {
  assert.ok(isTechnicalRequest("def add(a, b):\n    return a + b\n\nprint(add(1, 2))"));
  assert.ok(isTechnicalRequest("const x = (a) => {\n  return a * 2;\n};\nexport default x;"));
  assert.ok(isTechnicalRequest("fix this:\n```js\nconsole.log(1)\n```"));
  assert.ok(isTechnicalRequest("Build me a todo app with a REST API"));
  assert.ok(isTechnicalRequest("SELECT id, name\nFROM users\nWHERE id = 1;"));
  assert.equal(isTechnicalRequest("hello"), false);
  assert.equal(isTechnicalRequest("What is the capital of France?"), false);
  assert.equal(isTechnicalRequest("I want to make a cake for my friend"), false);
});

test("code turns keep more of their text in the remembered history", () => {
  const code = "```py\n" + "x = 1\n".repeat(300) + "```";
  const plain = "word ".repeat(400);
  const h = sanitizeHistory([{ role: "user", content: code }, { role: "user", content: plain }]);
  assert.ok(h[0].content.length > 800 && h[0].content.length <= 3000);
  assert.equal(h[1].content.length, 800);
  assert.equal(turnLimit("hi", 800), 800);
});

test("code requests get a larger answer budget, capped; the hint asks for code only", () => {
  assert.equal(codeTokenBudget(600), 1800);
  assert.equal(codeTokenBudget(3000), 4000);
  assert.match(CODE_HINT, /fenced code blocks/);
});

import { resolveMode, isCodeLike } from "./code-mode.ts";
import { distillCharter } from "./charter-prompt.ts";

test("modes: an explicit mode from the caller wins; auto decides from the text", () => {
  assert.equal(resolveMode("assistant", "def f(): pass\nx\ny"), "assistant");
  assert.equal(resolveMode("code", "hello"), "code");
  assert.equal(resolveMode("nonsense", "hello"), "chat");
  assert.equal(resolveMode(undefined, "How are you?"), "chat");
  assert.equal(resolveMode("auto", "Build me a booking app with a REST API"), "build");
  assert.equal(resolveMode(undefined, "fix this:\n```py\nprint(1\n```"), "code");
  assert.ok(isCodeLike("build") && isCodeLike("code") && !isCodeLike("assistant"));
});

test("each mode has its own stable system prompt; chat leaves the base prompt unchanged", () => {
  const base = distillCharter("flagship");
  assert.equal(distillCharter("flagship", { mode: "chat" }), base);
  for (const m of ["assistant", "code", "build"] as const) {
    const a = distillCharter("flagship", { mode: m });
    assert.equal(a, distillCharter("flagship", { mode: m }));
    assert.ok(a.includes(`MODE (${m}):`), m);
  }
});
