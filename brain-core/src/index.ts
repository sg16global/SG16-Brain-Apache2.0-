// SG16 BRAIN CORE — Cloudflare Worker. The deterministic brain: keys, routing,
// state matrix, scoring, verification, queue discipline, logging.
//
// Flow per request (see docs/BRAIN-CORE-REBUILD.md):
//   1. hit this Worker on the brain domain
//   2. validate the API key against KV (owner = user #1, same path as everyone)
//   3. route: math/logic/state/scoring computed HERE; only language generation
//      is forwarded to the inference-only VPS through the tunnel, one at a time
//   4. the core verifies every model output; retry once, else reject.
//      Optional self-check (SELF_CHECK="true"): the model re-reads its own
//      draft and corrects it first — off by default, it doubles answer time
//
// All errors are machine codes with standard HTTP status; no human-language
// sentences leave the core.

import { authenticate, loadPolicy, parseAsk } from "./auth.ts";
import { detectScript } from "./detect.ts";
import { systemPrompt, messagesFor, apiMessages, checkMessages } from "./prompt.ts";
import { verifyOutput, requestAllowed } from "./verify.ts";
import { callModel, ModelError } from "./model-client.ts";
import { freeTokenAllowance, type TokenBalance } from "./tokens.ts";
import type { SendEmailBinding } from "./accounts.ts";
import { withByteRange } from "./media-range.ts";
import { logRequest, logHistory } from "./d1.ts";
import { newKey, keyHash, sha256 } from "./keys.ts";
import { billingRoute } from "./billing-routes.ts";
import { clientRoute, resolvePass, passKeyRecord, refuseStage } from "./client-routes.ts";
import { designCompatRoute, designRscRoute, PROJECT_KEY_PREFIX, revokeProjectKey } from "./design-compat.ts";
import { projectScanRoute } from "./project-scan.ts";
import { compatError, modelList, parseChatCompletions, toChatCompletion } from "./openai-compat.ts";
import type { AskMeta, ErrorBody, KeyRecord, Policy } from "./types.ts";
import { DEFAULT_POLICY } from "./types.ts";

// Durable Object classes must be exported from the worker entry point
export { InferenceQueueDO } from "./inference-queue-do.ts";
export { MatrixDO } from "./matrix-do.ts";

export interface Env {
  KEYS: KVNamespace;
  LOGS: D1Database;
  QUEUE: DurableObjectNamespace;
  MATRIX: DurableObjectNamespace;

  ASSETS: Fetcher;              // the staged web client (scripts/sync-web.mjs)

  MODEL_PROVIDER: "ollama" | "llamacpp";
  MODEL_URL: string;              // set via wrangler var after the tunnel exists
  MODEL_HEALTH_PATH: string;      // ollama: /api/tags | llamacpp: /health
  MODEL_NAME: string;            // the one brain: SG16 Brain Q4_K_M (brain-core/model/Modelfile)
  MODEL_NUM_CTX: string;
  MAX_OUTPUT_CHARS: string;
  INFERENCE_TIMEOUT_MS: string;
  MAX_QUEUE_WAIT_MS: string;
  SELF_CHECK?: string;           // "true" = second model pass per answer (2x slower); default off
  FREE_TOKEN_ALLOWANCE?: string; // one-time free model tokens per free-tier visitor; then a pass is required

  // billing (Dodo Payments MoR pipeline — see billing-routes.ts)
  DODO_TEST_MODE?: string;
  DODO_PRODUCT_IDS?: string;
  ALLOWED_RETURN_ORIGINS?: string;
  DODO_API_KEY?: string;
  DODO_WEBHOOK_SECRET?: string;
  BILLING_SECRET?: string;

  // secrets (wrangler secret put ...) — no third-party AI API secret exists;
  // every inference is self-hosted on the VPS
  MODEL_SHARED_SECRET?: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;

  // design-page secrets (see design-compat.ts); the identity and project-key
  // secrets are the same values the old host used
  SG16_IDENTITY_SECRET?: string;
  /** the operator's password (sg16global@gmail.com), set in the Cloudflare dashboard */
  SG16_ADMIN_PASSWORD?: string;
  SG16_PROJECT_KEY_SECRET?: string;

