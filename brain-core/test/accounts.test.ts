// Visitor accounts: email code sign-up/sign-in, the code's limits, the
// operator boundary, the account's own free tokens and its pass on every
// device. D1 is a real SQLite database (node:sqlite) behind the D1 API, so
// the SQL in src/accounts.ts runs for real.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { designCompatRoute, signIdentityToken, type DesignEnv } from "../src/design-compat.ts";
import {
  requestCode,
  verifyCode,
  accountFreeRecord,
  senderOf,
  resetAccountTablesForTests,
  resetThrottlesForTests,
  CODE_TTL_MS,
  RESEND_WAIT_MS,
  SENDS_PER_HOUR,
  MAX_CODE_ATTEMPTS,
} from "../src/accounts.ts";
import { createHmac, randomBytes } from "node:crypto";
import { PASSES } from "../src/billing.ts";

const IDENTITY_SECRET = "accounts-test-identity-secret-0123456789";
const BILLING_SECRET = "accounts-test-billing-secret-0123456789";

// ---- a D1 made of SQLite ------------------------------------------------------

function d1(): D1Database {
  const db = new DatabaseSync(":memory:");
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      bind: (...values: unknown[]) => { args = values; return stmt; },
      first: async <T>() => (db.prepare(sql).get(...(args as never[])) ?? null) as T | null,
      all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
      run: async () => {
        const r = db.prepare(sql).run(...(args as never[]));
        return { meta: { changes: Number(r.changes) } };
      },
    };
    return stmt;
  };
  return {
    prepare,
    batch: async (stmts: Array<{ run(): Promise<unknown> }>) => {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  } as unknown as D1Database;
}

interface Sent { to: string; from: unknown; subject: string; text?: string }

function mailbox(fail?: string) {
  const sent: Sent[] = [];
  return {
    sent,
    binding: {
      send: async (m: Sent) => {
        if (fail) throw Object.assign(new Error("send failed"), { code: fail });
        sent.push(m);
        return { messageId: "m-" + sent.length };
      },
    },
    lastCode: () => /\b(\d{6})\b/.exec(sent.at(-1)?.text ?? "")?.[1] ?? "",
  };
}

function env(overrides: Partial<DesignEnv> = {}) {
  const mail = mailbox();
  const e = {
    KEYS: {} as never,
    LOGS: d1(),
    QUEUE: {} as never,
    MATRIX: {} as never,
    SG16_IDENTITY_SECRET: IDENTITY_SECRET,
    SG16_ADMIN_PASSWORD: "operator-password-123",
    BILLING_SECRET,
    EMAIL: mail.binding,
    EMAIL_FROM: "SG16 Brain <signin@example.org>",
    ...overrides,
  } as DesignEnv;
  return { e, mail };
}

beforeEach(() => {
  resetAccountTablesForTests();
  resetThrottlesForTests();
});

// the deps the Worker wires in; the chat door records which bucket answered
function deps(e: DesignEnv, records: Array<{ id: string }> = [], freeLeft = 10_000) {
  return {
    env: e,
    chatDoor: async (_payload: unknown, record: { id: string }) => {
      records.push(record);
      return Response.json({ ok: true, answer: "hello", meta: { engine: "model-vps", latency_ms: 3 } });
    },
    healthProbe: async () => ({ d1: true, model: true }),
    keyAuth: async () => null,
    freeTokens: async () => freeLeft,
  };
}

async function identity(e: DesignEnv, body: Record<string, unknown>, token?: string, ip = "203.0.113.10") {
  const headers: Record<string, string> = { "content-type": "application/json", "cf-connecting-ip": ip };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await designCompatRoute(
    new Request("https://x/api/identity", { method: "POST", headers, body: JSON.stringify(body) }),
    "/api/identity",
    deps(e),
  );
  return { status: res!.status, body: (await res!.json()) as Record<string, unknown> };
}

async function signIn(e: DesignEnv, mail: ReturnType<typeof mailbox>, email: string, extra: Record<string, unknown> = {}) {
  const asked = await identity(e, { action: "request", email });
  assert.equal(asked.status, 200, JSON.stringify(asked.body));
  return await identity(e, { action: "verify", email, code: mail.lastCode(), ...extra });
}

