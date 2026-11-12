// The Dodo payment webhook against a real SQLite database (schema.sql): a paid
// checkout issues exactly one pass, even when Dodo's two success events for
// the same payment arrive at the same moment (owner request 2026-11-13).

import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

import { billingRoute } from "../src/billing-routes.ts";

const sqlite = await import("node:sqlite").catch(() => null);

/** A D1-shaped adapter over node:sqlite: prepare/bind/first/run/all and an atomic batch. */
function d1() {
  const db = new sqlite!.DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...values: unknown[]) => statement(sql, values),
    first: async () => (db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(args as never[])).changes) } }),
    exec: () => ({ meta: { changes: Number(db.prepare(sql).run(...(args as never[])).changes) } }),
  });
  return {
    raw: db,
    prepare: (sql: string) => statement(sql),
    batch: async (stmts: Array<{ exec: () => unknown }>) => {
      db.exec("BEGIN");
      try {
        const out = stmts.map((s) => s.exec());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

const KEY = Buffer.from("dodo-webhook-signing-key");
const WEBHOOK_SECRET = "whsec_" + KEY.toString("base64");

function signed(id: string, body: string): Request {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", KEY).update(`${id}.${ts}.${body}`).digest("base64");
  return new Request("https://mistralbrain.com/api/dodo/webhook", {
    method: "POST",
    headers: { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` },
    body,
  });
}

test("webhook: Dodo's two success events at the same moment issue exactly one pass", { skip: !sqlite && "node:sqlite not available" }, async () => {
  const db = d1();
  const env = {
    LOGS: db as never,
    DODO_WEBHOOK_SECRET: WEBHOOK_SECRET,
    BILLING_SECRET: "webhook-test-billing-secret-0123456789",
    DODO_PRODUCT_IDS: JSON.stringify({ day: "pdt_day" }),
  };
  const ref = "a".repeat(48);
  db.raw.prepare(
    "INSERT INTO checkouts (ref, pass_id, region, status, opened_at, gateway_session_id, record_token) VALUES (?, 'day', NULL, 'pending', ?, 'cks_1', NULL)",
  ).run(ref, Math.floor(Date.now() / 1000));
  const payment = {
    payment_id: "pay_1",
    total_amount: 300,
    currency: "USD",
    product_cart: [{ product_id: "pdt_day", quantity: 1 }],
    metadata: { sg16_pass: "day", sg16_region: "", sg16_checkout_ref: ref },
  };
  const a = JSON.stringify({ type: "payment.succeeded", data: payment });
  const b = JSON.stringify({ type: "checkout.session.completed", data: payment });

  const [ra, rb] = await Promise.all([
    billingRoute(signed("msg_a", a), env, "/api/dodo/webhook"),
    billingRoute(signed("msg_b", b), env, "/api/dodo/webhook"),
  ]);
  const bodies = [await ra!.json(), await rb!.json()] as Array<{ acted: boolean; duplicate?: boolean }>;
  assert.equal(ra!.status, 200);
  assert.equal(rb!.status, 200);
  assert.equal(bodies.filter((x) => x.acted).length, 1, "one event acts");
  assert.equal(bodies.filter((x) => x.duplicate).length, 1, "the other is a duplicate");

  const passes = db.raw.prepare("SELECT token FROM passes").all() as Array<{ token: string }>;
  assert.equal(passes.length, 1, "exactly one pass row: no orphaned second pass");
  const checkout = db.raw.prepare("SELECT status, record_token FROM checkouts WHERE ref = ?").get(ref) as { status: string; record_token: string };
  assert.equal(checkout.status, "paid");
  assert.equal(checkout.record_token, passes[0].token, "the checkout points at the stored pass");

  // the visitor's pickup gets that one pass
  const confirm = await billingRoute(
    new Request("https://mistralbrain.com/api/dodo/confirm", { method: "POST", body: JSON.stringify({ session_id: ref }) }),
    env,
    "/api/dodo/confirm",
  );
  assert.equal(confirm!.status, 200);
  assert.equal(((await confirm!.json()) as { record: { token: string } }).record.token, passes[0].token);

  // a later redelivery changes nothing
  const again = await billingRoute(signed("msg_c", a), env, "/api/dodo/webhook");
  assert.equal(((await again!.json()) as { duplicate?: boolean }).duplicate, true);
  assert.equal((db.raw.prepare("SELECT COUNT(*) AS n FROM passes").get() as { n: number }).n, 1);
});