  // visitor sign-in codes: Cloudflare Email Sending (send_email binding) + sender
  EMAIL?: SendEmailBinding;
  EMAIL_FROM?: string;
  SG16_REVOKED_PROJECTS?: string;
}

// Baseline security headers on every response, /api and /v1 included - the
// same set and values the old host sent (pointoni/next.config.ts, Task 25).
const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

export function withSecurityHeaders(response: Response): Response {
  // asset and redirect responses carry immutable headers: copy, then set
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!out.headers.has(name)) out.headers.set(name, value);
  }
  return out;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return withSecurityHeaders(await route(request, env, ctx));
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const started = Date.now();
  const url = new URL(request.url);
  const path = url.pathname;
  // www.<domain> -> <domain>, for whichever domain the Worker is given
  if (url.hostname.startsWith("www.")) {
    return Response.redirect("https://" + url.hostname.slice(4) + path + url.search, 308);
  }
  try {
    if (request.method === "GET" && path === "/v1/health") return await health(env, started);
    if (path.startsWith("/api/")) {
      const design = await designCompatRoute(request, path, {
        env,
        chatDoor: (payload, record) => askParsed(payload, env, ctx, record, started),
        healthProbe: async () => {
          const probe = await healthProbe(env);
          return { d1: probe.d1, model: probe.model, power: probe.power };
        },
        brainPower: {
          get: async () => (await queueDo(env, "/power")).on !== false,
          set: async (on: boolean) => (await queueDo(env, "/power", { on })).on !== false,
        },
        freeTokens: async (record) =>
          (await tokenBalance(env, record, freeTokenAllowance(env.FREE_TOKEN_ALLOWANCE))).remaining,
        keyAuth: async (authorization) => {
          if (!authorization) return null;
          const auth = await authenticate(authorization, env.KEYS, env.SG16_PROJECT_KEY_SECRET, revokedProjectList(env));
          return auth.ok ? auth.record : null;
        },
      });
      if (design) return design;
      const scan = await projectScanRoute(request, path);
      if (scan) return scan;
      const billed = await billingRoute(request, env, path);
      if (billed) return billed;
      const client = await clientRoute(request, env, path, async () => {
        const probe = await healthProbe(env);
        return { d1: probe.d1, model: probe.model, power: probe.power };
      });
      if (client) return client;
    }
    if (request.method === "POST" && path === "/api/ingest") {
      return await ingest(request, env, ctx, started);
    }
    if (request.method === "POST" && (path === "/v1/ask" || path === "/v1/keys")) {
      return await withAuth(request, env, async (record) => {
        if (path === "/v1/keys") return await rotateKey(request, env, ctx, record, started);
        return await ask(request, env, ctx, record, started);
      });
    }
    if (request.method === "GET" && path === "/v1/state") {
      return await withAuth(request, env, async (record) => matrixState(env, record));
    }
    // OpenAI-compatible door (openai-compat.ts): same pipeline as /v1/ask
    if ((request.method === "POST" && path === "/v1/chat/completions") || (request.method === "GET" && path === "/v1/models")) {
      const auth = await authenticate(
        request.headers.get("authorization"),
        env.KEYS,
        env.SG16_PROJECT_KEY_SECRET,
        revokedProjectList(env),
      );
      if (!auth.ok) return compatError(401, "Invalid API key.");
      if (path === "/v1/models") return modelList();
      const parsed = parseChatCompletions(await request.json().catch(() => null));
      if (!parsed.ok) return compatError(parsed.status, parsed.message, parsed.param);
      return await toChatCompletion(await askParsed(parsed.ask, env, ctx, auth.record, started));
    }
    if (path.startsWith("/api/") || path.startsWith("/v1/")) return jsonError(404, "E_NOT_FOUND");
    const rsc = await designRscRoute(request, path, env.ASSETS);
    if (rsc) return rsc;
    // the staged web client (static assets); media files answer byte ranges (Safari)
    return await withByteRange(request, await env.ASSETS.fetch(request));
  } catch (e) {
    if (e instanceof HttpError) return jsonError(e.status, e.code);
    return jsonError(500, "E_INTERNAL");
  }
}

