// Free chat trial (owner request 2026-11-13): visitors chat with no sign-in for
// FREE_TRIAL_DAYS days (default 3, max 7) from their first message, then need a
// pass. "0" switches the trial off (the sign-in gate, as before).

import test from "node:test";
import assert from "node:assert/strict";

import {
  trialDays,
  visitorTrial,
  newTrialCookie,
  readTrialStart,
  trialRecord,
  TRIAL_COOKIE,
} from "../src/trial.ts";
import { designCompatRoute, signAccountToken, signIdentityToken, type DesignEnv } from "../src/design-compat.ts";
import { issueRecord } from "../src/billing.ts";

const SECRET = "trial-test-identity-secret-0123456789";
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 13, 12, 0, 0);

const cookieOf = (setCookie: string) => setCookie.split(";")[0];

// ---- the clock -------------------------------------------------------------

test("trialDays: default 3, '0' is off, capped at 7, junk falls back to 3", () => {
  assert.equal(trialDays(undefined), 3);
  assert.equal(trialDays(""), 3);
  assert.equal(trialDays("0"), 0);
  assert.equal(trialDays("5"), 5);
  assert.equal(trialDays("7"), 7);
  assert.equal(trialDays("30"), 7);
  assert.equal(trialDays("-1"), 3);
  assert.equal(trialDays("2.5"), 3);
  assert.equal(trialDays("abc"), 3);
});

test("visitorTrial: first visit starts the trial and sets a signed HttpOnly cookie", async () => {
  const t = await visitorTrial(null, SECRET, "3", NOW);
  assert.equal(t.state, "active");
  if (t.state !== "active") return;
  assert.equal(t.endsAt, NOW + 3 * DAY);
  assert.ok(t.setCookie);
  assert.match(t.setCookie!, new RegExp(`^${TRIAL_COOKIE}=v1\\.${NOW}\\.[0-9a-f]{32}\\.[0-9a-f]{64};`));
  assert.match(t.setCookie!, /HttpOnly/);
  assert.match(t.setCookie!, /Secure/);
  assert.match(t.setCookie!, /SameSite=Lax/);
  assert.match(t.setCookie!, /Path=\/api/);
  assert.match(t.setCookie!, /Max-Age=31536000/, "kept a year, so an ended trial stays ended");
});

test("visitorTrial: the cookie carries the clock; active until the last day, then ended", async () => {
  const cookie = cookieOf(await newTrialCookie(SECRET, NOW));
  const day2 = await visitorTrial(`other=1; ${cookie}`, SECRET, "3", NOW + 2 * DAY);
  assert.deepEqual(day2, { state: "active", endsAt: NOW + 3 * DAY }, "no new cookie while the trial runs");
  const lastMinute = await visitorTrial(cookie, SECRET, "3", NOW + 3 * DAY - 60_000);
  assert.equal(lastMinute.state, "active");
  const ended = await visitorTrial(cookie, SECRET, "3", NOW + 3 * DAY);
  assert.deepEqual(ended, { state: "ended", endsAt: NOW + 3 * DAY });
  // the owner can lengthen the trial (up to 7 days) without touching cookies
  assert.equal((await visitorTrial(cookie, SECRET, "7", NOW + 5 * DAY)).state, "active");
});

test("visitorTrial: a forged or edited cookie cannot move the start date", async () => {
  const real = cookieOf(await newTrialCookie(SECRET, NOW - 10 * DAY));
  const moved = real.replace(`.${NOW - 10 * DAY}.`, `.${NOW}.`);
  assert.equal(await readTrialStart(moved, SECRET, NOW), null);
  const otherSecret = cookieOf(await newTrialCookie("someone-elses-secret-0123456789", NOW));
  assert.equal(await readTrialStart(otherSecret, SECRET, NOW), null);
  const future = cookieOf(await newTrialCookie(SECRET, NOW + DAY));
  assert.equal(await readTrialStart(future, SECRET, NOW), null);
  assert.equal(await readTrialStart(`${TRIAL_COOKIE}=garbage`, SECRET, NOW), null);
  // the genuine one still reads
  assert.equal(await readTrialStart(real, SECRET, NOW), NOW - 10 * DAY);
});

test("visitorTrial: off when FREE_TRIAL_DAYS is 0 or no identity secret is set", async () => {
  assert.deepEqual(await visitorTrial(null, SECRET, "0", NOW), { state: "off" });
  assert.deepEqual(await visitorTrial(null, undefined, "3", NOW), { state: "off" });
  assert.deepEqual(await visitorTrial(null, "  ", "3", NOW), { state: "off" });
});

test("trialRecord: one bucket per network, project web", async () => {
  const a = await trialRecord("203.0.113.7");
  assert.match(a.id, /^trial_[0-9a-f]{12}$/);
  assert.equal(a.project, "web");
  assert.equal(a.revoked, false);
  assert.equal((await trialRecord("203.0.113.7")).id, a.id);
  assert.notEqual((await trialRecord("198.51.100.1")).id, a.id);
});

// ---- the chat door ---------------------------------------------------------

function env(overrides: Partial<DesignEnv> = {}): DesignEnv {
  return {
    KEYS: { get: async () => null } as never,
    LOGS: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } as never,
    QUEUE: {} as never,
    MATRIX: {} as never,
    SG16_IDENTITY_SECRET: SECRET,
    ...overrides,
  } as DesignEnv;
}

