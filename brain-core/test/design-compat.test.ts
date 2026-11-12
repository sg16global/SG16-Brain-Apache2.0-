// Design-compat tests: the legacy design-API surface the pointoni pages speak.
// Covers: operator token round-trip, the one operator email + dashboard
// password, the old sg16p_ project-key scheme (old-host keys must keep verifying), the chat
// adapter's ChatReply/stream shapes, and the admin console guard.

import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";

import {
  signIdentityToken,
  verifyIdentityToken,
  signAccountToken,
  passwordMatches,
  adminLogin,
  ADMIN_EMAIL,
  createProjectKey,
  verifyProjectKey,
  designCompatRoute,
  designRscRoute,
  projectActivity,
  LIVE_WINDOW_MS,
  type DesignEnv,
} from "../src/design-compat.ts";
import { authenticate } from "../src/auth.ts";
import { keyHash } from "../src/keys.ts";

const IDENTITY_SECRET = "identity-secret-0123456789-identity-secret";
const PROJECT_SECRET = "project-key-secret-0123456789abcdef";
const BILLING_SECRET = "test-billing-secret-0123456789";
// the operator's password, as the owner sets it in the Cloudflare dashboard
const ADMIN_PASSWORD = "operator-password-123";

// in-memory KV: the project-key record store (and anything else) sees a Map
function kvStub(): DesignEnv["KEYS"] {
  const map = new Map<string, string>();
  return {
    get: async (key: string) => map.get(key) ?? null,
    put: async (key: string, value: string) => void map.set(key, value),
    list: async (options?: { prefix?: string }) => ({
      keys: [...map.keys()]
        .filter((k) => !options?.prefix || k.startsWith(options.prefix))
        .map((name) => ({ name })),
      list_complete: true,
      cursor: "",
    }),
  } as never;
}

function env(overrides: Partial<DesignEnv> = {}): DesignEnv {
  return {
    KEYS: kvStub(),
    LOGS: {} as never,
    QUEUE: {} as never,
    MATRIX: {} as never,
    SG16_IDENTITY_SECRET: IDENTITY_SECRET,
    SG16_ADMIN_PASSWORD: ADMIN_PASSWORD,
    SG16_PROJECT_KEY_SECRET: PROJECT_SECRET,
    BILLING_SECRET,
    ...overrides,
  } as DesignEnv;
}

const deps = (e: DesignEnv, chatDoor?: unknown, model = true) => ({
  env: e,
  chatDoor: (chatDoor as never) ?? (async () => Response.json({ ok: true, answer: "hello", meta: { engine: "model-vps", latency_ms: 7 } })),
  healthProbe: async () => ({ d1: true, model }),
  // the same key check index.ts wires in for /v1
  keyAuth: async (authorization: string | null) => {
    const auth = await authenticate(authorization, e.KEYS, e.SG16_PROJECT_KEY_SECRET,
      (e.SG16_REVOKED_PROJECTS ?? "").split(",").map((p) => p.trim()).filter(Boolean));
    return auth.ok ? auth.record : null;
  },
});

// ---------------------------------------------------------------- identity

test("identity token round-trips and rejects tampering and expiry", async () => {
  const token = await signIdentityToken("Operator@Example.com", IDENTITY_SECRET);
  const payload = await verifyIdentityToken(token, IDENTITY_SECRET);
  assert.equal(payload?.email, "operator@example.com");
  assert.equal(await verifyIdentityToken(token, "wrong-secret"), null);
  assert.equal(await verifyIdentityToken(token + "x", IDENTITY_SECRET), null);
  // an expired token must fail
  const [body] = token.split(".");
  const raw = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { email: string; exp: number; v: number };
  raw.exp = Date.now() - 1000;
  const deadBody = Buffer.from(JSON.stringify(raw), "utf8").toString("base64url");
  const deadSig = createHmac("sha256", IDENTITY_SECRET).update(deadBody).digest("base64url");
  assert.equal(await verifyIdentityToken(`${deadBody}.${deadSig}`, IDENTITY_SECRET), null);
});

// ------------------------------------------------------------- password