// ---------------------------------------------------------------------------

class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

function jsonError(status: number, code: string): Response {
  const body: ErrorBody = { ok: false, code };
  return Response.json(body, { status, headers: { "content-type": "application/json" } });
}

async function withAuth(
  request: Request,
  env: Env,
  handler: (record: KeyRecord) => Promise<Response>,
): Promise<Response> {
  const auth = await authenticate(
    request.headers.get("authorization"),
    env.KEYS,
    env.SG16_PROJECT_KEY_SECRET,
    revokedProjectList(env),
  );
  if (!auth.ok) return auth.off ? jsonError(403, "E_KEY_OFF") : jsonError(401, "E_UNAUTHORIZED");
  return handler(auth.record);
}

function revokedProjectList(env: Env): string[] {
  return (env.SG16_REVOKED_PROJECTS ?? "").split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);
}

async function ask(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  record: KeyRecord,
  started: number,
): Promise<Response> {
  const body = await request.json().catch(() => null);
  return askParsed(body, env, ctx, record, started);
}

// The chat pipeline, shared by /v1/ask and the panel's pass-gated
// /api/ingest door (client-routes.ts feeds it a pass-derived record).
async function askParsed(
  body: unknown,
  env: Env,
  ctx: ExecutionContext,
  record: KeyRecord,
  started: number,
): Promise<Response> {
  const parsed = parseAsk(body);
  if (!parsed) return await finish(env, ctx, record, "chat", "none", 400, started, 0, false, "E_BAD_REQUEST",
    jsonError(400, "E_BAD_REQUEST"));

  // MAX_QUEUE_WAIT_MS is both the default wait and the ceiling; a project's
  // stored policy may only lower it (before, the 45s policy default always won)
  const queueCeilingMs = Number(env.MAX_QUEUE_WAIT_MS) || DEFAULT_POLICY.max_queue_ms;
  const policy = await loadPolicy(env.KEYS, record.project, { ...DEFAULT_POLICY, max_queue_ms: queueCeilingMs });
  const rate = await rateCheck(env, record, policy);
  if (!rate.allowed) {
    return await finish(env, ctx, record, parsed.kind, "none", 429, started, 0, false, "E_RATE_LIMIT",
      jsonError(429, "E_RATE_LIMIT"));
  }

  if (parsed.kind === "state") {
    const row = await matrixOp(env, record, body as Record<string, unknown>);
    return await finish(env, ctx, record, "state", "core", 200, started, 0, true, undefined,
      Response.json({ ok: true, state: row }));
  }
  if (parsed.kind === "compute") {
    const answer = deterministicCompute(parsed.text);
    if (answer === null) {
      return await finish(env, ctx, record, "compute", "core", 400, started, 0, false, "E_BAD_REQUEST",
        jsonError(400, "E_BAD_REQUEST"));
    }
    return await finish(env, ctx, record, "compute", "core", 200, started, 0, true, undefined,
      Response.json({ ok: true, result: answer, meta: { engine: "core", verified: true } }));
  }

  // ---- chat: the only route that reaches the model ----
  if (!requestAllowed(parsed.text, policy)) {
    return await finish(env, ctx, record, "chat", "none", 403, started, 0, false, "E_FORBIDDEN",
      jsonError(403, "E_FORBIDDEN"));
  }

  // SG16's own rules (system prompt, self-check) belong to the website only.
  // Every API key — another project — gets the brain clean: its own rules
  // (`system`) and history go to the model as sent (owner decision 2026-10-19).
  const website = isWebsiteRecord(record);
  const detect = detectScript(parsed.text);
  const messages = website
    ? messagesFor(systemPrompt(detect), parsed.text, parsed.history)
    : apiMessages(parsed.system, parsed.history, parsed.text);
  const maxQueueMs = Math.min(policy.max_queue_ms, queueCeilingMs);

  // Free tier (website visitors without a pass): a one-time allowance of real
  // model tokens. Once spent, the visitor needs a pass (subscription). Pass
  // holders and API project keys are not metered here.
  const free = record.id.startsWith("free_");
  const allowance = freeTokenAllowance(env.FREE_TOKEN_ALLOWANCE);
  if (free) {
    const balance = await tokenBalance(env, record, allowance);
    if (balance.remaining <= 0) {
      return await finish(env, ctx, record, "chat", "none", 402, started, 0, false, "E_FREE_TOKENS",
        jsonError(402, "E_FREE_TOKENS"));
    }
  }

  const queueStarted = Date.now();
  const grant = await acquireSlot(env, maxQueueMs);
  if (!grant.granted && grant.off) {
    // the operator switched the brain off (admin BRAIN POWER): nothing is charged
    return await finish(env, ctx, record, "chat", "none", 503, started, 0, false, "E_BRAIN_OFF",
      jsonError(503, "E_BRAIN_OFF"));
  }
  if (!grant.granted) {
    return await finish(env, ctx, record, "chat", "none", 429, started, 0, false, "E_RATE_LIMIT",
      jsonError(429, "E_RATE_LIMIT"));
  }
  const queueMs = Date.now() - queueStarted;

  // Re-check under the slot: only one inference runs at a time and answers are
  // charged while their slot is held, so this balance is exact — parallel
  // requests queued behind a visitor's last free answer cannot overspend.
  if (free && (await tokenBalance(env, record, allowance)).remaining <= 0) {
    await releaseSlot(env, grant.ticket);
    return await finish(env, ctx, record, "chat", "none", 402, started, queueMs, false, "E_FREE_TOKENS",
      jsonError(402, "E_FREE_TOKENS"));
  }

  // One brain: SG16 Brain Q4_K_M, self-hosted. There is no other model and no
  // third-party AI API in this system — if the model host is down, the
  // request fails honestly (502).
  const modelCfg = modelCfgOf(env, env.MODEL_NAME);
  const meter: TokenMeter = { tokens: 0 };

  try {
    const draft = await attempt(env, modelCfg, messages, policy, meter);
    // speed first (owner decision 2026-10-19): the self-check pass doubles
    // answer time, so it only runs when SELF_CHECK is "true"
    const checked = website && env.SELF_CHECK === "true"
      ? await selfCheck(env, modelCfg, parsed.text, draft, policy, meter)
      : { text: draft, ok: false };
    const meta: AskMeta = {
      engine: "model-vps",
      model: modelCfg.model,
      checked: checked.ok,
      queue_ms: queueMs,
      latency_ms: Date.now() - started,
      verified: true,
      script: detect.script,
      tokens: meter.tokens,
    };
    // only a delivered answer is charged against the free allowance
    if (free) meta.free_tokens_remaining = (await spendTokens(env, record, allowance, meter.tokens)).remaining;
    const response = Response.json({ ok: true, answer: checked.text, meta });
    return await finish(env, ctx, record, "chat", "model-vps", 200, started, queueMs, true, undefined, response,
      parsed.text, checked.text, detect.script);
  } catch (e) {
    if (e instanceof HttpError) {
      return await finish(env, ctx, record, "chat", "none", e.status, started, queueMs, false, e.code,
        jsonError(e.status, e.code));
    }
    const code = e instanceof ModelError ? "E_UPSTREAM" : "E_INTERNAL";
    const status = e instanceof ModelError ? 502 : 500;
    return await finish(env, ctx, record, "chat", "none", status, started, queueMs, false, code,
      jsonError(status, code));
  } finally {
    await releaseSlot(env, grant.ticket);
  }
}

