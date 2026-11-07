// The operator's gateway on /admin: BRAIN SERVER (any server, no redeploy),
// PROJECT RULES (every API project independent) and key rotation.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
import type { Env } from "../src/index.ts";
import { InferenceGate } from "../src/inference-gate.ts";
import { KeyState, newRow } from "../src/matrix-do.ts";
import type { MatrixRow } from "../src/matrix-do.ts";
import { balanceOf } from "../src/tokens.ts";
import { signIdentityToken, ADMIN_EMAIL } from "../src/design-compat.ts";
import { normalizeServerUrl, SERVER_KEY } from "../src/admin-gateway.ts";

const IDENTITY_SECRET = "gateway-test-identity-secret-0123456789";
const PROJECT_SECRET = "gateway-test-project-key-secret-0123456789";
const MODEL = "saiftechglobal/sg16-brain:Q4_K_M";

class FakeKV {
  map = new Map<string, string>();
  async get(k: string) { return this.map.get(k) ?? null; }
  async put(k: string, v: string) { this.map.set(k, v); }
  async delete(k: string) { this.map.delete(k); }
  async list(opts: { prefix?: string } = {}) {
    const keys = [...this.map.keys()].filter((k) => k.startsWith(opts.prefix ?? "")).sort().map((name) => ({ name }));
    return { keys, list_complete: true, cursor: "" };
  }
}

class FakeD1 {
  prepare(_sql: string) {
    const stmt = { bind: () => stmt, run: async () => ({}), first: async () => ({}), all: async () => ({ results: [] }) };
    return stmt;
  }
  async batch(statements: unknown[]) { return statements.map(() => ({})); }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function queueNamespace(gate: InferenceGate) {
  return {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (url: string, init?: RequestInit): Promise<Response> => {
        const path = new URL(url).pathname;
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (path === "/power") return json({ on: true });
        if (path === "/acquire") return json(gate.acquire(body.waitBudgetMs));
        if (path === "/poll") return json(gate.poll(body.ticket));
        if (path === "/release") return json({ released: gate.release(body.ticket) });
        if (path === "/abandon") { gate.abandon(body.ticket); return json({ abandoned: true }); }
        if (path === "/stats") return json(gate.stats());
        return json({ ok: false }, 404);
      },
    }),
  };
}

function matrixNamespace() {
  const rows = new Map<string, MatrixRow>();
  return {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (url: string, init?: RequestInit): Promise<Response> => {
        const path = new URL(url).pathname;
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (!rows.has(body.key_id)) rows.set(body.key_id, newRow(body.key_id, body.project, body.now));
        const ks = new KeyState(rows.get(body.key_id)!);
        if (path === "/check") {
          const verdict = ks.check(body.now, body.rpm);
          if (verdict.allowed) ks.consume(body.now);
          return json(verdict);
        }
        if (path === "/tokens/balance" || path === "/tokens/spend") return json(balanceOf(ks.row.tokens_used ?? 0, body.allowance));
        return json({ ok: false }, 404);
      },
    }),
  };
}

/** every request the Worker sends to a brain server */
interface Sent { url: string; headers: Headers; body: { messages?: Array<{ role: string; content: string }> } | null }
let sent: Sent[] = [];
let answer = "the answer";
let installed = [MODEL];
const realFetch = globalThis.fetch;

beforeEach(() => {
  sent = [];
  answer = "the answer";
  installed = [MODEL];
});

function makeEnv(overrides: Partial<Env> = {}) {
  const kv = new FakeKV();
  const env = {
    KEYS: kv as unknown as KVNamespace,
    LOGS: new FakeD1() as unknown as D1Database,
    QUEUE: queueNamespace(new InferenceGate({ waitBudgetMs: 5000, leaseMs: 60000 })) as unknown as DurableObjectNamespace,
    MATRIX: matrixNamespace() as unknown as DurableObjectNamespace,
    MODEL_URL: "https://deploy-server.example",
    MODEL_NAME: MODEL,
    MODEL_NUM_CTX: "8192",
    MAX_OUTPUT_CHARS: "1000",
    INFERENCE_TIMEOUT_MS: "5000",
    MAX_QUEUE_WAIT_MS: "5000",
    SG16_IDENTITY_SECRET: IDENTITY_SECRET,
    SG16_PROJECT_KEY_SECRET: PROJECT_SECRET,
    CF_ACCESS_CLIENT_ID: "deploy-id.access",
    CF_ACCESS_CLIENT_SECRET: "deploy-access-secret",
    ...overrides,
  } as Env;
  (globalThis.fetch as unknown) = async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    if (!href.includes("example")) return realFetch(url as never, init);
    sent.push({ url: href, headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (href.endsWith("/api/tags")) return json({ models: installed.map((name) => ({ name, model: name })) });
    if (href.endsWith("/api/chat")) return json({ message: { content: answer } });
    return json({}, 404);
  };
  return { env, kv };
}

const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); return p; } } as unknown as ExecutionContext;