test("the operator password check is exact", async () => {
  assert.equal(passwordMatches(ADMIN_PASSWORD, ADMIN_PASSWORD), true);
  assert.equal(passwordMatches("wrong", ADMIN_PASSWORD), false);
  assert.equal(passwordMatches(ADMIN_PASSWORD + " ", ADMIN_PASSWORD), false);
  assert.equal(passwordMatches("", ADMIN_PASSWORD), false);
});

test("adminLogin: only sg16global@gmail.com with the dashboard password; wrong ones 401, unconfigured 503", async () => {
  assert.equal(ADMIN_EMAIL, "sg16global@gmail.com");
  const ok = await adminLogin("SG16global@gmail.com ", "operator-password-123", "1.2.3.4", env());
  assert.ok(ok.ok && (ok as { token: string }).token);
  assert.equal((ok as { email: string }).email, "sg16global@gmail.com");

  const bad = await adminLogin("sg16global@gmail.com", "nope", "1.2.3.4", env());
  assert.equal(bad.ok, false);
  assert.equal((bad as { status: number }).status, 401);

  // any other email is refused, even with the right password
  const unknown = await adminLogin("intruder@example.com", "operator-password-123", "1.2.3.4", env());
  assert.equal((unknown as { status: number }).status, 401);

  // no password set in Cloudflare -> operator login is off
  const off = await adminLogin("sg16global@gmail.com", "operator-password-123", "1.2.3.4", env({ SG16_ADMIN_PASSWORD: undefined }));
  assert.equal((off as { status: number }).status, 503);

  // guess throttling: five failures then 429
  for (let i = 0; i < 5; i++) {
    await adminLogin("sg16global@gmail.com", "nope", "9.9.9.9", env());
  }
  const throttled = await adminLogin("sg16global@gmail.com", "nope", "9.9.9.9", env());
  assert.equal((throttled as { status: number }).status, 429);
});

// ------------------------------------------------------------ project keys

test("project keys mint and verify; a key signed by the OLD host code also verifies", async () => {
  const key = await createProjectKey("my-project", PROJECT_SECRET);
  assert.ok(key.startsWith("sg16p_"));
  const verified = await verifyProjectKey(key, PROJECT_SECRET, []);
  assert.equal(verified?.project, "my-project");

  // reproduce the old host's signing exactly (pointoni/src/lib/project-keys.ts)
  const payload = Buffer.from(
    JSON.stringify({ v: 1, p: "legacy-app", iat: 1700000000, n: randomBytes(6).toString("base64url") }),
    "utf8",
  ).toString("base64url");
  const sig = createHmac("sha256", PROJECT_SECRET).update(`sg16-project-key-v1|${payload}`).digest("base64url");
  const legacyKey = `sg16p_${payload}.${sig}`;
  assert.equal((await verifyProjectKey(legacyKey, PROJECT_SECRET, []))?.project, "legacy-app");
  assert.equal(await verifyProjectKey(legacyKey, PROJECT_SECRET, ["legacy-app"]), null);
  assert.equal(await verifyProjectKey(legacyKey, "other-secret", []), null);
  assert.equal(await verifyProjectKey("sg16p_garbage", PROJECT_SECRET, []), null);
});

test("authenticate accepts sg16p_ project keys through the /v1 path and revocation blocks them", async () => {
  const key = await createProjectKey("other-project", PROJECT_SECRET);
  const store = { get: async () => null };
  const auth = await authenticate(`Bearer ${key}`, store, PROJECT_SECRET, []);
  assert.ok(auth.ok);
  assert.equal(auth.ok ? auth.record.project : "", "other-project");

  const revoked = await authenticate(`Bearer ${key}`, store, PROJECT_SECRET, ["other-project"]);
  assert.equal(revoked.ok, false);

  const kvKey = "sg16_" + "0".repeat(32);
  const kvAuth = await authenticate(
    `Bearer ${kvKey}`,
    { get: async () => JSON.stringify({ id: "k", user: 1, project: "p", created: 0, revoked: false }) },
    PROJECT_SECRET,
    [],
  );
  assert.ok(kvAuth.ok, "existing sg16_ KV keys must keep working");
});

