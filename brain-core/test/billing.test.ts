// Billing port tests: tiers, signed records, Standard Webhooks signature,
// webhook record derivation, checkout body. The token cross-check uses
// node:crypto to re-derive the exact HMAC message the Python host used —
// records issued by the old stack must verify here unchanged.

import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";

import {
  PASSES,
  effectivePrice,
  issueRecord,
  verifyRecord,
  verifyWebhookSignature,
  eventPaymentObject,
  recordFromWebhook,
  checkoutRequestBody,
  VerificationError,
} from "../src/billing.ts";

const SECRET = "test-billing-secret-0123456789";

test("pass tiers match the published panel", () => {
  assert.deepEqual(Object.keys(PASSES), ["day", "week", "half", "month"]);
  assert.equal(PASSES.day.price, 3);
  assert.equal(PASSES.week.price, 5);
  assert.equal(PASSES.half.price, 8);
  assert.equal(PASSES.month.price, 15);
  assert.equal(PASSES.day.hours, 24);
  assert.equal(PASSES.month.hours, 24 * 30);
});

test("issue -> verify roundtrip; token matches the python HMAC byte-for-byte", async () => {
  const record = await issueRecord("day", null, SECRET, "dodo", 1_800_000_000);
  const verified = await verifyRecord({ ...record }, SECRET, 1_800_000_100);
  assert.equal(verified.pass, "day");
  assert.equal(verified.price_charged, 3);
  assert.equal(verified.humanitarian_bypass, false);

  const message = `sg16-pass-v1|${record.pass}|${record.region ?? ""}|${record.price_charged}|${record.expires_at}|${record.nonce}`;
  const pythonToken = createHmac("sha256", SECRET).update(message).digest("hex");
  assert.equal(record.token, pythonToken);
});

test("humanitarian records are zero-rate and flagged", async () => {
  const record = await issueRecord("week", "Palestine", SECRET, "verified-humanitarian", 1_800_000_000);
  assert.equal(record.price_charged, 0);
  assert.equal(record.humanitarian_bypass, true);
  await assert.doesNotReject(() => verifyRecord({ ...record }, SECRET, 1_800_000_100));
  assert.equal(effectivePrice("week", "Palestine"), 0);
});

test("verify rejects spoofed, expired, malformed records", async () => {
  const base = await issueRecord("month", null, SECRET, "dodo", 1_800_000_000);
  await assert.rejects(() => verifyRecord({ ...base, price_charged: 0 }, SECRET, 1_800_000_100), VerificationError);
  await assert.rejects(() => verifyRecord({ ...base, list_price: 99 }, SECRET, 1_800_000_100), VerificationError);
  await assert.rejects(() => verifyRecord({ ...base, token: "f".repeat(64) }, SECRET, 1_800_000_100), VerificationError);
  const tampered = { ...base, pass: "week", label: PASSES.week.label, list_price: 5, price_charged: 5 };
  await assert.rejects(() => verifyRecord(tampered, SECRET, 1_800_000_100), VerificationError);
  await assert.rejects(() => verifyRecord({ ...base }, SECRET, base.expires_at + 10), VerificationError);
  const shortExpiry = { ...base, expires_at: base.expires_at - 3600 };
  await assert.rejects(() => verifyRecord(shortExpiry, SECRET, 1_800_000_100), VerificationError);
  await assert.rejects(() => verifyRecord({ ...base, nonce: "" }, SECRET, 1_800_000_100), VerificationError);
});

// ------------------------------------------------------------ webhook sig

function signWebhook(keyBytes: Buffer, id: string, timestamp: number, body: string): string {
  const mac = createHmac("sha256", keyBytes).update(`${id}.${timestamp}.${body}`).digest();
  return `v1,${mac.toString("base64")}`;
}

test("standard webhooks signature verifies, tampering and replay fail", async () => {
  const keyBytes = randomBytes(32);
  const whsec = `whsec_${keyBytes.toString("base64")}`;
  const id = "msg_test_01";
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ type: "payment.succeeded", data: { amount: 300 } });

  const sig = signWebhook(keyBytes, id, ts, body);
  await assert.doesNotReject(() => verifyWebhookSignature(whsec, id, String(ts), sig, body));
  // re-signed (space separated) duplicates accepted
  await assert.doesNotReject(() => verifyWebhookSignature(whsec, id, String(ts), `${sig} ${sig}`, body));

  await assert.rejects(() => verifyWebhookSignature(whsec, id, String(ts), sig, body + " "), VerificationError);
  await assert.rejects(() => verifyWebhookSignature(whsec, "msg_other", String(ts), sig, body), VerificationError);
  await assert.rejects(
    () => verifyWebhookSignature(whsec, id, String(ts - 3600), signWebhook(keyBytes, id, ts - 3600, body), body),
    VerificationError,
  );
  await assert.rejects(() => verifyWebhookSignature(whsec, null, String(ts), sig, body), VerificationError);
  await assert.rejects(() => verifyWebhookSignature("", id, String(ts), sig, body), VerificationError);
  // wrong secret
  await assert.rejects(() => verifyWebhookSignature("whsec_" + randomBytes(32).toString("base64"), id, String(ts), sig, body));
});

