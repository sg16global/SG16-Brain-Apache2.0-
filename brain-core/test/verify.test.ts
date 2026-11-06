import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyOutput, requestAllowed } from "../src/verify.ts";
import { DEFAULT_POLICY } from "../src/types.ts";

const BASE = { requireJson: false, maxOutputChars: 1000, blockedPatterns: [] };

test("accepts a normal answer", () => {
  assert.deepEqual(verifyOutput({ ...BASE, text: "here is your answer" }), { ok: true });
});

test("rejects empty, oversized, and control-char output", () => {
  assert.equal(verifyOutput({ ...BASE, text: "   " }).ok, false);
  assert.equal(verifyOutput({ ...BASE, text: "x".repeat(1001) }).ok, false);
  assert.equal(verifyOutput({ ...BASE, text: "bad\u0000output" }).ok, false);
  assert.equal(verifyOutput({ ...BASE, text: "bad\u001b[31moutput" }).ok, false); // ANSI escape
  assert.equal(verifyOutput({ ...BASE, text: "bad\u000coutput" }).ok, false);
});

test("tab, LF and CRLF line endings are ordinary text", () => {
  assert.ok(verifyOutput({ ...BASE, text: "def f():\r\n\treturn 1\r\n" }).ok);
  assert.ok(verifyOutput({ ...BASE, text: "line one\nline two" }).ok);
});

test("requireJson enforces {answer: string} structure", () => {
  const good = verifyOutput({ ...BASE, requireJson: true, text: JSON.stringify({ answer: "42" }) });
  assert.ok(good.ok);
  assert.equal(verifyOutput({ ...BASE, requireJson: true, text: "not json" }).ok, false);
  assert.equal(verifyOutput({ ...BASE, requireJson: true, text: JSON.stringify({ nope: 1 }) }).ok, false);
});

test("blocked patterns are enforced and broken regexes ignored", () => {
  const v = verifyOutput({ ...BASE, text: "fine", blockedPatterns: ["forbidden-thing"] });
  assert.equal(v.ok, true);
  assert.equal(verifyOutput({ ...BASE, blockedPatterns: ["forbidden-thing"], text: "here: forbidden-thing" }).ok, false);
  // an operator's broken pattern never wedges verification
  assert.equal(verifyOutput({ ...BASE, blockedPatterns: ["("], text: "fine" }).ok, true);
  assert.equal(requestAllowed("fine", { ...DEFAULT_POLICY, blocked_patterns: ["("] }), true);
  assert.equal(requestAllowed("bad", { ...DEFAULT_POLICY, blocked_patterns: ["bad"] }), false);
});
