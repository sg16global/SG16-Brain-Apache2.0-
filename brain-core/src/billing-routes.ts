// SG16 BRAIN CORE — payment routes (Dodo Payments pipeline). Paths and
// response shapes are the ones the design pages (site/) and the Dodo webhook
// endpoint use:
//
//   POST /api/dodo/checkout   create a Dodo session (or proxy-verified
//                              humanitarian record) for one pass
//   POST /api/dodo/webhook     Standard Webhooks signature -> signed record
//   POST /api/dodo/confirm     client pickup of the confirmed record
//   POST /api/pass/verify      verify a 64-hex token or a signed record
//   GET  /api/billing          public tier/gateway description
//
// Errors use the legacy shape {"error": msg, "status": n} because these
// routes serve the old web frontend, not the /v1 machine-code API.
// State lives in D1 (strongly consistent; KV's eventual consistency could
// make a checkout invisible to the webhook that confirms it).

import {
  PASSES,
  HUMANITARIAN_REGION,
  PALESTINE_CODES,
  isHumanitarian,
  issueRecord,
  verifyRecord,
  verifyWebhookSignature,
  eventPaymentObject,
  recordFromWebhook,
  checkoutRequestBody,
  VerificationError,
} from "./billing.ts";

const DODO_TEST_BASE = "https://test.dodopayments.com";
const DODO_LIVE_BASE = "https://live.dodopayments.com";
const CHECKOUT_WINDOW_SECONDS = 24 * 3600;

export interface BillingEnv {
  LOGS: D1Database;
  DODO_TEST_MODE?: string;        // "true" | "false"
  DODO_PRODUCT_IDS?: string;      // JSON {day: "pdt_..", week: .., half: .., month: ..}
  ALLOWED_RETURN_ORIGINS?: string; // comma-separated extra origins; the Worker's own origin is always allowed
  DODO_API_KEY?: string;
  DODO_WEBHOOK_SECRET?: string;
  BILLING_SECRET?: string;
}

// ---------------------------------------------------------------- helpers

function legacyError(status: number, message: string, cors: string | null): Response {
  return Response.json(
    { error: message, status },
    { status, headers: corsHeaders(cors) },
  );
}

function legacyJson(payload: unknown, status = 200, cors: string | null = null): Response {
  return Response.json(payload, { status, headers: corsHeaders(cors) });
}

function corsHeaders(origin: string | null): HeadersInit {
  const h: Record<string, string> = {
    "content-type": "application/json",
  };
  if (origin) {
    h["access-control-allow-origin"] = origin;
    h["access-control-allow-methods"] = "GET, POST, OPTIONS";
    h["access-control-allow-headers"] = "content-type, webhook-id, webhook-timestamp, webhook-signature";
  }
  return h;
}