async function call(env: Env, path: string, method: string, bearer: string | null, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return worker.fetch!(
    new Request(`https://brain.example.org${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
    ctx,
  );
}

const operator = () => signIdentityToken(ADMIN_EMAIL, IDENTITY_SECRET);

async function mintKey(env: Env, project: string): Promise<{ key: string; id: string }> {
  const op = await operator();
  const res = await call(env, "/api/admin/project-keys", "POST", op, { project });
  assert.equal(res.status, 200);
  const { key } = await res.json() as { key: string };
  const list = await (await call(env, "/api/admin/project-keys", "GET", op)).json() as { keys: Array<{ id: string; last12: string }> };
  const id = list.keys.find((k) => k.last12 === key.slice(-12))!.id;
  return { key, id };
}

// ---- operator only ---------------------------------------------------------

test("gateway routes answer only the signed-in operator", async () => {
  const { env } = makeEnv();
  const visitor = await signIdentityToken("someone@example.com", IDENTITY_SECRET);
  for (const path of ["/api/admin/brain-server", "/api/admin/project-rules"]) {
    assert.equal((await call(env, path, "GET", null)).status, 401);
    assert.equal((await call(env, path, "GET", visitor)).status, 403);
  }
  assert.equal((await call(env, "/api/admin/brain-server/test", "POST", null, { url: "https://x.example" })).status, 401);
});

// ---- BRAIN SERVER ------------------------------------------------------------

test("server address: https any host, http only on this machine, no credentials or query in the URL", () => {
  assert.equal(normalizeServerUrl("https://brain.my-vps.example/"), "https://brain.my-vps.example");
  assert.equal(normalizeServerUrl(" https://host.example:8443/ollama// "), "https://host.example:8443/ollama");
  assert.equal(normalizeServerUrl("http://127.0.0.1:11434"), "http://127.0.0.1:11434");
  assert.equal(normalizeServerUrl("http://localhost:11434/"), "http://localhost:11434");
  assert.equal(normalizeServerUrl("http://203.0.113.9:11434"), null, "plain http over the internet is refused");
  assert.equal(normalizeServerUrl("https://user:pw@host.example"), null);
  assert.equal(normalizeServerUrl("https://host.example/?x=1"), null);
  assert.equal(normalizeServerUrl("ftp://host.example"), null);
  assert.equal(normalizeServerUrl(""), null);
  assert.equal(normalizeServerUrl(42), null);
});

test("no saved server: the MODEL_URL deploy setting and deploy secrets are used", async () => {
  const { env } = makeEnv();
  const res = await call(env, "/api/admin/brain-server", "GET", await operator());
  const data = await res.json() as { source: string; url: string; credentials: string; probe: { modelInstalled: boolean } };
  assert.equal(data.source, "deploy");
  assert.equal(data.url, "https://deploy-server.example");
  assert.equal(data.credentials, "deploy");
  assert.equal(data.probe.modelInstalled, true);
  assert.equal(sent[0].url, "https://deploy-server.example/api/tags");
  assert.equal(sent[0].headers.get("CF-Access-Client-Id"), "deploy-id.access");
});

test("saving a new server moves chat and health to it at once, with no redeploy", async () => {
  const { env } = makeEnv();
  const op = await operator();
  const saved = await call(env, "/api/admin/brain-server", "POST", op, { url: "https://new-vps.example/", credentials: "deploy" });
  assert.equal(saved.status, 200);
  const data = await saved.json() as { source: string; url: string; probe: { reachable: boolean; modelInstalled: boolean } };
  assert.equal(data.source, "admin");
  assert.equal(data.url, "https://new-vps.example");
  assert.equal(data.probe.reachable, true);
  assert.equal(data.probe.modelInstalled, true);

  sent = [];
  const { key } = await mintKey(env, "shop");
  const chat = await call(env, "/v1/ask", "POST", key, { text: "hello" });
  assert.equal(chat.status, 200);
  assert.equal(sent.at(-1)!.url, "https://new-vps.example/api/chat");
  assert.equal(sent.at(-1)!.headers.get("CF-Access-Client-Id"), "deploy-id.access", "deploy mode keeps the Cloudflare secrets");

  sent = [];
  const health = await (await call(env, "/v1/health", "GET", null)).json() as { model: boolean };
  assert.equal(health.model, true);
  assert.equal(sent[0].url, "https://new-vps.example/api/tags");

  // back to the deploy setting
  const reset = await call(env, "/api/admin/brain-server", "DELETE", op);
  assert.equal((await reset.json() as { source: string }).source, "deploy");
  sent = [];
  await call(env, "/v1/ask", "POST", key, { text: "hello again" });
  assert.equal(sent.at(-1)!.url, "https://deploy-server.example/api/chat");
});

test("custom credentials are stored encrypted, sent to the server, never shown, and kept when left blank", async () => {
  const { env, kv } = makeEnv();
  const op = await operator();
  const res = await call(env, "/api/admin/brain-server", "POST", op, {
    url: "https://other-vps.example",
    credentials: "custom",
    accessClientId: "new-id.access",
    accessClientSecret: "very-secret-access-value",
    sharedSecret: "very-secret-bearer-value",
  });
  assert.equal(res.status, 200);
  const raw = kv.map.get(SERVER_KEY)!;
  assert.ok(!raw.includes("very-secret"), "secrets are not stored in plain text");
  const shown = JSON.stringify(await res.json());
  assert.ok(!shown.includes("very-secret"), "secrets never go back to the browser");
  assert.match(shown, /"accessClientSecret":true/);

  sent = [];
  const { key } = await mintKey(env, "crm");
  await call(env, "/v1/ask", "POST", key, { text: "hello" });
  const last = sent.at(-1)!;
  assert.equal(last.url, "https://other-vps.example/api/chat");
  assert.equal(last.headers.get("CF-Access-Client-Id"), "new-id.access");
  assert.equal(last.headers.get("CF-Access-Client-Secret"), "very-secret-access-value");
  assert.equal(last.headers.get("authorization"), "Bearer very-secret-bearer-value");

  // change only the address: blank secrets keep the saved ones
  await call(env, "/api/admin/brain-server", "POST", op, { url: "https://moved-vps.example", credentials: "custom", accessClientId: "new-id.access" });
  sent = [];
  await call(env, "/v1/ask", "POST", key, { text: "hello" });
  assert.equal(sent.at(-1)!.url, "https://moved-vps.example/api/chat");
  assert.equal(sent.at(-1)!.headers.get("CF-Access-Client-Secret"), "very-secret-access-value");

  // a server with no door credentials at all
  await call(env, "/api/admin/brain-server", "POST", op, { url: "http://127.0.0.1:11434", credentials: "none" });
  const state = await (await call(env, "/api/admin/brain-server", "GET", op)).json() as { credentials: string };
  assert.equal(state.credentials, "none");
});

test("test a server without saving it; bad input is refused", async () => {
  const { env, kv } = makeEnv();
  const op = await operator();
  installed = ["some-other-model:latest"];
  const res = await call(env, "/api/admin/brain-server/test", "POST", op, { url: "https://candidate.example" });
  const data = await res.json() as { saved: boolean; probe: { reachable: boolean; modelInstalled: boolean; installed: string[] } };
  assert.equal(data.saved, false);
  assert.equal(data.probe.reachable, true);
  assert.equal(data.probe.modelInstalled, false, "a server without the SG16 Brain is not ready");
  assert.deepEqual(data.probe.installed, ["some-other-model:latest"]);
  assert.equal(kv.map.has(SERVER_KEY), false);

  assert.equal((await call(env, "/api/admin/brain-server", "POST", op, { url: "http://203.0.113.9:11434" })).status, 400);
  assert.equal((await call(env, "/api/admin/brain-server", "POST", op, { url: "https://x.example", credentials: "maybe" })).status, 400);
  assert.equal((await call(env, "/api/admin/brain-server", "POST", op, { url: "https://x.example", credentials: "custom", sharedSecret: "has space" })).status, 400);
});

// ---- PROJECT RULES -------------------------------------------------------------

test("a project's stored rules go to the brain first, then the rules the call sends", async () => {
  const { env } = makeEnv();
  const op = await operator();
  const { key } = await mintKey(env, "shop");
  const saved = await call(env, "/api/admin/project-rules", "POST", op, {
    project: "shop", system: "You are the Shop assistant. Answer about orders only.", rpm: 30, max_queue_ms: 3000,
  });
  assert.equal(saved.status, 200);

  await call(env, "/v1/ask", "POST", key, { text: "where is my order", system: "Customer tier: gold." });
  const messages = sent.at(-1)!.body!.messages!;
  assert.equal(messages[0].role, "system");
  assert.equal(messages[0].content, "You are the Shop assistant. Answer about orders only.\n\nCustomer tier: gold.");
  assert.ok(!messages[0].content.includes("SG16 Brain"), "the website's own rules never reach an API project");

  const read = await (await call(env, "/api/admin/project-rules?project=shop", "GET", op)).json() as { custom: boolean; rules: { rpm: number } };
  assert.equal(read.custom, true);
  assert.equal(read.rules.rpm, 30);
  const all = await (await call(env, "/api/admin/project-rules", "GET", op)).json() as { projects: Array<{ project: string }> };
  assert.deepEqual(all.projects.map((p) => p.project), ["shop"]);
});

test("a project's own limits apply to it alone: rate limit and JSON-only", async () => {
  const { env } = makeEnv();
  const op = await operator();
  const shop = await mintKey(env, "shop");
  const other = await mintKey(env, "other");
  await call(env, "/api/admin/project-rules", "POST", op, { project: "shop", rpm: 1, require_json: true });

  answer = "{\"answer\":\"ok\"}";
  assert.equal((await call(env, "/v1/ask", "POST", shop.key, { text: "one" })).status, 200);
  assert.equal((await call(env, "/v1/ask", "POST", shop.key, { text: "two" })).status, 429, "shop: 1 request per minute");
  answer = "plain text";
  assert.equal((await call(env, "/v1/ask", "POST", other.key, { text: "one" })).status, 200);
  assert.equal((await call(env, "/v1/ask", "POST", other.key, { text: "two" })).status, 200, "other projects keep the defaults");
});

test("project rules: validation, the reserved website name, and reset to defaults", async () => {
  const { env, kv } = makeEnv();
  const op = await operator();
  const bad = [
    { project: "web", system: "x" },
    { project: "Not Valid", system: "x" },
    { project: "shop", rpm: 0 },
    { project: "shop", rpm: 1.5 },
    { project: "shop", max_queue_ms: 999999 },
    { project: "shop", blocked_patterns: ["(unclosed"] },
    { project: "shop", system: "x".repeat(16385) },
    { project: "shop", require_json: "yes" },
  ];
  for (const body of bad) assert.equal((await call(env, "/api/admin/project-rules", "POST", op, body)).status, 400, JSON.stringify(body).slice(0, 60));
  assert.equal((await call(env, "/api/admin/project-keys", "POST", op, { project: "web" })).status, 400, "no project key may be named after the website");

  await call(env, "/api/admin/project-rules", "POST", op, { project: "shop", blocked_patterns: ["secret-word"] });
  assert.ok(kv.map.has("policy:shop"));
  const { key } = await mintKey(env, "shop");
  assert.equal((await call(env, "/v1/ask", "POST", key, { text: "tell me the secret-word" })).status, 403);
  const reset = await call(env, "/api/admin/project-rules?project=shop", "DELETE", op);
  assert.equal((await reset.json() as { custom: boolean }).custom, false);
  assert.equal(kv.map.has("policy:shop"), false);
  assert.equal((await call(env, "/v1/ask", "POST", key, { text: "tell me the secret-word" })).status, 200);
});

// ---- key rotation --------------------------------------------------------------

test("rotate: the project gets a new key and the old one stops at the same moment", async () => {
  const { env } = makeEnv();
  const op = await operator();
  const old = await mintKey(env, "shop");
  assert.equal((await call(env, "/v1/ask", "POST", old.key, { text: "hi" })).status, 200);

  const res = await call(env, "/api/admin/project-keys", "POST", op, { rotate: old.id });
  assert.equal(res.status, 200);
  const rotated = await res.json() as { project: string; key: string; replaced: string };
  assert.equal(rotated.project, "shop");
  assert.notEqual(rotated.key, old.key);
  assert.equal(rotated.replaced, old.id);

  assert.equal((await call(env, "/v1/ask", "POST", old.key, { text: "hi" })).status, 401, "old key retired");
  assert.equal((await call(env, "/v1/ask", "POST", rotated.key, { text: "hi" })).status, 200, "new key works");
  assert.equal((await call(env, "/api/admin/project-keys", "POST", op, { rotate: old.id })).status, 409, "a retired key cannot be rotated again");
  assert.equal((await call(env, "/api/admin/project-keys", "POST", op, { rotate: "nope" })).status, 400);

  // by the switch id the Connected projects list shows
  const switchId = `sg16p_shop_${rotated.key.slice(-12)}`;
  const again = await call(env, "/api/admin/project-keys", "POST", op, { rotate: switchId });
  assert.equal(again.status, 200);
  const third = await again.json() as { project: string; key: string };
  assert.equal(third.project, "shop");
  assert.equal((await call(env, "/v1/ask", "POST", rotated.key, { text: "hi" })).status, 401);
  assert.equal((await call(env, "/v1/ask", "POST", third.key, { text: "hi" })).status, 200);
});