// ------------------------------------------------------------------ routes

test("GET /api/brain probes: turnstile off, health honest", async () => {
  const e = env();
  const ts = await designCompatRoute(new Request("https://x/api/brain?probe=turnstile"), "/api/brain", deps(e));
  assert.deepEqual(await ts?.json(), { enabled: false, siteKey: null });

  const up = await designCompatRoute(new Request("https://x/api/brain?probe=health"), "/api/brain", deps(e));
  assert.equal(up?.status, 200);
  assert.equal((await up?.json()).brain, "online");

  const down = await designCompatRoute(new Request("https://x/api/brain?probe=health"), "/api/brain", deps(e, undefined, false));
  assert.equal(down?.status, 503);
});

test("operator sign-in via POST /api/identity, then me, then project-key minting", async () => {
  const e = env();
  const login = await designCompatRoute(
    new Request("https://x/api/identity", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "5.5.5.5" },
      body: JSON.stringify({ action: "admin-login", email: "sg16global@gmail.com", password: "operator-password-123" }),
    }),
    "/api/identity",
    deps(e),
  );
  assert.equal(login?.status, 200);
  const { token } = (await login?.json()) as { token: string };

  const me = await designCompatRoute(
    new Request("https://x/api/identity", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "me" }),
    }),
    "/api/identity",
    deps(e),
  );
  const meBody = await me?.json();
  assert.equal(meBody.admin, true);
  assert.equal(meBody.email, "sg16global@gmail.com");

  // guard: without a token the mint must refuse
  const denied = await designCompatRoute(
    new Request("https://x/api/admin/project-keys", { method: "POST", body: JSON.stringify({ project: "x" }) }),
    "/api/admin/project-keys",
    deps(e),
  );
  assert.equal(denied?.status, 401);

  const mint = await designCompatRoute(
    new Request("https://x/api/admin/project-keys", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ project: "KidsApp" }),
    }),
    "/api/admin/project-keys",
    deps(e),
  );
  const mintBody = (await mint?.json()) as { project: string; key: string };
  assert.equal(mintBody.project, "kidsapp");
  assert.equal((await verifyProjectKey(mintBody.key, PROJECT_SECRET, []))?.project, "kidsapp");

  const state = await designCompatRoute(
    new Request("https://x/api/admin/project-keys", { headers: { authorization: `Bearer ${token}` } }),
    "/api/admin/project-keys",
    deps(e),
  );
  assert.equal((await state?.json()).configured, true);
});

