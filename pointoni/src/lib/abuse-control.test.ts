// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RateLimiter,
  clientIdentity,
  proxyTrusted,
  rateConfigFromEnv,
} from "./rate-limit.ts";
import {
  HumanPassStore,
  checkHuman,
  turnstileEnabled,
  turnstileSiteKey,
  verifyTurnstileToken,
  type HumanDeps,
} from "./turnstile.ts";

const SECRET = "proxy-secret-for-tests";
const ENV = { SG16_PROXY_AUTH_SECRET: SECRET } as unknown as NodeJS.ProcessEnv;
const hdrs = (o: Record<string, string>) => new Headers(o);

// ---------------------------------------------------------------- client identity
test("without proxy proof, forwarding headers are ignored (no per-visitor identity)", () => {
  const id = clientIdentity(hdrs({ "x-forwarded-for": "9.9.9.9", "cf-connecting-ip": "8.8.8.8" }), ENV);
  assert.deepEqual(id, { key: null, trusted: false });
});

test("a wrong proxy secret is not trusted", () => {
  const id = clientIdentity(hdrs({ "x-sg16-proxy-auth": "nope", "cf-connecting-ip": "8.8.8.8" }), ENV);
  assert.equal(id.trusted, false);
  assert.equal(proxyTrusted(hdrs({}), ENV), false);
});

test("no secret configured means nothing is ever trusted", () => {
  const id = clientIdentity(
    hdrs({ "x-sg16-proxy-auth": "", "cf-connecting-ip": "8.8.8.8" }),
    {} as unknown as NodeJS.ProcessEnv,
  );
  assert.equal(id.trusted, false);
});

test("a proven proxy's CF-Connecting-IP identifies the visitor, hashed - never the raw address", () => {
  const a = clientIdentity(hdrs({ "x-sg16-proxy-auth": SECRET, "cf-connecting-ip": "203.0.113.7" }), ENV);
  const a2 = clientIdentity(hdrs({ "x-sg16-proxy-auth": SECRET, "cf-connecting-ip": "203.0.113.7" }), ENV);
  const b = clientIdentity(hdrs({ "x-sg16-proxy-auth": SECRET, "cf-connecting-ip": "203.0.113.8" }), ENV);
  assert.equal(a.trusted, true);
  assert.equal(a.key, a2.key);
  assert.notEqual(a.key, b.key);
  assert.ok(!a.key!.includes("203"));
  assert.equal(a.key!.length, 24);
});

test("X-Forwarded-For is used (first hop) when there is no CF header, only for a proven proxy", () => {
  const a = clientIdentity(hdrs({ "x-sg16-proxy-auth": SECRET, "x-forwarded-for": "198.51.100.4, 10.0.0.1" }), ENV);
  const b = clientIdentity(hdrs({ "x-sg16-proxy-auth": SECRET, "cf-connecting-ip": "198.51.100.4" }), ENV);
  assert.equal(a.key, b.key);
});

test("a malformed address from a proven proxy gives no identity rather than a shared junk key", () => {
  const id = clientIdentity(hdrs({ "x-sg16-proxy-auth": SECRET, "cf-connecting-ip": "not-an-ip" }), ENV);
  assert.deepEqual(id, { key: null, trusted: false });
});

// ------------------------------------------------------------------- rate limiter
const cfg = { perMinute: 3, perHour: 5, globalPerMinute: 1000, maxKeys: 100 };
const visitor = (k: string) => ({ key: k, trusted: true });

test("per-visitor minute limit blocks the extra request, others are unaffected, window resets", () => {
  const rl = new RateLimiter(cfg);
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(rl.check(visitor("a"), t0).ok, true);
  const blocked = rl.check(visitor("a"), t0 + 1000);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.scope, "visitor");
    assert.ok(blocked.retryAfterSec >= 1 && blocked.retryAfterSec <= 60);
  }
  assert.equal(rl.check(visitor("b"), t0 + 1000).ok, true);
  assert.equal(rl.check(visitor("a"), t0 + 61_000).ok, true);
});

test("per-visitor hour limit", () => {
  const rl = new RateLimiter(cfg);
  let t = 5_000_000;
  let allowed = 0;
  for (let i = 0; i < 8; i++) {
    if (rl.check(visitor("a"), t).ok) allowed += 1;
    t += 61_000; // a fresh minute each time, same hour
  }
  assert.equal(allowed, 5);
});

test("global cap applies to everyone, including requests with no identity", () => {
  const rl = new RateLimiter({ ...cfg, globalPerMinute: 4 });
  const anon = { key: null, trusted: false };
  const results = Array.from({ length: 6 }, () => rl.check(anon, 9_000_000).ok);
  assert.deepEqual(results, [true, true, true, true, false, false]);
  assert.equal(rl.check(anon, 9_000_000 + 61_000).ok, true);
});

test("the visitor table is bounded under a flood of distinct addresses", () => {
  const rl = new RateLimiter({ ...cfg, maxKeys: 5 });
  for (let i = 0; i < 50; i++) rl.check(visitor(`k${i}`), 1_000_000);
  assert.ok(rl.size() <= 5, `table grew to ${rl.size()}`);
});