/** The website's own visitors: a device pass or the free tier (client-routes.ts). */
function isWebsiteRecord(record: KeyRecord): boolean {
  return record.id.startsWith("pass_") || record.id.startsWith("free_");
}

/** Model tokens spent while answering one request (every model pass counts). */
interface TokenMeter { tokens: number }

// one retry inside the draft call; the draft must pass verification before
// the self-check pass ever runs
async function attempt(
  env: Env,
  cfg: ReturnType<typeof modelCfgOf>,
  messages: unknown,
  policy: Policy,
  meter: TokenMeter,
): Promise<string> {
  for (let i = 0; i < 2; i++) {
    const out = await callModel(cfg, messages as never);
    meter.tokens += out.tokens;
    const v = verifyOutput({
      text: out.text,
      requireJson: policy.require_json,
      maxOutputChars: Number(env.MAX_OUTPUT_CHARS) || 16384,
      blockedPatterns: policy.blocked_patterns,
    });
    if (v.ok) return out.text;
  }
  throw new HttpError(502, "E_UNVERIFIED");
}

function modelCfgOf(env: Env, model: string) {
  return {
    provider: env.MODEL_PROVIDER,
    url: env.MODEL_URL,
    model,
    numCtx: Number(env.MODEL_NUM_CTX) || 8192,
    timeoutMs: Number(env.INFERENCE_TIMEOUT_MS) || 60000,
    sharedSecret: env.MODEL_SHARED_SECRET ?? "",
    accessClientId: env.CF_ACCESS_CLIENT_ID ?? "",
    accessClientSecret: env.CF_ACCESS_CLIENT_SECRET ?? "",
  };
}