test("project-key records: mint saves a fingerprint (never the key), GET lists, DELETE revokes", async () => {
  const e = env();
  const store = { get: async (k: string) => await e.KEYS.get(k) };
  const login = await designCompatRoute(
    new Request("https://x/api/identity", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "5.5.5.5" },
      body: JSON.stringify({ action: "admin-login", email: "sg16global@gmail.com", password: "operator-password-123" }),
    }),
    "/api/identity",
    deps(e),
  );
  const { token } = (await login?.json()) as { token: string };
  const auth = { "content-type": "application/json", authorization: `Bearer ${token}` };

  const mint = async (project: string) => {
    const res = await designCompatRoute(
      new Request("https://x/api/admin/project-keys", { method: "POST", headers: auth, body: JSON.stringify({ project }) }),
      "/api/admin/project-keys",
      deps(e),
    );
    return (await res?.json()) as { key: string };
  };
  const keyA = (await mint("shop-a")).key;
  const keyB = (await mint("shop-b")).key;

  // two fingerprint records exist, and neither contains the key itself
  const rawA = await store.get("projkey:" + (await keyHash(keyA)));
  const rawB = await store.get("projkey:" + (await keyHash(keyB)));
  assert.ok(rawA && rawB);
  assert.equal(rawA.includes(keyA), false);
  assert.equal(rawB.includes(keyB), false);

  // GET lists both, with the last-12 the operator recognizes
  const list = await designCompatRoute(
    new Request("https://x/api/admin/project-keys", { headers: auth }),
    "/api/admin/project-keys",
    deps(e),
  );
  const listBody = (await list?.json()) as { keys: { id: string; project: string; last12: string; revoked: boolean }[] };
  assert.equal(listBody.keys.length, 2);
  assert.deepEqual(listBody.keys.map((k) => k.project).sort(), ["shop-a", "shop-b"]);
  const recA = listBody.keys.find((k) => k.project === "shop-a");
  assert.equal(recA?.last12, keyA.slice(-12));
  assert.equal(recA?.revoked, false);

  // both keys authenticate on /v1 while unrevoked
  assert.ok((await authenticate(`Bearer ${keyA}`, store, PROJECT_SECRET, [])).ok);
  assert.ok((await authenticate(`Bearer ${keyB}`, store, PROJECT_SECRET, [])).ok);

  // DELETE by the full key: keyB dies, keyA lives
  const delB = await designCompatRoute(
    new Request(`https://x/api/admin/project-keys?key=${encodeURIComponent(keyB)}`, { method: "DELETE", headers: auth }),
    "/api/admin/project-keys",
    deps(e),
  );
  assert.equal(delB?.status, 200);
  assert.equal((await authenticate(`Bearer ${keyB}`, store, PROJECT_SECRET, [])).ok, false);
  assert.ok((await authenticate(`Bearer ${keyA}`, store, PROJECT_SECRET, [])).ok);

  // DELETE by fingerprint: keyA dies too
  const delA = await designCompatRoute(
    new Request(`https://x/api/admin/project-keys?id=${recA?.id}`, { method: "DELETE", headers: auth }),
    "/api/admin/project-keys",
    deps(e),
  );
  assert.equal(delA?.status, 200);
  assert.equal((await authenticate(`Bearer ${keyA}`, store, PROJECT_SECRET, [])).ok, false);

  // guards: no params 400, unknown fingerprint 404, no token 401
  const noParams = await designCompatRoute(
    new Request("https://x/api/admin/project-keys", { method: "DELETE", headers: auth }),
    "/api/admin/project-keys",
    deps(e),
  );
  assert.equal(noParams?.status, 400);
  const unknown = await designCompatRoute(
    new Request(`https://x/api/admin/project-keys?id=${"a".repeat(64)}`, { method: "DELETE", headers: auth }),
    "/api/admin/project-keys",
    deps(e),
  );
  assert.equal(unknown?.status, 404);
  const noToken = await designCompatRoute(
    new Request("https://x/api/admin/project-keys", { method: "DELETE" }),
    "/api/admin/project-keys",
    deps(e),
  );
  assert.equal(noToken?.status, 401);
});

// a pass record in exactly the shape the design pages send (X-SG16-Pass)
function passHeader(): string {
  const now = Math.floor(Date.now() / 1000);
  const expires = now + 24 * 3600;
  const nonce = randomBytes(18).toString("base64url");
  const token = createHmac("sha256", BILLING_SECRET).update(`sg16-pass-v1|day||3|${expires}|${nonce}`).digest("hex");
  const record = {
    pass: "day", label: "24-Hour Entry", provider: "dodo", region: null, list_price: 3,
    price_charged: 3, humanitarian_bypass: false, activated_at: now, expires_at: expires, nonce, token, verified_by: "sg16-host",
  };
  return Buffer.from(JSON.stringify(record)).toString("base64url");
}

