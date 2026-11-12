// Cloudflare Turnstile for free-trial chat (owner request 2026-11-13): off until
// both keys are set; then a free-trial visitor proves once that they are a
// person, pass holders and API projects are never asked, and Cloudflare being
// unreachable fails open.

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  turnstileEnabled,
  turnstileSiteKey,
  checkHuman,
  mintHumanToken,
  humanTokenValid,
  resetTurnstileForTests,
  VERIFY_URL,
  HUMAN_TOKEN_TTL_MS,
} from "../src/turnstile.ts";
import { designCompatRoute, type DesignEnv } from "../src/design-compat.ts";
import { issueRecord } from "../src/billing.ts";

const IDENTITY = "turnstile-test-identity-secret-0123456789";
const ON = { TURNSTILE_SITE_KEY: "0x4AAAAsite", TURNSTILE_SECRET_KEY: "0x4AAAAsecret", SG16_IDENTITY_SECRET: IDENTITY };
const NOW = Date.UTC(2026, 10, 13, 12);

beforeEach(() => resetTurnstileForTests());

/** A fake siteverify: "good" passes, anything else fails; down = Cloudflare unreachable. */
function cloudflare(state: { down?: boolean; calls: number }) {
  return async (url: string, init: RequestInit) => {
    state.calls += 1;
    assert.equal(url, VERIFY_URL);
    if (state.down) throw new Error("network down");
    const form = new URLSearchParams(String(init.body));
    assert.equal(form.get("secret"), ON.TURNSTILE_SECRET_KEY, "the secret goes only to Cloudflare");
    return Response.json({ success: form.get("response") === "good" });
  };
}

test("turnstile: off unless both keys (and the identity secret) are set; the probe never shows the secret", () => {
  assert.equal(turnstileEnabled({}), false);
  assert.equal(turnstileEnabled({ ...ON, TURNSTILE_SECRET_KEY: "" }), false);
  assert.equal(turnstileEnabled({ ...ON, TURNSTILE_SITE_KEY: " " }), false);
  assert.equal(turnstileEnabled({ ...ON, SG16_IDENTITY_SECRET: undefined }), false);
  assert.equal(turnstileEnabled(ON), true);
  assert.equal(turnstileSiteKey(ON), "0x4AAAAsite");
  assert.equal(turnstileSiteKey({}), null);
});

test("checkHuman: always ok while off, without calling Cloudflare", async () => {
  const cf = { calls: 0 };
  assert.deepEqual(await checkHuman({}, {}, cloudflare(cf) as never, NOW), { ok: true, skipped: "disabled" });
  assert.equal(cf.calls, 0);
});

test("checkHuman: a good token passes once and earns a 15-minute human token; a bad one fails", async () => {
  const cf = { calls: 0 };
  const good = await checkHuman({ turnstileToken: "good" }, ON, cloudflare(cf) as never, NOW);
  assert.equal(good.ok, true);
  const human = (good as { humanToken?: string }).humanToken!;
  assert.ok(await humanTokenValid(human, IDENTITY, NOW + 60_000));
  assert.equal(await humanTokenValid(human, IDENTITY, NOW + HUMAN_TOKEN_TTL_MS), false, "expires after 15 minutes");
  // the human token alone is enough for the next messages: Cloudflare is not asked again
  const before = cf.calls;
  assert.deepEqual(await checkHuman({ humanToken: human }, ON, cloudflare(cf) as never, NOW + 60_000), { ok: true });
  assert.equal(cf.calls, before);
  assert.deepEqual(await checkHuman({ turnstileToken: "forged" }, ON, cloudflare(cf) as never, NOW), { ok: false });
});

test("checkHuman: no proof is refused while Cloudflare is reachable, and fails open when it is not", async () => {
  assert.deepEqual(await checkHuman({}, ON, cloudflare({ calls: 0 }) as never, NOW), { ok: false });
  resetTurnstileForTests();
  const down = { down: true, calls: 0 };
  assert.deepEqual(await checkHuman({}, ON, cloudflare(down) as never, NOW), { ok: true, skipped: "fail-open" });
  assert.deepEqual(await checkHuman({ turnstileToken: "good" }, ON, cloudflare(down) as never, NOW), { ok: true, skipped: "fail-open" });
});