// The self-check pass: the same model re-reads its own draft and either
// confirms it (exactly "OK") or returns a corrected answer. The user only
// ever sees the checked text. A failed check never takes the verified draft
// away — the answer simply goes out unchecked (checked: false in meta).
async function selfCheck(
  env: Env,
  cfg: ReturnType<typeof modelCfgOf>,
  question: string,
  draft: string,
  policy: Policy,
  meter: TokenMeter,
): Promise<{ text: string; ok: boolean }> {
  try {
    const out = await callModel(cfg, checkMessages(question, draft) as never);
    meter.tokens += out.tokens;
    const verdict = out.text;
    if (/^ok[.!]?$/i.test(verdict.trim())) return { text: draft, ok: true };
    const v = verifyOutput({
      text: verdict,
      requireJson: policy.require_json,
      maxOutputChars: Number(env.MAX_OUTPUT_CHARS) || 16384,
      blockedPatterns: policy.blocked_patterns,
    });
    if (!v.ok) return { text: draft, ok: false };
    return { text: verdict, ok: true };
  } catch {
    return { text: draft, ok: false };
  }
}

// ---------------------------------------------------------------------------
// queue plumbing (single Durable Object, name "global")

interface Grant { granted: true; ticket: number }
type SlotResult = Grant | { granted: false; ticket: number; off?: boolean };

async function queueDo(env: Env, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const id = env.QUEUE.idFromName("global");
  const stub = env.QUEUE.get(id);
  const response = await stub.fetch("https://do" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await response.json()) as Record<string, unknown>;
}

async function acquireSlot(env: Env, maxQueueMs: number): Promise<SlotResult> {
  const first = await queueDo(env, "/acquire", { waitBudgetMs: maxQueueMs });
  if (first.off === true) return { granted: false, ticket: 0, off: true };
  if (first.granted) return { granted: true, ticket: first.ticket as number };
  const ticket = first.ticket as number;
  const deadline = Date.now() + maxQueueMs;
  while (Date.now() < deadline) {
    await sleep(200);
    const poll = await queueDo(env, "/poll", { ticket });
    if (poll.granted) return { granted: true, ticket };
    if (poll.expired) break;
  }
  await queueDo(env, "/abandon", { ticket });
  return { granted: false, ticket };
}