// a real signed pass record, exactly as the design pages hold it (X-SG16-Pass)
function passValue(tier: "day" | "week" | "month", startedAgoS = 0): { header: string; record: Record<string, unknown> } {
  const spec = PASSES[tier];
  const activated = Math.floor(Date.now() / 1000) - startedAgoS;
  const expires = activated + spec.hours * 3600;
  const nonce = randomBytes(18).toString("base64url");
  const token = createHmac("sha256", BILLING_SECRET).update(`sg16-pass-v1|${tier}||${spec.price}|${expires}|${nonce}`).digest("hex");
  const record = {
    pass: tier, label: spec.label, provider: "dodo", region: null, list_price: spec.price,
    price_charged: spec.price, humanitarian_bypass: false, activated_at: activated, expires_at: expires, nonce, token, verified_by: "sg16-host",
  };
  return { header: Buffer.from(JSON.stringify(record)).toString("base64url"), record };
}

async function chat(e: DesignEnv, records: Array<{ id: string }>, token?: string, pass?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (pass) headers["x-sg16-pass"] = pass;
  const res = await designCompatRoute(
    new Request("https://x/api/brain", { method: "POST", headers, body: JSON.stringify({ message: "hi" }) }),
    "/api/brain",
    deps(e, records),
  );
  return { status: res!.status, tier: res!.headers.get("x-chat-tier"), body: (await res!.json()) as Record<string, unknown> };
}

// ---- sign-up / sign-in ----------------------------------------------------------

test("email code: the first right code creates the account, the next sign-in finds it", async () => {
  const { e, mail } = env();
  const first = await signIn(e, mail, "New.Visitor@Example.com ");
  assert.equal(first.status, 200);
  assert.equal(first.body.email, "new.visitor@example.com");
  assert.equal(first.body.created, true);
  assert.equal(first.body.admin, false);
  assert.equal(typeof first.body.token, "string");
  // the email went to the visitor, from the configured sender, with the code
  assert.equal(mail.sent[0].to, "new.visitor@example.com");
  assert.deepEqual(mail.sent[0].from, { email: "signin@example.org", name: "SG16 Brain" });
  assert.match(mail.sent[0].subject, /^\d{6} is your SG16 Brain sign-in code$/);

  // a minute later: sign in again, same account
  const later = await requestCode(e as never, "new.visitor@example.com", "ip", Date.now() + RESEND_WAIT_MS + 1);
  assert.equal(later.ok, true);
  const again = await verifyCode(e as never, "new.visitor@example.com", mail.lastCode(), "ip", Date.now() + RESEND_WAIT_MS + 2);
  assert.deepEqual(again, { ok: true, email: "new.visitor@example.com", created: false });

  // the token is a working account token
  const me = await identity(e, { action: "me" }, first.body.token as string);
  assert.equal(me.status, 200);
  assert.equal(me.body.email, "new.visitor@example.com");
  assert.equal(me.body.admin, false);
  assert.equal(me.body.tier, "free");
  assert.equal(me.body.freeTokensRemaining, 10_000);
});

test("email code: wrong codes count, the limit holds, and a code works only once", async () => {
  const { e, mail } = env();
  await identity(e, { action: "request", email: "a@example.com" });
  const right = mail.lastCode();
  const wrong = right === "000000" ? "111111" : "000000";
  for (let i = 0; i < MAX_CODE_ATTEMPTS - 1; i++) {
    const r = await identity(e, { action: "verify", email: "a@example.com", code: wrong });
    assert.equal(r.status, 401);
    assert.match(String(r.body.error), /not right/);
  }
  // the last allowed try is the right code: it works
  const ok = await identity(e, { action: "verify", email: "a@example.com", code: right });
  assert.equal(ok.status, 200);
  // used once: the same code is now dead
  const reused = await identity(e, { action: "verify", email: "a@example.com", code: right });
  assert.equal(reused.status, 400);

  // a fresh code, five wrong tries, then even the right code is refused
  const later = Date.now() + RESEND_WAIT_MS + 1;
  await requestCode(e as never, "a@example.com", "ip", later);
  const fresh = mail.lastCode();
  const bad = fresh === "000000" ? "111111" : "000000";
  for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) await verifyCode(e as never, "a@example.com", bad, "ip", later);
  const locked = await verifyCode(e as never, "a@example.com", fresh, "ip", later);
  assert.equal(locked.ok, false);
  assert.equal((locked as { status: number }).status, 429);
});