async function brain(e: DesignEnv, headers: Record<string, string> = {}) {
  const seen: Array<{ id: string }> = [];
  const res = await designCompatRoute(
    new Request("https://x/api/brain", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7", ...headers },
      body: JSON.stringify({ message: "hi" }),
    }),
    "/api/brain",
    {
      env: e,
      chatDoor: async (_payload: unknown, record: { id: string }) => {
        seen.push(record);
        return Response.json({ ok: true, answer: "hello", meta: { engine: "model-vps", latency_ms: 5 } });
      },
      healthProbe: async () => ({ d1: true, model: true }),
      keyAuth: async () => null,
    } as never,
  );
  return { res: res!, body: (await res!.json()) as Record<string, unknown>, seen };
}

test("POST /api/brain: a new visitor chats at once, with no sign-in, and gets the trial cookie", async () => {
  const first = await brain(env());
  assert.equal(first.res.status, 200);
  assert.equal((first.body.assistantMessage as { content: string }).content, "hello");
  assert.equal(first.body.tier, "free");
  assert.equal(first.seen.length, 1);
  assert.equal(first.seen[0].id, (await trialRecord("203.0.113.7")).id);
  const setCookie = first.res.headers.get("set-cookie");
  assert.ok(setCookie?.startsWith(`${TRIAL_COOKIE}=v1.`));
  assert.ok(first.res.headers.get("x-free-trial-ends"));

  // the browser sends the cookie back: still free, no second cookie
  const again = await brain(env(), { cookie: cookieOf(setCookie!) });
  assert.equal(again.res.status, 200);
  assert.equal(again.res.headers.get("set-cookie"), null);
});

test("POST /api/brain: after the trial, a pass is required (402 to the Subscription page); the model is never called", async () => {
  const old = cookieOf(await newTrialCookie(SECRET, Date.now() - 3 * DAY - 1000));
  const ended = await brain(env(), { cookie: old });
  assert.equal(ended.res.status, 402);
  assert.equal(ended.body.trialEnded, true);
  assert.equal(ended.body.subscribeUrl, "/subscription");
  assert.match(String(ended.body.error), /3-day free trial has ended.*pass/);
  assert.equal(ended.seen.length, 0);
});

test("POST /api/brain: signing in never ends the trial early (visitor account or the operator)", async () => {
  const live = env({ FREE_TOKEN_ALLOWANCE: "0" }); // the live setting
  const visitor = await signAccountToken("visitor@example.com", SECRET);
  const first = await brain(live, { authorization: `Bearer ${visitor}` });
  assert.equal(first.res.status, 200, "a signed-in visitor chats free during the trial");
  assert.equal(first.seen[0].id, (await trialRecord("203.0.113.7")).id);
  const setCookie = first.res.headers.get("set-cookie");
  assert.ok(setCookie?.startsWith(`${TRIAL_COOKIE}=v1.`));
  // a trial started before signing in keeps running after it
  const day2 = cookieOf(await newTrialCookie(SECRET, Date.now() - 2 * DAY));
  assert.equal((await brain(live, { cookie: day2, authorization: `Bearer ${visitor}` })).res.status, 200);
  // the operator signed in to /admin on the same browser chats too
  const operator = await signIdentityToken("sg16global@gmail.com", SECRET);
  const op = await brain(live, { cookie: day2, authorization: `Bearer ${operator}` });
  assert.equal(op.res.status, 200);
  assert.match(op.seen[0].id, /^trial_/);
});

test("POST /api/brain: after the trial a signed-in visitor needs a pass when there are no free tokens", async () => {
  const old = cookieOf(await newTrialCookie(SECRET, Date.now() - 3 * DAY - 1000));
  const visitor = await signAccountToken("visitor@example.com", SECRET);
  const ended = await brain(env({ FREE_TOKEN_ALLOWANCE: "0" }), { cookie: old, authorization: `Bearer ${visitor}` });
  assert.equal(ended.res.status, 402);
  assert.equal(ended.body.trialEnded, true);
  assert.equal(ended.body.subscribeUrl, "/subscription");
  assert.equal(ended.seen.length, 0, "the model is never called");
  // with free tokens switched on (FREE_TOKEN_ALLOWANCE > 0) the account's own bucket takes over
  const withTokens = await brain(env({ FREE_TOKEN_ALLOWANCE: "10000" }), { cookie: old, authorization: `Bearer ${visitor}` });
  assert.equal(withTokens.res.status, 200);
  assert.match(withTokens.seen[0].id, /^free_/);
});

test("POST /api/brain: a pass holder is never on the trial, before or after it", async () => {
  const BILLING = "trial-test-billing-secret-0123456789";
  const record = await issueRecord("day", null, BILLING);
  const header = Buffer.from(JSON.stringify(record)).toString("base64url");
  const old = cookieOf(await newTrialCookie(SECRET, Date.now() - 30 * DAY));
  const paid = await brain(env({ BILLING_SECRET: BILLING, FREE_TOKEN_ALLOWANCE: "0" }), { cookie: old, "x-sg16-pass": header });
  assert.equal(paid.res.status, 200);
  assert.match(paid.seen[0].id, /^pass_/);
  assert.equal(paid.body.tier, "work");
  assert.equal(paid.res.headers.get("set-cookie"), null);
});

test("POST /api/brain: FREE_TRIAL_DAYS 0 keeps the old sign-in gate", async () => {
  const off = await brain(env({ FREE_TRIAL_DAYS: "0" }));
  assert.equal(off.res.status, 401);
  assert.equal(off.body.signInRequired, true);
  assert.equal(off.seen.length, 0);
});