async function releaseSlot(env: Env, ticket: number): Promise<void> {
  await queueDo(env, "/release", { ticket });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// matrix plumbing (shard one DO per key id)

async function matrixDo(env: Env, keyId: string, path: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
  const id = env.MATRIX.idFromName("m:" + keyId);
  const stub = env.MATRIX.get(id);
  const response = await stub.fetch("https://do" + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await response.json()) as Record<string, unknown>;
}

async function rateCheck(env: Env, record: KeyRecord, policy: Policy): Promise<{ allowed: boolean }> {
  const verdict = await matrixDo(env, record.id, "/check", "POST", {
    key_id: record.id,
    project: record.project,
    rpm: policy.rpm,
    now: Date.now(),
  });
  return { allowed: Boolean(verdict.allowed) };
}

async function tokenBalance(env: Env, record: KeyRecord, allowance: number): Promise<TokenBalance> {
  return await matrixDo(env, record.id, "/tokens/balance", "POST", {
    key_id: record.id,
    project: record.project,
    allowance,
    now: Date.now(),
  }) as unknown as TokenBalance;
}

async function spendTokens(env: Env, record: KeyRecord, allowance: number, tokens: number): Promise<TokenBalance> {
  return await matrixDo(env, record.id, "/tokens/spend", "POST", {
    key_id: record.id,
    project: record.project,
    allowance,
    tokens,
    now: Date.now(),
  }) as unknown as TokenBalance;
}

async function matrixOp(env: Env, record: KeyRecord, body: Record<string, unknown>): Promise<unknown> {
  if (body.op === "score.step") {
    const out = await matrixDo(env, record.id, "/step", "POST", {
      key_id: record.id,
      project: record.project,
      delta: Number(body.delta ?? 0),
      now: Date.now(),
    });
    return out;
  }
  const out = await matrixDo(env, record.id, "/state", "GET");
  return out;
}

async function matrixState(env: Env, record: KeyRecord): Promise<Response> {
  const row = await matrixDo(env, record.id, "/state", "GET");
  return Response.json({ ok: true, state: row });
}

// ---------------------------------------------------------------------------
// key rotation — the same endpoint for every consumer, owner included

async function rotateKey(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  record: KeyRecord,
  started: number,
): Promise<Response> {
  // a key can only rotate itself; the owner rotates like everyone else
  const { key } = newKey();
  const id = "k_" + (await sha256(key)).slice(0, 12);
  const nextRecord: KeyRecord = {
    id,
    user: record.user,
    project: record.project,
    created: Date.now(),
    revoked: false,
  };
  await env.KEYS.put(await keyHash(key), JSON.stringify(nextRecord));
  const oldKey = keyFromAuth(request);
  if (oldKey.startsWith(PROJECT_KEY_PREFIX)) {
    // a stateless sg16p_ key dies through its fingerprint record, the store /v1 auth reads
    await revokeProjectKey(env.KEYS, oldKey, record.project);
  } else if (oldKey) {
    await env.KEYS.put(await keyHash(oldKey), JSON.stringify({ ...record, revoked: true }));
  }
  return await finish(env, ctx, record, "chat", "none", 200, started, 0, true, undefined,
    Response.json({ ok: true, key, record: { id, user: record.user, project: record.project } }));
}

function keyFromAuth(request: Request): string {
  return /^Bearer\s+(\S+)$/i.exec((request.headers.get("authorization") ?? "").trim())?.[1] ?? "";
}

// --------------------------------------------------------------------------- 
// panel ingest door — pass-gated chat into the same pipeline as /v1/ask

async function ingest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  started: number,
): Promise<Response> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ stage: "refused", reply: refuseStage("E_BAD_REQUEST") });
  }
  const payload = body as Record<string, unknown>;
  if (typeof payload.audio_b64 === "string" && payload.audio_b64) {
    return Response.json({ stage: "refused", reply: "audio ingest is not supported on this core" });
  }
  const pass = await resolvePass(request.headers.get("x-sg16-pass"), env);
  if (!pass) {
    return Response.json({ stage: "refused", reply: "a valid pass is required; subscribe in the panel to chat" });
  }
  const record = await passKeyRecord(pass.pass, pass.activatedAt);
  const res = await askParsed(payload, env, ctx, record, started);
  const out = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (res.ok && out && typeof out.answer === "string") {
    return Response.json({ stage: "neutral", reply: out.answer, meta: out.meta ?? null });
  }
  return Response.json({ stage: "refused", reply: refuseStage(String(out?.code ?? "E_INTERNAL")) });
}

// ---------------------------------------------------------------------------
// health — component probes, machine-readable

interface HealthProbe { kv: boolean; d1: boolean; model: boolean; queue: unknown; power: boolean }