test("email code: expires after ten minutes; resend waits a minute; five codes an hour", async () => {
  const { e, mail } = env();
  const t0 = Date.now();
  assert.equal((await requestCode(e as never, "b@example.com", "ip", t0)).ok, true);
  const code = mail.lastCode();
  const expired = await verifyCode(e as never, "b@example.com", code, "ip", t0 + CODE_TTL_MS + 1);
  assert.equal((expired as { status: number }).status, 400);

  const soon = await requestCode(e as never, "b@example.com", "ip", t0 + 5_000);
  assert.equal((soon as { status: number }).status, 429);

  let t = t0;
  for (let i = 1; i < SENDS_PER_HOUR; i++) {
    t += RESEND_WAIT_MS + 1;
    assert.equal((await requestCode(e as never, "b@example.com", "ip", t)).ok, true, `send ${i + 1}`);
  }
  t += RESEND_WAIT_MS + 1;
  const sixth = await requestCode(e as never, "b@example.com", "ip", t);
  assert.equal((sixth as { status: number }).status, 429);
  assert.match((sixth as { error: string }).error, /hour/);
  // a new hour opens again
  assert.equal((await requestCode(e as never, "b@example.com", "ip", t0 + 3600_000 + 1)).ok, true);
  assert.equal(mail.sent.length, SENDS_PER_HOUR + 1);
});

test("email code: bad input, sign-in switched off, and a failed send are honest", async () => {
  const { e } = env();
  assert.equal((await identity(e, { action: "request", email: "not-an-email" })).status, 400);
  assert.equal((await identity(e, { action: "verify", email: "a@example.com", code: "12" })).status, 400);

  const off = env({ EMAIL: undefined }).e;
  const r = await identity(off, { action: "request", email: "a@example.com" });
  assert.equal(r.status, 503);
  assert.match(String(r.body.error), /not switched on/);

  // the domain is not onboarded yet -> "not switched on"; the code is retired and asking again is allowed at once
  const failing = mailbox("E_SENDER_DOMAIN_NOT_AVAILABLE");
  const fe = env({ EMAIL: failing.binding as never }).e;
  const f1 = await identity(fe, { action: "request", email: "a@example.com" });
  assert.equal(f1.status, 503);
  const f2 = await identity(fe, { action: "request", email: "a@example.com" });
  assert.equal(f2.status, 503, "no 'wait a minute' after a send that never happened");

  const other = env({ EMAIL: mailbox("E_DELIVERY_FAILED").binding as never }).e;
  assert.equal((await identity(other, { action: "request", email: "a@example.com" })).status, 502);
});

test("one connection cannot spray codes at many emails", async () => {
  const { e } = env();
  let last = 0;
  for (let i = 0; i < 11; i++) {
    last = (await identity(e, { action: "request", email: `p${i}@example.com` }, undefined, "198.51.100.77")).status;
  }
  assert.equal(last, 429);
  assert.equal((await identity(e, { action: "request", email: "p99@example.com" }, undefined, "198.51.100.78")).status, 200);
});

test("the sender line is read from EMAIL_FROM; without one, email sign-in stays off", async () => {
  assert.deepEqual(senderOf("SG16 Brain <signin@example.org>"), { email: "signin@example.org", name: "SG16 Brain" });
  assert.deepEqual(senderOf("hello@example.org"), { email: "hello@example.org" });
  assert.equal(senderOf(undefined), null, "no built-in sender: nothing is ever sent from an old domain");
  assert.equal(senderOf("not an address"), null);
  const { e, mail } = env({ EMAIL_FROM: undefined });
  const r = await identity(e, { action: "request", email: "a@example.com" });
  assert.equal(r.status, 503);
  assert.equal(mail.sent.length, 0);
});

