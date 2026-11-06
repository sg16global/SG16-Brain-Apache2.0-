import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FREE_TOKENS, balanceOf, callTokens, freeTokenAllowance } from "../src/tokens.ts";

test("freeTokenAllowance: configured value, else the default", () => {
  assert.equal(freeTokenAllowance(undefined), DEFAULT_FREE_TOKENS);
  assert.equal(freeTokenAllowance(""), DEFAULT_FREE_TOKENS);
  assert.equal(freeTokenAllowance("2500"), 2500);
  assert.equal(freeTokenAllowance("0"), 0);
  assert.equal(freeTokenAllowance("-5"), DEFAULT_FREE_TOKENS);
  assert.equal(freeTokenAllowance("lots"), DEFAULT_FREE_TOKENS);
  assert.equal(freeTokenAllowance("1.5"), DEFAULT_FREE_TOKENS);
});

test("balanceOf never goes negative", () => {
  assert.deepEqual(balanceOf(0, 100), { allowance: 100, used: 0, remaining: 100 });
  assert.deepEqual(balanceOf(150, 100), { allowance: 100, used: 150, remaining: 0 });
});

test("callTokens: host counts first, a conservative estimate otherwise, never zero", () => {
  assert.equal(callTokens({ total: 77 }, 0, 0), 77);
  assert.equal(callTokens({ prompt: 40, completion: 2 }, 0, 0), 42);
  assert.equal(callTokens({}, 400, 40), 110);
  assert.equal(callTokens({}, 0, 0), 1);
});
