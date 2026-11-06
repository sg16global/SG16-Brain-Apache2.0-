// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { encodePassHeader, parsePassFile, passFileText, type PassRecord } from "./billing.ts";

const record: PassRecord = {
  pass: "week",
  provider: "dodo",
  price_charged: 5,
  list_price: 5,
  region: null,
  activated_at: 1_790_000_000,
  expires_at: 1_790_000_000 + 7 * 86400,
  nonce: "n0nce",
  token: "a".repeat(64),
};

test("the pass header is the whole record as base64url JSON, and decodes back exactly", () => {
  const header = encodePassHeader(record);
  assert.match(header, /^[A-Za-z0-9_-]{40,3000}$/); // exactly what the host and the proxy accept
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString("utf8")), record);
});

test("a saved pass file round-trips, and a bare record is accepted too", () => {
  assert.deepEqual(parsePassFile(passFileText(record)), record);
  assert.deepEqual(parsePassFile(JSON.stringify(record)), record);
});

test("junk, other formats and malformed records are not accepted as a pass", () => {
  for (const bad of [
    "", "not json", "[]", "null", "{}", JSON.stringify({ format: "sg16-pass", record: null }),
    JSON.stringify({ ...record, pass: "lifetime" }),
    JSON.stringify({ ...record, token: "short" }),
    JSON.stringify({ ...record, expires_at: "soon" }),
    "x".repeat(9000),
  ]) {
    assert.equal(parsePassFile(bad), null, bad.slice(0, 30));
  }
});