// ------------------------------------------------------------ record from webhook

const PRODUCT_IDS = { day: "pdt_day", week: "pdt_week", half: "pdt_half", month: "pdt_month" };

function paymentEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "payment.succeeded",
    data: {
      amount: 300,
      currency: "USD",
      product_cart: [{ product_id: "pdt_day", quantity: 1 }],
      metadata: { sg16_pass: "day", sg16_region: "" },
      ...overrides,
    },
  };
}

test("webhook record: USD match issues a signed pass", async () => {
  const record = await recordFromWebhook(paymentEvent(), SECRET, 1_800_000_000, PRODUCT_IDS);
  assert.equal(record.pass, "day");
  assert.equal(record.provider, "dodo");
  await assert.doesNotReject(() => verifyRecord({ ...record }, SECRET, 1_800_000_100));
});

test("webhook record: nested data.object shape is accepted", async () => {
  const nested = { type: "payment.succeeded", data: { object: { amount: 300, currency: "USD", metadata: { sg16_pass: "day", sg16_region: "" } } } };
  assert.equal((eventPaymentObject(nested) as any).amount, 300);
  await assert.doesNotReject(() => recordFromWebhook(nested, SECRET, 1_800_000_000, {}));
});

test("webhook record rejects: wrong amount, wrong product, wrong event, humanitarian", async () => {
  await assert.rejects(() => recordFromWebhook(paymentEvent({ amount: 299 }), SECRET, 1_800_000_000, PRODUCT_IDS), VerificationError);
  await assert.rejects(
    () => recordFromWebhook(paymentEvent({ product_cart: [{ product_id: "pdt_month" }] }), SECRET, 1_800_000_000, PRODUCT_IDS),
    VerificationError,
  );
  await assert.rejects(() => recordFromWebhook({ type: "payment.failed", data: {} }, SECRET, 1_800_000_000, PRODUCT_IDS), VerificationError);
  await assert.rejects(
    () => recordFromWebhook(paymentEvent({ metadata: { sg16_pass: "day", sg16_region: "Palestine" } }), SECRET, 1_800_000_000, PRODUCT_IDS),
    VerificationError,
  );
  await assert.rejects(() => recordFromWebhook(paymentEvent({ metadata: { sg16_pass: "year" } }), SECRET, 1_800_000_000, PRODUCT_IDS), VerificationError);
  await assert.rejects(() => recordFromWebhook(paymentEvent({ amount: null }), SECRET, 1_800_000_000, PRODUCT_IDS), VerificationError);
});

test("webhook record: non-USD via USD settlement accepted, zero without settlement rejected", async () => {
  const settled = paymentEvent({ amount: 2650, currency: "INR", settlement_amount: 300, settlement_currency: "USD" });
  await assert.doesNotReject(() => recordFromWebhook(settled, SECRET, 1_800_000_000, PRODUCT_IDS));
  await assert.rejects(
    () => recordFromWebhook(paymentEvent({ amount: 2650, currency: "INR", settlement_amount: 0, settlement_currency: "USD" }), SECRET, 1_800_000_000, PRODUCT_IDS),
    VerificationError,
  );
  await assert.rejects(
    () => recordFromWebhook(paymentEvent({ amount: 0, currency: "INR" }), SECRET, 1_800_000_000, PRODUCT_IDS),
    VerificationError,
  );
});

// ------------------------------------------------------------ checkout body

test("checkout body: one product, quantity 1, sg16 metadata", () => {
  const body = checkoutRequestBody("pdt_day", "day", null, "https://mistralbrain.com/?x=1", {
    sg16_checkout_ref: "abc123",
  }) as Record<string, any>;
  assert.deepEqual(body.product_cart, [{ product_id: "pdt_day", quantity: 1 }]);
  assert.equal(body.return_url, "https://mistralbrain.com/?x=1");
  assert.deepEqual(body.metadata, { sg16_pass: "day", sg16_region: "", sg16_checkout_ref: "abc123" });
  assert.throws(() => checkoutRequestBody(undefined, "day", null, null), VerificationError);
  assert.throws(() => checkoutRequestBody("pdt_x", "year", null, null), VerificationError);
});