async function healthProbe(env: Env): Promise<HealthProbe> {
  const probe: HealthProbe = { kv: false, d1: false, model: false, queue: false, power: true };
  try {
    await env.KEYS.get("health:sentinel");
    probe.kv = true;
  } catch { /* kv stays false */ }
  try {
    await env.LOGS.prepare("SELECT 1").first();
    probe.d1 = true;
  } catch { /* d1 stays false */ }
  try {
    const stats = await queueDo(env, "/stats");
    probe.queue = { waiting: stats.waiting, busy: stats.busy };
    probe.power = (await queueDo(env, "/power")).on !== false;
  } catch { /* queue stays false */ }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(env.MODEL_URL + (env.MODEL_HEALTH_PATH || "/api/tags"), {
      headers: {
        "authorization": `Bearer ${env.MODEL_SHARED_SECRET ?? ""}`,
        "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID ?? "",
        "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET ?? "",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    probe.model = response.ok;
  } catch { /* model stays false */ }
  return probe;
}

async function health(env: Env, started: number): Promise<Response> {
  const probe = await healthProbe(env);
  const out: Record<string, unknown> = { ok: probe.kv === true && probe.d1 === true, ts: started,
    kv: probe.kv, d1: probe.d1, queue: probe.queue, model: probe.model, power: probe.power };
  return Response.json(out, { status: out.ok ? 200 : 503 });
}

// ---------------------------------------------------------------------------
// D1 logging + response wrapper

async function finish(
  env: Env,
  ctx: ExecutionContext,
  record: KeyRecord,
  kind: string,
  engine: AskMeta["engine"] | "none",
  http: number,
  started: number,
  queueMs: number,
  verified: boolean,
  errCode: string | undefined,
  response: Response,
  userText?: string,
  answerText?: string,
  script?: string | null,
): Promise<Response> {
  ctx.waitUntil((async () => {
    try {
      await logRequest(env.LOGS, {
        keyId: record.id, userId: record.user, project: record.project, kind, engine,
        http, latencyMs: Date.now() - started, queueMs, verified, errCode, script,
      }, Date.now());
      if (userText && answerText && http === 200) {
        await logHistory(env.LOGS, {
          keyId: record.id, project: record.project,
          requestDigest: await sha256(userText),
          responseDigest: await sha256(answerText),
          engine: engine as AskMeta["engine"], verified,
        }, Date.now());
      }
    } catch {
      // logging is best-effort
    }
  })());
  return response;
}

// ---------------------------------------------------------------------------
// deterministic compute — safe arithmetic inside the Worker (no eval)

export function deterministicCompute(expr: string): number | null {
  const s = expr.replace(/\s+/g, "");
  if (!s || s.length > 512 || !/^[0-9+\-*/().]+$/.test(s)) return null;
  let pos = 0;
  const peek = () => s[pos];
  const eat = (ch: string) => (s[pos] === ch ? (pos += 1, true) : false);

  function parseExpr(): number | null {
    let left = parseTerm();
    if (left === null) return null;
    for (;;) {
      if (eat("+")) { const r = parseTerm(); if (r === null) return null; left += r; }
      else if (eat("-")) { const r = parseTerm(); if (r === null) return null; left -= r; }
      else return left;
    }
  }
  function parseTerm(): number | null {
    let left = parseFactor();
    if (left === null) return null;
    for (;;) {
      if (eat("*")) { const r = parseFactor(); if (r === null) return null; left *= r; }
      else if (eat("/")) { const r = parseFactor(); if (r === null) return null; if (r === 0) return null; left /= r; }
      else return left;
    }
  }
  function parseFactor(): number | null {
    if (eat("+")) return parseFactor();
    if (eat("-")) { const v = parseFactor(); return v === null ? null : -v; }
    if (eat("(")) { const v = parseExpr(); if (v === null || !eat(")")) return null; return v; }
    const start = pos;
    while (pos < s.length && /[0-9.]/.test(peek())) pos += 1;
    if (start === pos) return null;
    const num = Number(s.slice(start, pos));
    return Number.isFinite(num) ? num : null;
  }

  const value = parseExpr();
  if (value === null || pos !== s.length || !Number.isFinite(value)) return null;
  return Math.round(value * 1e9) / 1e9;
}