test("POST /api/brain: a project body's Bearer key is its own work-tier bucket, not a free visitor", async () => {
  const e = env({ LOGS: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } as never });
  const key = await createProjectKey("sg16finance", PROJECT_SECRET);
  const call = async (authorization: string | null) => {
    let seen: { id: string; project: string } | null = null;
    const headers: Record<string, string> = { "content-type": "application/json", "cf-connecting-ip": "198.51.100.20" };
    if (authorization) headers.authorization = authorization;
    const res = await designCompatRoute(
      new Request("https://x/api/brain", { method: "POST", headers, body: JSON.stringify({ message: "hi" }) }),
      "/api/brain",
      deps(e, async (_payload: unknown, record: unknown) => {
        seen = record as { id: string; project: string };
        return Response.json({ ok: true, answer: "hello", meta: { engine: "model-vps", latency_ms: 7 } });
      }),
    );
    return { res: res!, record: seen as unknown as { id: string; project: string }, body: (await res!.json()) as { tier: string; signInRequired?: boolean } };
  };

  const keyed = await call(`Bearer ${key}`);
  assert.equal(keyed.res.status, 200);
  assert.equal(keyed.record.project, "sg16finance");
  assert.match(keyed.record.id, /^sg16p_sg16finance_/);
  assert.equal(keyed.body.tier, "work");
  assert.equal(keyed.res.headers.get("x-chat-tier"), "work");

  // a forged or unknown project key is never served: an honest key error, not "sign in"
  const forged = await call(`Bearer ${key.slice(0, -2)}xx`);
  assert.equal(forged.res.status, 403);
  assert.equal(forged.record, null);
  assert.equal((forged.body as { keyOff?: boolean }).keyOff, true);

  // a revoked project is not served either
  const revokedEnv = env({ SG16_REVOKED_PROJECTS: "sg16finance", LOGS: e.LOGS });
  const res = await designCompatRoute(
    new Request("https://x/api/brain", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ message: "hi" }) }),
    "/api/brain",
    deps(revokedEnv),
  );
  assert.equal(res!.status, 403);
  assert.equal(((await res!.json()) as { keyOff: boolean }).keyOff, true);
});