test("human tokens cannot be forged, edited or stretched", async () => {
  const real = await mintHumanToken(IDENTITY, NOW);
  assert.ok(await humanTokenValid(real, IDENTITY, NOW));
  assert.equal(await humanTokenValid(await mintHumanToken("another-secret-0123456789abcdef", NOW), IDENTITY, NOW), false);
  const [, exp, nonce, sig] = real.split(".");
  assert.equal(await humanTokenValid(`h1.${Number(exp) + 3_600_000}.${nonce}.${sig}`, IDENTITY, NOW), false);
  assert.equal(await humanTokenValid("h1.garbage", IDENTITY, NOW), false);
  assert.equal(await humanTokenValid(12345, IDENTITY, NOW), false);
});

// ---- the chat door ---------------------------------------------------------

function env(overrides: Partial<DesignEnv> = {}): DesignEnv {
  return {
    KEYS: { get: async () => null } as never,
    LOGS: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } as never,
    QUEUE: {} as never,
    MATRIX: {} as never,
    SG16_IDENTITY_SECRET: IDENTITY,
    ...overrides,
  } as DesignEnv;
}

async function brain(e: DesignEnv, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  let doorCalls = 0;
  const res = await designCompatRoute(
    new Request("https://x/api/brain", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7", ...headers },
      body: JSON.stringify({ message: "hi", ...body }),
    }),
    "/api/brain",
    {
      env: e,
      chatDoor: async () => {
        doorCalls += 1;
        return Response.json({ ok: true, answer: "hello", meta: { engine: "model-vps", latency_ms: 5 } });
      },
      healthProbe: async () => ({ d1: true, model: true }),
      keyAuth: async () => null,
    } as never,
  );
  return { res: res!, body: (await res!.json()) as Record<string, unknown>, doorCalls: () => doorCalls };
}

async function withCloudflare<T>(state: { down?: boolean; calls: number }, run: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = cloudflare(state) as never;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

test("GET /api/brain?probe=turnstile: tells the panel whether to show the check", async () => {
  const probe = async (e: DesignEnv) =>
    (await (await designCompatRoute(new Request("https://x/api/brain?probe=turnstile"), "/api/brain", { env: e } as never))!.json()) as Record<string, unknown>;
  assert.deepEqual(await probe(env()), { enabled: false, siteKey: null });
  assert.deepEqual(await probe(env(ON)), { enabled: true, siteKey: "0x4AAAAsite" });
});

test("POST /api/brain: with Turnstile on, a trial visitor without proof is asked for the check; the model is never called", async () => {
  await withCloudflare({ calls: 0 }, async () => {
    const asked = await brain(env(ON));
    assert.equal(asked.res.status, 403);
    assert.equal(asked.body.turnstileRequired, true);
    assert.equal(asked.doorCalls(), 0);
    assert.equal(asked.res.headers.get("set-cookie"), null, "the trial clock has not started");

    const passed = await brain(env(ON), { turnstileToken: "good" });
    assert.equal(passed.res.status, 200);
    assert.equal(passed.doorCalls(), 1);
    assert.match(String(passed.body.humanToken), /^h1\./, "the panel gets a human token for the next messages");

    const next = await brain(env(ON), { humanToken: passed.body.humanToken });
    assert.equal(next.res.status, 200);
  });
});

test("POST /api/brain: Turnstile never asks pass holders, and off means no change", async () => {
  await withCloudflare({ calls: 0 }, async () => {
    const BILLING = "turnstile-test-billing-secret-0123456789";
    const record = await issueRecord("day", null, BILLING);
    const pass = Buffer.from(JSON.stringify(record)).toString("base64url");
    const paid = await brain(env({ ...ON, BILLING_SECRET: BILLING }), {}, { "x-sg16-pass": pass });
    assert.equal(paid.res.status, 200);
    assert.equal(paid.body.humanToken, undefined);

    const off = await brain(env());
    assert.equal(off.res.status, 200, "Turnstile off: the trial chats as before");
  });
});