// The site's own address (workers.dev today, the new domain later) is always
// a valid return origin; ALLOWED_RETURN_ORIGINS only adds others.
function allowedOrigins(env: BillingEnv, request: Request): string[] {
  const extra = (env.ALLOWED_RETURN_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [new URL(request.url).origin, ...extra];
}

function requestOrigin(request: Request, env: BillingEnv): string | null {
  const origin = request.headers.get("origin");
  if (origin && allowedOrigins(env, request).includes(origin)) return origin;
  return null;
}

function productIds(env: BillingEnv): Record<string, string> {
  try {
    const parsed = JSON.parse(env.DODO_PRODUCT_IDS ?? "{}") as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string" && v) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

// Best-effort checkout throttle. Per-isolate only — the real flood control
// for a paid route belongs on the Cloudflare WAF in front of this Worker.
const checkoutHits = new Map<string, number[]>();
function checkoutThrottled(ip: string): boolean {
  const now = Date.now();
  const window = (checkoutHits.get(ip) ?? []).filter((t) => now - t < 60_000);
  window.push(now);
  checkoutHits.set(ip, window.slice(-10));
  return window.length > 10;
}

function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

function randomRef(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- routes

export async function billingRoute(request: Request, env: BillingEnv, path: string): Promise<Response | null> {
  const cors = requestOrigin(request, env);
  if (request.method === "OPTIONS" && path.startsWith("/api/")) {
    return new Response(null, { status: 204, headers: corsHeaders(cors) });
  }
  if (request.method === "GET" && path === "/api/billing") return billingInfo(env, cors);
  if (request.method === "POST" && path === "/api/dodo/checkout") return dodoCheckout(request, env, cors);
  if (request.method === "POST" && path === "/api/dodo/webhook") return dodoWebhook(request, env);
  if (request.method === "POST" && path === "/api/dodo/confirm") return dodoConfirm(request, env, cors);
  if (request.method === "POST" && path === "/api/pass/verify") return passVerify(request, env, cors);
  // legacy paths the design pages still call (old host contract)
  if (request.method === "POST" && path === "/api/billing") return dodoCheckout(request, env, cors);
  if (request.method === "POST" && path === "/api/billing/confirm") return dodoConfirm(request, env, cors);
  if (request.method === "POST" && path === "/api/pass-check") return passCheck(request, env, cors);
  return null; // unknown path: let the /v1 router answer with E_NOT_FOUND
}

function billingInfo(env: BillingEnv, cors: string | null): Response {
  const mode = env.DODO_API_KEY ? (env.DODO_TEST_MODE === "true" ? "test-mor" : "live-mor") : "disabled";
  return legacyJson(
    {
      ok: true,
      source: "core",
      billing: {
        currency: "USD",
      humanitarian_region: HUMANITARIAN_REGION,
      passes: Object.fromEntries(
        Object.entries(PASSES).map(([id, spec]) => [id, { label: spec.label, price: spec.price, hours: spec.hours }]),
      ),
      gateway: {
        provider: "dodo-payments",
        model: "merchant-of-record",
        mode,
        test_mode: env.DODO_TEST_MODE === "true",
        endpoints: {
          checkout: "/api/dodo/checkout",
          webhook: "/api/dodo/webhook",
          confirm: "/api/dodo/confirm",
        },
        humanitarian_intercept:
          "A zero-rate record is available only when the Cloudflare edge geo-country header verifies eligibility. Client region claims are ignored.",
        paid_checkout_without_gateway: "disabled; no local paid passes are issued",
      },
      },
    },
    200,
    cors,
  );
}

// ------------------------------------------------------------ checkout

async function dodoCheckout(request: Request, env: BillingEnv, cors: string | null): Promise<Response> {
  const secret = env.BILLING_SECRET ?? "";
  // no pass can be signed without the billing secret: never take a payment
  // for a pass that could not be issued
  if (!secret.trim()) return legacyError(503, "passes are unavailable: billing is not configured on this host", cors);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return legacyError(400, "body must be a json object", cors);
  const payload = body as Record<string, unknown>;
  const passId = String(payload.pass ?? "");
  if (!PASSES[passId]) return legacyError(400, `unknown pass tier: ${JSON.stringify(passId)}`, cors);
  if (checkoutThrottled(clientIp(request))) {
    return legacyError(429, "too many checkout attempts; slow down", cors);
  }

  // Trusted-proxy geo: the Cloudflare edge asserts the country, the client
  // does not. Only the humanitarian region may bypass the gateway.
  const cf = (request as unknown as { cf?: { country?: string } }).cf;
  const country = (cf?.country ?? "").trim().toUpperCase();
  const region = PALESTINE_CODES.has(country) ? HUMANITARIAN_REGION : null;

  if (isHumanitarian(region)) {
    const record = await issueRecord(passId, region, secret, "verified-humanitarian");
    await env.LOGS.prepare("INSERT INTO passes (token, record, created_at) VALUES (?, ?, ?)")
      .bind(record.token, JSON.stringify(record), Math.floor(Date.now() / 1000))
      .run();
    return legacyJson({ mode: "humanitarian_bypass", record }, 200, cors);
  }

  if (!env.DODO_API_KEY) {
    return legacyError(503, "paid checkout is unavailable: Dodo Payments is not configured", cors);
  }

  const productId = productIds(env)[passId];
  const returnUrls: string[] = [];
  if (typeof payload.return_url === "string" && payload.return_url) returnUrls.push(payload.return_url);
  const originHeader = request.headers.get("origin");
  if (originHeader) returnUrls.push(originHeader);
  const rawReturn = returnUrls.find((u) => allowedOrigins(env, request).includes(originOf(u)));
  if (returnUrls.length && !rawReturn) {
    return legacyError(400, "return_url must use a configured application origin", cors);
  }

  const ref = randomRef();
  let callbackUrl: string | null = null;
  if (rawReturn) {
    const url = new URL(rawReturn);
    url.searchParams.set("sg16_checkout_ref", ref);
    callbackUrl = url.toString();
  }

  let requestBody: Record<string, unknown>;
  try {
    requestBody = checkoutRequestBody(productId, passId, region, callbackUrl, {
      sg16_checkout_ref: ref,
    });
  } catch (e) {
    return legacyError(400, (e as Error).message, cors);
  }

  const openedAt = Math.floor(Date.now() / 1000);
  await env.LOGS.prepare(
    "INSERT INTO checkouts (ref, pass_id, region, status, opened_at, gateway_session_id, record_token) VALUES (?, ?, ?, 'pending', ?, NULL, NULL)",
  )
    .bind(ref, passId, region, openedAt)
    .run();

  const base = env.DODO_TEST_MODE === "true" ? DODO_TEST_BASE : DODO_LIVE_BASE;
  let session: Record<string, unknown>;
  try {
    const response = await fetch(`${base}/checkouts`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${env.DODO_API_KEY}`,
        "content-type": "application/json",
        "accept": "application/json",
        "user-agent": "SG16-Brain-Core/1.0",
      },
      body: JSON.stringify(requestBody),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);
      const status = [400, 401, 402, 403, 422].includes(response.status) ? response.status : 502;
      return legacyError(status, `dodo payments: checkout rejected: ${detail}`, cors);
    }
    const parsed = await response.json().catch(() => null);
    if (!parsed || typeof parsed !== "object") {
      return legacyError(502, "dodo payments: gateway response was not valid json", cors);
    }
    session = parsed as Record<string, unknown>;
  } catch {
    return legacyError(502, "dodo payments: gateway unreachable", cors);
  }

  const checkoutId = String(session.session_id ?? session.payment_id ?? "");
  const checkoutUrl = String(session.checkout_url ?? "");
  const parsedUrl = safeUrl(checkoutUrl);
  if (!checkoutId || !parsedUrl || parsedUrl.protocol !== "https:" || !parsedUrl.hostname) {
    return legacyError(502, "dodo payments returned an unusable checkout session", cors);
  }

  await env.LOGS.prepare("UPDATE checkouts SET gateway_session_id = ? WHERE ref = ?")
    .bind(checkoutId, ref)
    .run();

  return legacyJson(
    {
      mode: "dodo",
      session_id: ref,
      gateway_session_id: checkoutId,
      checkout_url: checkoutUrl,
      pass: passId,
    },
    200,
    cors,
  );
}

function originOf(value: string): string {
  try {
    const u = new URL(value);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ webhook

async function dodoWebhook(request: Request, env: BillingEnv): Promise<Response> {
  const secret = env.DODO_WEBHOOK_SECRET ?? "";
  if (!secret) {
    return legacyError(503, "dodo webhook secret is not configured on this host", null);
  }
  // 503, not 400: Dodo retries, so a paid pass is issued once the secret is set
  if (!(env.BILLING_SECRET ?? "").trim()) {
    return legacyError(503, "billing secret is not configured on this host", null);
  }
  const rawBody = await request.text();
  try {
    await verifyWebhookSignature(
      secret,
      request.headers.get("webhook-id"),
      request.headers.get("webhook-timestamp"),
      request.headers.get("webhook-signature"),
      rawBody,
    );
  } catch (e) {
    return legacyError(403, (e as Error).message, null);
  }

  let event: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return legacyError(400, "webhook body must be a json object", null);
    }
    event = parsed as Record<string, unknown>;
  } catch {
    return legacyError(400, "webhook body is not valid json", null);
  }

  const eventType = String(event.type ?? "");
  if (eventType !== "payment.succeeded" && eventType !== "checkout.session.completed") {
    return legacyJson({ received: true, event: eventType, acted: false }, 200, null);
  }

  const payment = eventPaymentObject(event);
  const metadata =
    payment.metadata && typeof payment.metadata === "object" && !Array.isArray(payment.metadata)
      ? (payment.metadata as Record<string, unknown>)
      : {};
  const keys = [payment.session_id, payment.payment_id, payment.checkout_id, metadata.sg16_checkout_ref]
    .filter((v) => v !== undefined && v !== null && String(v) !== "")
    .map(String);

  interface CheckoutRow {
  ref: string;
  pass_id: string;
  region: string | null;
  status: string;
  opened_at: number;
  record_token: string | null;
}

let checkout: CheckoutRow | null = null;
  for (const key of keys) {
    const row = await env.LOGS.prepare(
      "SELECT ref, pass_id, region, status, opened_at, record_token FROM checkouts WHERE ref = ? OR gateway_session_id = ? LIMIT 1",
    )
      .bind(key, key)
      .first();
    if (row) {
      checkout = row as unknown as CheckoutRow;
      break;
    }
  }
  if (!checkout) {
    return legacyError(404, "success event does not match a checkout created by this host", null);
  }
  if (Math.floor(Date.now() / 1000) - Number(checkout.opened_at) > CHECKOUT_WINDOW_SECONDS) {
    await env.LOGS.prepare("UPDATE checkouts SET status = 'expired' WHERE ref = ?").bind(checkout.ref).run();
    return legacyError(410, "checkout confirmation window has expired", null);
  }
  if (String(metadata.sg16_pass ?? "") !== checkout.pass_id) {
    return legacyError(400, "webhook pass does not match the host checkout", null);
  }
  if (String(metadata.sg16_region ?? "") !== (checkout.region ?? "")) {
    return legacyError(400, "webhook region does not match the host checkout", null);
  }

  let record;
  try {
    record = await recordFromWebhook(event, env.BILLING_SECRET ?? "", undefined, productIds(env));
  } catch (e) {
    if (e instanceof VerificationError) return legacyError(400, e.message, null);
    return legacyError(500, "internal error building the pass record", null);
  }

  const webhookId = request.headers.get("webhook-id") ?? "";
  const seen = await env.LOGS.prepare(
    "INSERT INTO webhook_events (webhook_id, seen_at) VALUES (?, ?) ON CONFLICT(webhook_id) DO NOTHING",
  )
    .bind(webhookId, Math.floor(Date.now() / 1000))
    .run();

  if (checkout.status === "paid" && checkout.record_token) {
    return legacyJson({ received: true, event: eventType, acted: false, duplicate: true }, 200, null);
  }

  await env.LOGS.batch([
    env.LOGS.prepare("INSERT INTO passes (token, record, created_at) VALUES (?, ?, ?)")
      .bind(record.token, JSON.stringify(record), Math.floor(Date.now() / 1000)),
    env.LOGS.prepare("UPDATE checkouts SET status = 'paid', record_token = ? WHERE ref = ?")
      .bind(record.token, checkout.ref),
  ]);

  return legacyJson(
    { received: true, event: eventType, acted: true, pass: record.pass, deduped: !seen.meta.changes },
    200,
    null,
  );
}

// ------------------------------------------------------------ confirm

async function dodoConfirm(request: Request, env: BillingEnv, cors: string | null): Promise<Response> {
  const body = await request.json().catch(() => null);
  const checkoutId = body && typeof body === "object" ? String((body as Record<string, unknown>).session_id ?? "") : "";
  if (!checkoutId) return legacyError(400, "session_id is required", cors);

  const row = await env.LOGS.prepare(
    "SELECT ref, status, record_token FROM checkouts WHERE ref = ? OR gateway_session_id = ? LIMIT 1",
  )
    .bind(checkoutId, checkoutId)
    .first();
  if (!row) return legacyError(404, "no such checkout session on this host", cors);

  if (row.status !== "paid" || !row.record_token) {
    return legacyJson({ confirmed: false, status: row.status ?? "pending" }, 202, cors);
  }
  const stored = await env.LOGS.prepare("SELECT record FROM passes WHERE token = ?")
    .bind(row.record_token)
    .first();
  if (!stored) return legacyError(410, "the confirmed record is no longer available", cors);
  return legacyJson({ confirmed: true, record: JSON.parse(stored.record as string) }, 200, cors);
}

// ------------------------------------------------------------ pass verify

const LEGACY_TOKEN = /^[a-f0-9]{64}$/;

async function passVerify(request: Request, env: BillingEnv, cors: string | null): Promise<Response> {
  const body = await request.json().catch(() => null);
  const value =
    body && typeof body === "object"
      ? String((body as Record<string, unknown>).pass ?? (body as Record<string, unknown>).token ?? "")
      : "";
  const trimmed = value.trim();
  if (!LEGACY_TOKEN.test(trimmed) && !/^[A-Za-z0-9_-]{40,3000}$/.test(trimmed)) {
    return legacyError(400, "pass must be a host pass token or a signed pass record", cors);
  }

  const secret = env.BILLING_SECRET ?? "";
  try {
    if (LEGACY_TOKEN.test(trimmed)) {
      const stored = await env.LOGS.prepare("SELECT record FROM passes WHERE token = ?").bind(trimmed).first();
      if (!stored) throw new VerificationError("pass token was not issued by this host");
      const record = JSON.parse(stored.record as string) as Record<string, unknown>;
      return legacyJson({ valid: true, record: await verifyRecord(record, secret) }, 200, cors);
    }
    // stateless: a signed record recomputes against the billing secret alone
    let record: unknown;
    try {
      record = JSON.parse(new TextDecoder().decode(base64UrlToBytes(trimmed)));
    } catch {
      throw new VerificationError("pass is not a signed record");
    }
    if (!record || typeof record !== "object") throw new VerificationError("pass is not a signed record");
    return legacyJson({ valid: true, record: await verifyRecord(record as Record<string, unknown>, secret) }, 200, cors);
  } catch (e) {
    return legacyError(403, `pass failed verification: ${(e as Error).message}`, cors);
  }
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ------------------------------------------------------------ legacy pass-check
// POST /api/pass-check {pass} - the design subscription page's pass-restore
// probe (old host response shape: {valid, pass, expires_at}).

async function passCheck(request: Request, env: BillingEnv, cors: string | null): Promise<Response> {
  const body = await request.json().catch(() => null);
  const value =
    body && typeof body === "object"
      ? String((body as Record<string, unknown>).pass ?? "")
      : "";
  const trimmed = value.trim();
  if (!LEGACY_TOKEN.test(trimmed) && !/^[A-Za-z0-9_-]{40,3000}$/.test(trimmed)) {
    return legacyJson({ valid: false, error: "That is not a pass." }, 400, cors);
  }
  const secret = env.BILLING_SECRET ?? "";
  try {
    if (LEGACY_TOKEN.test(trimmed)) {
      const stored = await env.LOGS.prepare("SELECT record FROM passes WHERE token = ?").bind(trimmed).first();
      if (!stored) throw new VerificationError("pass token was not issued by this host");
      const record = await verifyRecord(JSON.parse(stored.record as string) as Record<string, unknown>, secret);
      return legacyJson({ valid: true, pass: record.pass, expires_at: record.expires_at }, 200, cors);
    }
    let record: unknown;
    try {
      record = JSON.parse(new TextDecoder().decode(base64UrlToBytes(trimmed)));
    } catch {
      throw new VerificationError("pass is not a signed record");
    }
    if (!record || typeof record !== "object") throw new VerificationError("pass is not a signed record");
    const verified = await verifyRecord(record as Record<string, unknown>, secret);
    return legacyJson({ valid: true, pass: verified.pass, expires_at: verified.expires_at }, 200, cors);
  } catch (e) {
    const bad = e instanceof VerificationError;
    return legacyJson(
      {
        valid: false,
        error: bad ? "This pass is not valid, or it has expired." : "The host could not check the pass right now.",
      },
      bad ? 403 : 503,
      cors,
    );
  }
}