test("the code email names the site the visitor is on", async () => {
  const { e, mail } = env();
  assert.equal((await requestCode(e as never, "a@example.com", "ip", Date.now(), "sg16-brain-core.example.workers.dev")).ok, true);
  assert.match(mail.sent[0].text ?? "", /Enter it on sg16-brain-core\.example\.workers\.dev within 10 minutes/);
  assert.ok(!(mail.sent[0].text ?? "").includes("mistralbrain"));
});

// ---- the operator boundary ------------------------------------------------------

test("an email code for sg16global@gmail.com gives a visitor account, never the admin console", async () => {
  const { e, mail } = env();
  const viaCode = await signIn(e, mail, "sg16global@gmail.com");
  assert.equal(viaCode.status, 200);
  assert.equal(viaCode.body.admin, false);
  const me = await identity(e, { action: "me" }, viaCode.body.token as string);
  assert.equal(me.body.admin, false);
  const mint = await designCompatRoute(
    new Request("https://x/api/admin/project-keys", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${viaCode.body.token}` },
      body: JSON.stringify({ project: "x" }),
    }),
    "/api/admin/project-keys",
    deps(e),
  );
  assert.equal(mint!.status, 403, "only the password sign-in opens the console");

  // the password sign-in still does
  const op = await identity(e, { action: "admin-login", email: "sg16global@gmail.com", password: "operator-password-123" });
  assert.equal(op.status, 200);
  assert.equal(op.body.admin, true);
  assert.equal((await identity(e, { action: "me" }, op.body.token as string)).body.admin, true);
});

// ---- the account at work: free tokens and the pass ------------------------------

test("free chat needs an account; each account has its own bucket on every device", async () => {
  // with the free trial switched off (trial.test.ts covers the trial)
  const { e, mail } = env({ FREE_TRIAL_DAYS: "0" });
  const records: Array<{ id: string }> = [];
  const anon = await chat(e, records);
  assert.equal(anon.status, 401);
  assert.equal(anon.body.signInRequired, true);
  assert.equal(records.length, 0);

  const a = (await signIn(e, mail, "a@example.com")).body.token as string;
  const b = (await signIn(e, mail, "b@example.com")).body.token as string;
  // the same account signed in on a second device: a second token, the same bucket
  const a2 = await signIdentityTokenFreeSafe(e, mail, "a@example.com");
  assert.equal((await chat(e, records, a)).status, 200);
  assert.equal((await chat(e, records, a2)).status, 200);
  assert.equal((await chat(e, records, b)).status, 200);
  assert.equal(records[0].id, (await accountFreeRecord("a@example.com")).id);
  assert.equal(records[1].id, records[0].id, "one account, one allowance, any device");
  assert.notEqual(records[2].id, records[0].id);
  assert.match(records[0].id, /^free_/);
});

// a second sign-in for the same email, a minute later (a second device)
async function signIdentityTokenFreeSafe(e: DesignEnv, mail: ReturnType<typeof mailbox>, email: string): Promise<string> {
  const later = Date.now() + RESEND_WAIT_MS + 1;
  assert.equal((await requestCode(e as never, email, "ip2", later)).ok, true);
  const v = await verifyCode(e as never, email, mail.lastCode(), "ip2", later);
  assert.equal(v.ok, true);
  const { signAccountToken } = await import("../src/design-compat.ts");
  return await signAccountToken(email, IDENTITY_SECRET);
}

test("a pass used while signed in is kept with the account and works on another device", async () => {
  const { e, mail } = env();
  const records: Array<{ id: string }> = [];
  const { header, record } = passValue("week");
  const phone = (await signIn(e, mail, "buyer@example.com")).body.token as string;

  // device 1 holds the pass: chat is work tier, and the pass is now on the account
  const onPhone = await chat(e, records, phone, header);
  assert.equal(onPhone.status, 200);
  assert.equal(onPhone.tier, "work");

  // device 2 has no pass on it, only the sign-in: still work tier
  const laptop = await signIdentityTokenFreeSafe(e, mail, "buyer@example.com");
  const onLaptop = await chat(e, records, laptop);
  assert.equal(onLaptop.tier, "work");
  assert.equal(records[1].id, records[0].id, "the same pass bucket on both devices");
  assert.match(records[1].id, /^pass_/);

  // the account hands the pass back so the device can store it
  const me = await identity(e, { action: "me" }, laptop);
  assert.equal(me.body.tier, "work");
  assert.deepEqual(me.body.pass, record);
  assert.equal(me.body.freeTokensRemaining, undefined);

  // someone else's account never sees it
  const other = (await signIn(e, mail, "other@example.com")).body.token as string;
  assert.equal((await chat(e, records, other)).tier, "free");
});

test("verify links the device's pass; a shorter pass never replaces a longer one", async () => {
  const { e, mail } = env();
  const long = passValue("month");
  const short = passValue("day");
  const first = await signIn(e, mail, "keeper@example.com", { pass: long.header });
  assert.deepEqual(first.body.pass, long.record);
  const token = first.body.token as string;
  // a device with an older, shorter pass binds: the account keeps the longer one
  const bound = await identity(e, { action: "bind", pass: short.header }, token);
  assert.deepEqual(bound.body.pass, long.record);
  // a forged pass is ignored
  const forged = await identity(e, { action: "bind", pass: long.header.slice(0, -4) + "AAAA" }, token);
  assert.deepEqual(forged.body.pass, long.record);
  // binding needs a sign-in
  assert.equal((await identity(e, { action: "bind", pass: long.header })).status, 401);
});

test("an expired pass on the account falls back to the account's free tokens", async () => {
  const { e, mail } = env({ FREE_TRIAL_DAYS: "0" }); // the account ledger, with the free trial off
  const records: Array<{ id: string }> = [];
  const gone = passValue("day", 2 * 86400);
  const token = (await signIn(e, mail, "late@example.com")).body.token as string;
  await e.LOGS.prepare("UPDATE accounts SET pass = ? WHERE email = ?").bind(gone.header, "late@example.com").run();
  const r = await chat(e, records, token);
  assert.equal(r.status, 200);
  assert.equal(r.tier, "free");
  assert.equal(records[0].id, (await accountFreeRecord("late@example.com")).id);
});

test("operator tokens still verify as before (v1), account tokens never pass as operator tokens", async () => {
  const { verifyIdentityToken, signAccountToken, verifyAccountToken } = await import("../src/design-compat.ts");
  const op = await signIdentityToken("sg16global@gmail.com", IDENTITY_SECRET);
  const acct = await signAccountToken("sg16global@gmail.com", IDENTITY_SECRET);
  assert.equal((await verifyIdentityToken(op, IDENTITY_SECRET))?.email, "sg16global@gmail.com");
  assert.equal(await verifyIdentityToken(acct, IDENTITY_SECRET), null);
  assert.equal((await verifyAccountToken(acct, IDENTITY_SECRET))?.email, "sg16global@gmail.com");
  assert.equal(await verifyAccountToken(op, IDENTITY_SECRET), null);
});

// ---- no free tokens (FREE_TOKEN_ALLOWANCE "0", owner decision 2026-11-13) --------

test("allowance 0: sign-in and the account view report no free-token balance; the messages never promise any", async () => {
  const { e, mail } = env({ FREE_TOKEN_ALLOWANCE: "0", FREE_TRIAL_DAYS: "0" });
  const signed = await signIn(e, mail, "zero@example.com");
  assert.equal(signed.status, 200);
  assert.equal("freeTokensRemaining" in signed.body, false, "no FREE TOKENS LEFT 0 row in the panel");
  const me = await identity(e, { action: "me" }, signed.body.token as string);
  assert.equal("freeTokensRemaining" in me.body, false);
  // trial off, not signed in: no "new accounts get 0 free tokens"
  const anon = await chat(e, []);
  assert.equal(anon.status, 401);
  assert.doesNotMatch(String(anon.body.error), /free tokens/);
  assert.match(String(anon.body.error), /pass/);

  // with free tokens on, the balance is still reported, as before
  const on = env({ FREE_TOKEN_ALLOWANCE: "10000", FREE_TRIAL_DAYS: "0" });
  const signedOn = await signIn(on.e, on.mail, "ten@example.com");
  assert.equal(signedOn.body.freeTokensRemaining, 10_000);
});