test("config: safe defaults, env overrides, garbage falls back", () => {
  const d = rateConfigFromEnv({} as unknown as NodeJS.ProcessEnv);
  assert.deepEqual(d, { perMinute: 8, perHour: 60, globalPerMinute: 300, maxKeys: 100_000 });
  const o = rateConfigFromEnv({ SG16_RATE_PER_MINUTE: "20", SG16_RATE_PER_HOUR: "x", SG16_RATE_GLOBAL_PER_MINUTE: "-3" } as unknown as NodeJS.ProcessEnv);
  assert.equal(o.perMinute, 20);
  assert.equal(o.perHour, 60);
  assert.equal(o.globalPerMinute, 300);
});

// -------------------------------------------------------------------- turnstile
const ON = { TURNSTILE_SECRET_KEY: "sekret", TURNSTILE_SITE_KEY: "sitekey" } as unknown as NodeJS.ProcessEnv;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function deps(fetchImpl: HumanDeps["fetchImpl"]): HumanDeps & { calls: () => number } {
  let n = 0;
  return {
    store: new HumanPassStore(),
    reachability: { at: 0, ok: true },
    timeoutMs: 50,
    fetchImpl: async (u, i) => {
      n += 1;
      return (fetchImpl as NonNullable<HumanDeps["fetchImpl"]>)(u, i);
    },
    calls: () => n,
  };
}

test("turnstile is off unless BOTH keys are set, and the site key is only exposed when on", () => {
  assert.equal(turnstileEnabled({} as unknown as NodeJS.ProcessEnv), false);
  assert.equal(turnstileEnabled({ TURNSTILE_SECRET_KEY: "s" } as unknown as NodeJS.ProcessEnv), false);
  assert.equal(turnstileEnabled({ TURNSTILE_SITE_KEY: "k" } as unknown as NodeJS.ProcessEnv), false);
  assert.equal(turnstileSiteKey({ TURNSTILE_SITE_KEY: "k" } as unknown as NodeJS.ProcessEnv), null);
  assert.equal(turnstileSiteKey(ON), "sitekey");
});

test("disabled: nothing is checked and Cloudflare is never contacted", async () => {
  const d = deps(async () => json({ success: true }));
  const r = await checkHuman({}, d, {} as unknown as NodeJS.ProcessEnv);
  assert.deepEqual(r, { ok: true, skipped: "disabled" });
  assert.equal(d.calls(), 0);
});

test("a valid token passes once with Cloudflare, then a human pass covers later messages", async () => {
  const d = deps(async () => json({ success: true }));
  const first = await checkHuman({ turnstileToken: "tok" }, d, ON);
  assert.equal(first.ok, true);
  const humanToken = (first as { humanToken?: string }).humanToken;
  assert.ok(humanToken && humanToken.length >= 32);
  assert.equal(d.calls(), 1);
  const second = await checkHuman({ humanToken }, d, ON);
  assert.equal(second.ok, true);
  assert.equal(d.calls(), 1); // no second Cloudflare call
});

test("an invalid token is refused, and so is a made-up human pass", async () => {
  const d = deps(async () => json({ success: false, "error-codes": ["invalid-input-response"] }));
  assert.deepEqual(await checkHuman({ turnstileToken: "bad" }, d, ON), { ok: false });
  assert.deepEqual(await checkHuman({ humanToken: "f".repeat(48) }, d, ON), { ok: false });
});

test("Cloudflare unreachable while verifying a token -> fail open (rate limiter still applies)", async () => {
  const d = deps(async () => {
    throw new Error("network down");
  });
  const r = await checkHuman({ turnstileToken: "tok" }, d, ON);
  assert.deepEqual(r, { ok: true, skipped: "fail-open" });
});

test("Cloudflare timeout -> fail open", async () => {
  const d = deps(
    (_u, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  const t0 = Date.now();
  const r = await checkHuman({ turnstileToken: "tok" }, d, ON);
  assert.deepEqual(r, { ok: true, skipped: "fail-open" });
  assert.ok(Date.now() - t0 < 1000);
});

test("Cloudflare 5xx counts as unreachable, not as a failed visitor", async () => {
  assert.equal(await verifyTurnstileToken("t", "s", async () => json({}, 503), 50), "error");
});

test("no token while Cloudflare is reachable -> required; while it is down -> fail open; probe is cached", async () => {
  const up = deps(async () => json({ success: false, "error-codes": ["missing-input-response"] }));
  assert.deepEqual(await checkHuman({}, up, ON), { ok: false });
  assert.deepEqual(await checkHuman({}, up, ON), { ok: false });
  assert.equal(up.calls(), 1);

  const down = deps(async () => {
    throw new Error("down");
  });
  assert.deepEqual(await checkHuman({}, down, ON), { ok: true, skipped: "fail-open" });
});

test("a client-supplied 'turnstile unavailable' flag does not bypass anything", async () => {
  const d = deps(async () => json({ success: false }));
  const r = await checkHuman({ turnstileUnavailable: true } as never, d, ON);
  assert.deepEqual(r, { ok: false });
});

test("a human pass stops working after its use cap and after it expires", () => {
  const store = new HumanPassStore();
  const t0 = 1_000_000;
  const tok = store.mint(t0);
  for (let i = 0; i < 60; i++) assert.equal(store.use(tok, t0), true);
  assert.equal(store.use(tok, t0), false);
  const tok2 = store.mint(t0);
  assert.equal(store.use(tok2, t0 + 16 * 60_000), false);
});