test("POST /api/brain: pass-gated ChatReply, ndjson stream, honest refusals", async () => {
  // the free trial switched off (FREE_TRIAL_DAYS "0"): the sign-in gate as before (trial.test.ts covers the trial)
  const e = env({ LOGS: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } as never, FREE_TRIAL_DAYS: "0" });

  // no pass and not signed in -> asked to sign in (free); the model is never called
  let doorCalls = 0;
  const anonymous = await designCompatRoute(
    new Request("https://x/api/brain", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
      body: JSON.stringify({ message: "hi" }),
    }),
    "/api/brain",
    deps(e, async () => {
      doorCalls += 1;
      return Response.json({ ok: true, answer: "x", meta: {} });
    }),
  );
  assert.equal(anonymous?.status, 401);
  const anonBody = (await anonymous?.json()) as { error: string; signInRequired: boolean; signInUrl: string };
  assert.equal(anonBody.signInRequired, true);
  assert.equal(anonBody.signInUrl, "/login");
  assert.match(anonBody.error, /Sign in free/);
  assert.equal(doorCalls, 0);

  // no pass but signed in -> the account's free tier: ChatReply under the standard host limits
  let freeRecord: unknown = null;
  const visitor = await signAccountToken("visitor@example.com", IDENTITY_SECRET);
  const noPass = await designCompatRoute(
    new Request("https://x/api/brain", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${visitor}` },
      body: JSON.stringify({ message: "hi" }),
    }),
    "/api/brain",
    deps(e, async (_payload: unknown, record: unknown) => {
      freeRecord = record;
      return Response.json({ ok: true, answer: "hello free", meta: { engine: "model-vps", latency_ms: 7 } });
    }),
  );
  assert.equal(noPass?.status, 200);
  const freeBody = (await noPass?.json()) as { assistantMessage: { content: string } };
  assert.equal(freeBody.assistantMessage.content, "hello free");
  // the free tier rides the account's own key record, project "web"
  const fr = freeRecord as { id: string; project: string; revoked: boolean };
  assert.match(fr.id, /^free_[0-9a-f]{12}$/);
  assert.equal(fr.project, "web");
  assert.equal(fr.revoked, false);

  // with a pass -> old ChatReply shape
  let doorPayload: unknown = null;
  const reply = await designCompatRoute(
    new Request("https://x/api/brain", {
      method: "POST",
      headers: { "content-type": "application/json", "x-sg16-pass": passHeader() },
      body: JSON.stringify({
        sessionId: "s-1",
        message: "what did I just say?",
        history: [
          { role: "user", content: "I said hello world" },
          { role: "assistant", content: "You said hello world" },
        ],
      }),
    }),
    "/api/brain",
    deps(e, async (payload: unknown, _record: unknown) => {
      doorPayload = payload;
      return Response.json({ ok: true, answer: "hello world", meta: { engine: "model-vps", latency_ms: 7 } });
    }),
  );
  const body = (await reply?.json()) as {
    sessionId: string; brain: string;
    userMessage: { role: string; content: string };
    assistantMessage: { content: string; latencyMs: number };
  };
  assert.equal(reply?.status, 200);
  assert.equal(body.sessionId, "s-1");
  assert.equal(body.brain, "model-vps");
  assert.equal(body.userMessage.role, "user");
  assert.equal(body.userMessage.content, "what did I just say?");
  assert.equal(body.assistantMessage.content, "hello world");
  assert.equal(body.assistantMessage.latencyMs, 7);
  // the remembered turns must reach the pipeline as real chat turns
  const door = doorPayload as { text: string; history: { role: string; content: string }[] };
  assert.equal(door.text, "what did I just say?");
  assert.ok(door.history.some((t) => t.role === "user" && t.content === "I said hello world"));

  // stream:true -> x-ndjson with one delta then done
  const stream = await designCompatRoute(
    new Request("https://x/api/brain", {
      method: "POST",
      headers: { "content-type": "application/json", "x-sg16-pass": passHeader() },
      body: JSON.stringify({ message: "hi", stream: true }),
    }),
    "/api/brain",
    deps(e),
  );
  assert.match(stream?.headers.get("content-type") ?? "", /x-ndjson/);
  const lines = ((await stream?.text()) ?? "").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines[0].type, "delta");
  assert.equal(lines[0].text, "hello");
  assert.equal(lines[1].type, "done");
  assert.equal(lines[1].assistantMessage.content, "hello");

  // core refusal codes map to the panel's honest error text
  const busy = await designCompatRoute(
    new Request("https://x/api/brain", {
      method: "POST",
      headers: { "content-type": "application/json", "x-sg16-pass": passHeader() },
      body: JSON.stringify({ message: "hi" }),
    }),
    "/api/brain",
    deps(e, async () => Response.json({ error: "queue", status: 429 }, { status: 429 })),
  );
  assert.equal(busy?.status, 429);
  assert.equal((await busy?.json()).rateLimited, true);

  // forgetSessionId (new chat) is a harmless ack
  const forget = await designCompatRoute(
    new Request("https://x/api/brain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ forgetSessionId: "old" }) }),
    "/api/brain",
    deps(e),
  );
  assert.equal((await forget?.json()).forgotten, true);
});

test("GET /api/models: one honest model; engines only for the operator", async () => {
  const e = env();
  const pub = await designCompatRoute(new Request("https://x/api/models"), "/api/models", deps(e));
  const pubBody = (await pub?.json()) as { models: { status: string }[] };
  assert.equal(pubBody.models.length, 1);
  assert.equal(pubBody.models[0].id, "sg16-brain");
  assert.equal(pubBody.models[0].status, "online");
  assert.equal("engines" in pubBody, false);

  const token = await signIdentityToken("sg16global@gmail.com", IDENTITY_SECRET);
  const admin = await designCompatRoute(
    new Request("https://x/api/models", { headers: { authorization: `Bearer ${token}` } }),
    "/api/models",
    deps(e),
  );
  const adminBody = (await admin?.json()) as { engines: unknown[] };
  assert.ok(Array.isArray(adminBody.engines) && adminBody.engines.length > 0);
});

// ---------------------------------------------------------------- rsc routes

const rscPayloads: Record<string, string> = {
  "/rsc/index.txt": "1:\"$Sreact.fragment\"\n0:{\"c\":[\"\"],\"b\":\"build\"}",
  "/rsc/admin.txt": "1:\"$Sreact.fragment\"\n0:{\"c\":[\"\",\"admin\"],\"b\":\"build\"}",
  "/rsc/vision.txt": "1:\"$Sreact.fragment\"\n0:{\"c\":[\"\",\"vision\"],\"b\":\"build\"}",
};

function fakeAssets(paths: Record<string, string>): { fetch: (input: string) => Promise<Response> } {
  return {
    fetch: async (input: string) => {
      const path = new URL(input).pathname;
      const body = paths[path];
      if (body === undefined) return new Response("Not Found", { status: 404 });
      return new Response(body, { status: 200 });
    },
  };
}

const rscRequest = (path: string, headers: Record<string, string> = {}) =>
  new Request("https://mistralbrain.com" + path, { headers });

test("rsc route serves the flight payload for a navigation request", async () => {
  const assets = fakeAssets(rscPayloads);
  const res = await designRscRoute(rscRequest("/admin", { rsc: "1" }), "/admin", assets as never);
  assert.ok(res);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/x-component");
  assert.equal(res.headers.get("x-nextjs-stale-time"), "300");
  assert.equal(await res.text(), rscPayloads["/rsc/admin.txt"]);
});

test("rsc route normalizes trailing slashes and serves the root payload", async () => {
  const assets = fakeAssets(rscPayloads);
  const slash = await designRscRoute(rscRequest("/admin/", { rsc: "1" }), "/admin/", assets as never);
  assert.ok(slash && (await slash.text()) === rscPayloads["/rsc/admin.txt"]);
  const root = await designRscRoute(rscRequest("/", { rsc: "1" }), "/", assets as never);
  assert.ok(root && (await root.text()) === rscPayloads["/rsc/index.txt"]);
});

test("rsc route ignores non-navigation requests", async () => {
  const assets = fakeAssets(rscPayloads);
  // no rsc header: a normal browser page load
  assert.equal(await designRscRoute(rscRequest("/admin"), "/admin", assets as never), null);
  // server actions are not part of the static design
  assert.equal(await designRscRoute(rscRequest("/admin", { rsc: "1", "next-action": "x" }), "/admin", assets as never), null);
  // POST navigations do not exist
  const post = new Request("https://mistralbrain.com/admin", { method: "POST", headers: { rsc: "1" } });
  assert.equal(await designRscRoute(post, "/admin", assets as never), null);
});

test("rsc route declines unknown and nested routes, and missing payloads", async () => {
  const assets = fakeAssets(rscPayloads);
  assert.equal(await designRscRoute(rscRequest("/secret", { rsc: "1" }), "/secret", assets as never), null);
  assert.equal(await designRscRoute(rscRequest("/admin/nested", { rsc: "1" }), "/admin/nested", assets as never), null);
  const empty = fakeAssets({});
  assert.equal(await designRscRoute(rscRequest("/vision", { rsc: "1" }), "/vision", empty as never), null);
});

// ---------------------------------------------------------------- project activity (admin box)

test("project activity: live / active / idle / never / blocked, legacy keys from the log, sorted", () => {
  const now = 10 * 24 * 3600 * 1000;
  const rec = (project: string, last12: string, revoked = false) => ({ id: "f".repeat(64), project, created: 1, last12, revoked });
  const row = (project: string, last12: string, ago: number, calls = 3, errors = 1) =>
    ({ key_id: `sg16p_${project}_${last12}`, project, last_ts: now - ago, calls_24h: calls, errors_24h: errors, avg_ms_24h: 4100.4 });
  const out = projectActivity(
    [rec("shop", "aaaaaaaaaaaa"), rec("blog", "bbbbbbbbbbbb"), rec("old", "cccccccccccc"),
     rec("fresh", "dddddddddddd"), rec("gone", "eeeeeeeeeeee", true), rec("banned", "ffffffffffff")],
    [row("shop", "aaaaaaaaaaaa", 12_000), row("blog", "bbbbbbbbbbbb", 2 * 3600 * 1000),
     row("old", "cccccccccccc", 3 * 24 * 3600 * 1000, 0, 0), row("legacy", "zzzzzzzzzzzz", LIVE_WINDOW_MS - 1)],
    ["banned"],
    now,
  );
  const status = Object.fromEntries(out.map((p) => [p.project, p.status]));
  // a revoked record is a retired key: BROKEN; a project stopped in SG16_REVOKED_PROJECTS: BLOCKED
  assert.deepEqual(status, { shop: "live", legacy: "live", blog: "active", old: "idle", fresh: "never", gone: "broken", banned: "blocked" });
  assert.equal(out.find((p) => p.project === "shop")!.id, "sg16p_shop_aaaaaaaaaaaa");
  assert.equal(out.find((p) => p.project === "shop")!.control, "on");
  assert.equal(out.find((p) => p.project === "gone")!.control, "broken");
  assert.deepEqual(out.slice(0, 2).map((p) => p.project), ["shop", "legacy"], "live first, most recent call first");
  const shop = out.find((p) => p.project === "shop")!;
  assert.equal(shop.calls24h, 3);
  assert.equal(shop.errors24h, 1);
  assert.equal(shop.avgMs24h, 4100);
  assert.equal(out.find((p) => p.project === "legacy")!.last12, "zzzzzzzzzzzz");
  assert.equal(out.find((p) => p.project === "fresh")!.lastCall, null);
});

test("project activity route: operator only, reads the request log", async () => {
  let boundArgs: unknown[] = [];
  const logs = {
    prepare: (sql: string) => {
      assert.match(sql, /FROM requests/);
      const stmt = {
        bind: (...args: unknown[]) => { boundArgs = args; return stmt; },
        all: async () => ({ results: [{ key_id: "sg16p_shop_aaaaaaaaaaaa", project: "shop", last_ts: Date.now(), calls_24h: 5, errors_24h: 0, avg_ms_24h: 900 }] }),
      };
      return stmt;
    },
  };
  const e = env({ LOGS: logs as never });
  const denied = await designCompatRoute(new Request("https://x/api/admin/project-activity"), "/api/admin/project-activity", deps(e));
  assert.equal(denied?.status, 401);

  const login = await designCompatRoute(
    new Request("https://x/api/identity", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "6.6.6.6" },
      body: JSON.stringify({ action: "admin-login", email: "sg16global@gmail.com", password: "operator-password-123" }),
    }),
    "/api/identity",
    deps(e),
  );
  const { token } = (await login?.json()) as { token: string };
  const res = await designCompatRoute(
    new Request("https://x/api/admin/project-activity", { headers: { authorization: `Bearer ${token}` } }),
    "/api/admin/project-activity",
    deps(e),
  );
  assert.equal(res?.status, 200);
  const body = (await res?.json()) as { projects: { project: string; status: string; calls24h: number }[] };
  assert.deepEqual(body.projects.map((p) => [p.project, p.status, p.calls24h]), [["shop", "live", 5]]);
  assert.equal(boundArgs.length, 2, "24h window + lookback window are bound");
});

test("/api/brain with a project key: message, system and history go through as sent (no SG16 history wrapper)", async () => {
  const e = env();
  const key = await createProjectKey("sg16engine", PROJECT_SECRET);
  const seen: Array<Record<string, unknown>> = [];
  const door = async (payload: Record<string, unknown>) => {
    seen.push(payload);
    return Response.json({ ok: true, answer: "hi", meta: { engine: "model-vps", latency_ms: 5 } });
  };
  const history = [{ role: "user", content: "earlier" }, { role: "assistant", content: "reply" }];
  const keyed = await designCompatRoute(
    new Request("https://x/api/brain", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ message: "now", system: "Project rules here.", history }),
    }),
    "/api/brain",
    deps(e, door),
  );
  assert.equal(keyed?.status, 200);
  assert.deepEqual(seen[0], { kind: "chat", text: "now", system: "Project rules here.", history });

  // a website visitor (signed in, no key) keeps the SG16 folded memory and cannot send rules
  const visitorToken = await signAccountToken("visitor@example.com", IDENTITY_SECRET);
  const visitor = await designCompatRoute(
    new Request("https://x/api/brain", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${visitorToken}` },
      body: JSON.stringify({ message: "now", system: "Project rules here.", history }),
    }),
    "/api/brain",
    deps(e, door),
  );
  assert.equal(visitor?.status, 200);
  assert.equal(seen[1].system, undefined);
  assert.equal(seen[1].text, "now");
  assert.ok(Array.isArray(seen[1].history) && (seen[1].history as unknown[]).length > 0, "visitors keep their recent turns");
});
