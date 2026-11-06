// SG16 BRAIN CORE — legacy design-API compatibility routes.
//
// The public design (brain-core/site, mirrored from the pointoni app) is a
// static export whose pages still speak the old host's API. This module
// implements those endpoints on the Worker, wired to the same pipelines the
// panel and /v1 already use, so the design's chat, operator sign-in, admin
// console, model list and payment pages work again without a single visual
// change to the protected design:
//
//   GET  /api/identity            service description
//   POST /api/identity            action=admin-login | request | verify | me | bind
//                                 (operator sign-in; visitor sign-up/sign-in by email code)
//   GET  /api/admin/project-keys  operator only: key config state + minted-key records
//   POST /api/admin/project-keys  operator only: mint one sg16p_ project key (recorded)
//   DELETE /api/admin/project-keys  operator only: revoke one key (?key=<sg16p_ key> or ?id=<fingerprint>)
//   GET  /api/admin/project-activity  operator only: per project key — live status, last call, 24h calls
//   POST /api/admin/project-control   operator only: one key ON / OFF / BROKEN (broken is final)
//   GET|POST /api/admin/brain-power   operator only: the BRAIN POWER switch (on = answering, off = stopped)
//   GET  /api/brain?probe=...     turnstile probe / health probe / session note
//   POST /api/brain               pass-gated chat (X-SG16-Pass), ChatReply or
//                                 x-ndjson delta/done stream, old shapes
//   GET  /api/models              the one model, honest status
//
// Legacy payment aliases (/api/billing, /api/billing/confirm, /api/pass-check)
// live in billing-routes.ts next to the Dodo pipeline they wrap.
//
// Operator auth (owner request 2026-11-06): the ONE operator email is
// ADMIN_EMAIL (sg16global@gmail.com), and its password is the Cloudflare
// secret SG16_ADMIN_PASSWORD, set by the owner in the Cloudflare dashboard.
// Operator tokens keep the old host's v1 format; visitor account tokens are
// v2, signed with the same SG16_IDENTITY_SECRET but never accepted as an
// operator token, so an email code can never open the admin console.
// Project keys are signed with SG16_PROJECT_KEY_SECRET, unchanged, so keys
// issued by the old host still verify.
//
// Visitor accounts (src/accounts.ts): email + 6-digit code, one step for
// sign-up and sign-in. Free website chat needs an account: each account has
// its own one-time free token allowance, and its pass works on every device.

import { createHash, timingSafeEqual } from "node:crypto";
import type { KeyRecord } from "./types.ts";
import { resolvePass, passKeyRecord } from "./client-routes.ts";
import {
  requestCode,
  verifyCode,
  accountPass,
  rememberPass,
  passRecordOf,
  accountFreeRecord,
  type SendEmailBinding,
} from "./accounts.ts";
import { keyHash } from "./keys.ts";
import { SG16_BRAIN_MODEL } from "./client-routes.ts";
import { freeTokenAllowance } from "./tokens.ts";

export interface DesignEnv {
  KEYS: KVNamespace;
  LOGS: D1Database;
  QUEUE: DurableObjectNamespace;
  MATRIX: DurableObjectNamespace;
  SG16_IDENTITY_SECRET?: string;
  /** The operator's password, a Cloudflare secret set in the dashboard. */
  SG16_ADMIN_PASSWORD?: string;
  SG16_PROJECT_KEY_SECRET?: string;
  /** Cloudflare Email Sending (send_email binding): visitor sign-in codes. */
  EMAIL?: SendEmailBinding;
  EMAIL_FROM?: string;
  FREE_TOKEN_ALLOWANCE?: string;
  SG16_REVOKED_PROJECTS?: string;
  BILLING_SECRET?: string;
  MODEL_NAME?: string;
}

// ------------------------------------------------------------------ encoding

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToB64u(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64uToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function b64uText(value: string): string {
  return decoder.decode(b64uToBytes(value));
}

async function hmacB64u(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return bytesToB64u(new Uint8Array(sig));
}

/** Constant-time equality for equal-length base64url strings. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(payload, { status, headers: { "cache-control": "no-store", ...headers } });
}

// ------------------------------------------------------------ identity token
// Format identical to the old host: b64url(JSON {email, exp, v:1}).b64url(HMAC)
// signed with SG16_IDENTITY_SECRET, so tokens issued before the cutover still
// verify and the design's admin console keeps accepting this browser's login.

const TOKEN_TTL_MS = 30 * 24 * 3600_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function signIdentityToken(email: string, secret: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) throw new Error("Cannot issue a token for an invalid email.");
  const body = bytesToB64u(encoder.encode(JSON.stringify({ email: normalized, exp: Date.now() + TOKEN_TTL_MS, v: 1 })));
  return `${body}.${await hmacB64u(secret, body)}`;
}

export async function verifyIdentityToken(
  token: string | null,
  secret: string | undefined,
): Promise<{ email: string } | null> {
  if (!secret || typeof token !== "string" || token.length > 4096) return null;
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token.trim());
  if (!match) return null;
  const [, body, sig] = match;
  if (!safeEqual(sig, await hmacB64u(secret, body))) return null;
  try {
    const payload = JSON.parse(b64uText(body)) as { email?: unknown; exp?: unknown; v?: unknown };
    if (payload.v !== 1 || typeof payload.email !== "string" || !EMAIL_PATTERN.test(payload.email)) return null;
    if (typeof payload.exp !== "number" || !Number.isSafeInteger(payload.exp) || payload.exp <= Date.now()) return null;
    return { email: payload.email.toLowerCase() };
  } catch {
    return null;
  }
}

// Visitor account tokens: v2, same secret. verifyIdentityToken (operator)
// only accepts v1, so an account token can never act as an operator token.
export async function signAccountToken(email: string, secret: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) throw new Error("Cannot issue a token for an invalid email.");
  const body = bytesToB64u(encoder.encode(JSON.stringify({ email: normalized, exp: Date.now() + TOKEN_TTL_MS, v: 2, k: "account" })));
  return `${body}.${await hmacB64u(secret, body)}`;
}

export async function verifyAccountToken(
  token: string | null,
  secret: string | undefined,
): Promise<{ email: string } | null> {
  if (!secret || typeof token !== "string" || token.length > 4096) return null;
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token.trim());
  if (!match) return null;
  const [, body, sig] = match;
  if (!safeEqual(sig, await hmacB64u(secret, body))) return null;
  try {
    const payload = JSON.parse(b64uText(body)) as { email?: unknown; exp?: unknown; v?: unknown; k?: unknown };
    if (payload.v !== 2 || payload.k !== "account" || typeof payload.email !== "string" || !EMAIL_PATTERN.test(payload.email)) return null;
    if (typeof payload.exp !== "number" || !Number.isSafeInteger(payload.exp) || payload.exp <= Date.now()) return null;
    return { email: payload.email.toLowerCase() };
  } catch {
    return null;
  }
}

/** Who sent this request: a visitor account (v2) or the operator (v1), or nobody. */
export async function signedInAs(
  request: Request,
  env: DesignEnv,
): Promise<{ email: string; admin: boolean } | null> {
  const match = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!match) return null;
  const account = await verifyAccountToken(match[1], env.SG16_IDENTITY_SECRET);
  if (account) return { email: account.email, admin: false };
  const operator = await verifyIdentityToken(match[1], env.SG16_IDENTITY_SECRET);
  return operator ? { email: operator.email, admin: isAdminEmail(operator.email, env) } : null;
}

// ------------------------------------------------------------- operator auth

/** The one and only operator (owner request 2026-11-06). */
export const ADMIN_EMAIL = "sg16global@gmail.com";

export function adminEmails(_env?: DesignEnv): string[] {
  return [ADMIN_EMAIL];
}

export function isAdminEmail(email: string | null, _env?: DesignEnv): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === ADMIN_EMAIL;
}

export function operatorConfigured(env: DesignEnv): boolean {
  return Boolean((env.SG16_ADMIN_PASSWORD ?? "").length > 0 && (env.SG16_IDENTITY_SECRET ?? "").trim());
}

/** Constant-time password check: both sides are hashed to the same length first. */
export function passwordMatches(given: string, configured: string): boolean {
  const a = createHash("sha256").update("sg16-admin|" + given, "utf8").digest();
  const b = createHash("sha256").update("sg16-admin|" + configured, "utf8").digest();
  return timingSafeEqual(a, b);
}

// Per-isolate guess throttling, same policy as the old host (best effort).
const WINDOW_MS = 10 * 60_000;
const PER_VISITOR = 5;
const GLOBAL_LIMIT = 40;
const attempts = new Map<string, { count: number; resetAt: number }>();
let globalCounter = { count: 0, resetAt: 0 };

function attemptAllowed(key: string, now: number): boolean {
  const c = attempts.get(key);
  if (!c || c.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (c.count >= PER_VISITOR) return false;
  c.count += 1;
  return true;
}

export async function adminLogin(
  email: unknown,
  password: unknown,
  networkKey: string,
  env: DesignEnv,
): Promise<{ ok: true; token: string; email: string } | { ok: false; status: number; error: string }> {
  const configured = env.SG16_ADMIN_PASSWORD ?? "";
  if (!operatorConfigured(env)) {
    return { ok: false, status: 503, error: "Operator login is not set up on this server." };
  }
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  const pass = typeof password === "string" ? password : "";
  if (!normalizedEmail || !pass || normalizedEmail.length > 254 || pass.length > 256) {
    return { ok: false, status: 400, error: "Enter your email and password." };
  }
  const now = Date.now();
  if (globalCounter.resetAt <= now) globalCounter = { count: 0, resetAt: now + WINDOW_MS };
  const visitorKey = `${normalizedEmail}|${networkKey}`;
  if (globalCounter.count >= GLOBAL_LIMIT || !attemptAllowed(visitorKey, now)) {
    return { ok: false, status: 429, error: "Too many attempts. Wait ten minutes and try again." };
  }
  globalCounter.count += 1;
  const admin = isAdminEmail(normalizedEmail, env);
  // a wrong email still runs the comparison, so it costs the same time
  const passwordOk = passwordMatches(pass, admin ? configured : "\u0000not-the-operator\u0000");
  if (!admin || !passwordOk) return { ok: false, status: 401, error: "Email or password is wrong." };
  return { ok: true, token: await signIdentityToken(normalizedEmail, env.SG16_IDENTITY_SECRET ?? ""), email: normalizedEmail };
}

async function operatorBearer(
  request: Request,
  env: DesignEnv,
): Promise<{ email: string } | null> {
  const match = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get("authorization") ?? "");
  const payload = match ? await verifyIdentityToken(match[1], env.SG16_IDENTITY_SECRET) : null;
  return payload && isAdminEmail(payload.email, env) ? payload : null;
}

// ------------------------------------------------------------- project keys
// Stateless sg16p_ keys, byte-for-byte the old host's scheme (same secret =>
// every key the operator already issued keeps working against /v1/ask).

export const PROJECT_KEY_PREFIX = "sg16p_";
const PROJECT_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function isValidProjectName(name: string): boolean {
  return PROJECT_NAME.test(name);
}

function randomNonceB64u(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return bytesToB64u(bytes);
}

export async function createProjectKey(project: string, secret: string, now = Date.now()): Promise<string> {
  const payload = bytesToB64u(
    encoder.encode(JSON.stringify({ v: 1, p: project, iat: Math.floor(now / 1000), n: randomNonceB64u() })),
  );
  return `${PROJECT_KEY_PREFIX}${payload}.${await hmacB64u(secret, `sg16-project-key-v1|${payload}`)}`;
}

export async function verifyProjectKey(
  key: string,
  secret: string | undefined,
  revoked: string[] = [],
): Promise<{ project: string; issuedAt: number } | null> {
  if (!secret || typeof key !== "string" || key.length > 400 || !key.startsWith(PROJECT_KEY_PREFIX)) return null;
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(key.slice(PROJECT_KEY_PREFIX.length));
  if (!match) return null;
  const [, payload, sig] = match;
  if (!safeEqual(sig, await hmacB64u(secret, `sg16-project-key-v1|${payload}`))) return null;
  try {
    const parsed = JSON.parse(b64uText(payload)) as { v?: unknown; p?: unknown; iat?: unknown };
    if (parsed.v !== 1 || typeof parsed.p !== "string" || !isValidProjectName(parsed.p)) return null;
    if (revoked.includes(parsed.p)) return null;
    return { project: parsed.p, issuedAt: typeof parsed.iat === "number" ? parsed.iat * 1000 : 0 };
  } catch {
    return null;
  }
}

/** A sg16p_ project key as a /v1 key record (same shape the pass door uses). */
export function projectKeyRecord(key: string, project: string, issuedAt: number): KeyRecord {
  return { id: `sg16p_${project}_${key.slice(-12)}`, user: 0, project, created: issuedAt, revoked: false };
}

// ------------------------------------------- project-key records (KV)
// Minting records a fingerprint of every key so the operator can later list
// and revoke keys one by one. Only the SHA-256 of a key is stored, never the
// key itself, so the public promise ("no list of keys, only signatures")
// stays literally true: the server keeps fingerprints, not keys.

const PROJECT_KEY_RECORD_PREFIX = "projkey:";

export interface ProjectKeyRecord {
  /** sha256(key), hex: a fingerprint, never the key. */
  id: string;
  project: string;
  created: number;
  /** Last 12 characters of the key, so the operator can recognize it. */
  last12: string;
  revoked: boolean;
}

async function recordProjectKey(env: DesignEnv, key: string, project: string, now: number): Promise<ProjectKeyRecord> {
  const record: ProjectKeyRecord = { id: await keyHash(key), project, created: now, last12: key.slice(-12), revoked: false };
  await env.KEYS.put(PROJECT_KEY_RECORD_PREFIX + record.id, JSON.stringify(record));
  return record;
}

async function listProjectKeyRecords(env: DesignEnv): Promise<ProjectKeyRecord[]> {
  const records: ProjectKeyRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.KEYS.list(cursor ? { prefix: PROJECT_KEY_RECORD_PREFIX, cursor } : { prefix: PROJECT_KEY_RECORD_PREFIX });
    for (const item of page.keys) {
      const raw = await env.KEYS.get(item.name);
      if (!raw) continue;
      try {
        records.push(JSON.parse(raw) as ProjectKeyRecord);
      } catch {
        continue;
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  records.sort((a, b) => b.created - a.created); // newest first
  return records;
}

async function revokeProjectKeyRecord(env: DesignEnv, id: string): Promise<ProjectKeyRecord | null> {
  const raw = await env.KEYS.get(PROJECT_KEY_RECORD_PREFIX + id);
  if (!raw) return null;
  let record: ProjectKeyRecord;
  try {
    record = JSON.parse(raw) as ProjectKeyRecord;
  } catch {
    return null;
  }
  // a tombstone, not a delete: removing the record would un-revoke the key
  record.revoked = true;
  await env.KEYS.put(PROJECT_KEY_RECORD_PREFIX + id, JSON.stringify(record));
  return record;
}

/** Revoke one sg16p_ key by its fingerprint (key rotation on /v1/keys). Keeps
 * the existing record when there is one; writes a tombstone when there is not
 * (keys minted before records existed). */
export async function revokeProjectKey(
  store: { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> },
  key: string,
  project: string,
  now = Date.now(),
): Promise<void> {
  const id = await keyHash(key);
  let record: ProjectKeyRecord = { id, project, created: now, last12: key.slice(-12), revoked: true };
  const raw = await store.get(PROJECT_KEY_RECORD_PREFIX + id);
  if (raw) {
    try {
      record = { ...(JSON.parse(raw) as ProjectKeyRecord), revoked: true };
    } catch {
      // unreadable record: overwrite with a clean tombstone
    }
  }
  await store.put(PROJECT_KEY_RECORD_PREFIX + id, JSON.stringify(record));
}

// ------------------------------------------- the ON / OFF / BROKEN switch
// One KV entry per key, by its record id (sg16p_<project>_<last12>), so every
// key can be switched, old record-less keys included. Absent = ON. OFF can be
// turned back on; BROKEN is final (a retired key, e.g. one nobody uses).
// KV is eventually consistent: a switch reaches every edge within ~60 s.

const PROJECT_CONTROL_PREFIX = "projctl:";
export type KeyControl = "on" | "off" | "broken";
const PROJECT_RECORD_ID = /^sg16p_[a-z0-9][a-z0-9-]{0,39}_[A-Za-z0-9_-]{12}$/;

export async function projectKeyControl(
  store: { get(key: string): Promise<string | null> },
  recordId: string,
): Promise<KeyControl> {
  const raw = await store.get(PROJECT_CONTROL_PREFIX + recordId);
  if (!raw) return "on";
  try {
    const state = (JSON.parse(raw) as { state?: unknown }).state;
    return state === "off" || state === "broken" ? state : "on";
  } catch {
    return "broken"; // unreadable: fail closed
  }
}

async function listProjectControls(env: DesignEnv): Promise<Map<string, KeyControl>> {
  const out = new Map<string, KeyControl>();
  let cursor: string | undefined;
  do {
    const page = await env.KEYS.list(cursor ? { prefix: PROJECT_CONTROL_PREFIX, cursor } : { prefix: PROJECT_CONTROL_PREFIX });
    for (const item of page.keys) {
      const id = item.name.slice(PROJECT_CONTROL_PREFIX.length);
      out.set(id, await projectKeyControl(env.KEYS, id));
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

async function setProjectControl(env: DesignEnv, recordId: string, state: KeyControl, now: number): Promise<KeyControl> {
  const current = await projectKeyControl(env.KEYS, recordId);
  if (current === "broken") return "broken"; // final
  if (state === "on") {
    await env.KEYS.delete(PROJECT_CONTROL_PREFIX + recordId);
    return "on";
  }
  await env.KEYS.put(PROJECT_CONTROL_PREFIX + recordId, JSON.stringify({ state, at: now }));
  if (state === "broken") {
    // keep the minted-key record in step: it shows as revoked everywhere
    for (const r of await listProjectKeyRecords(env)) {
      if (`${PROJECT_KEY_PREFIX}${r.project}_${r.last12}` === recordId && !r.revoked) await revokeProjectKeyRecord(env, r.id);
    }
  }
  return state;
}

// ------------------------------------------- project activity (admin box)
// The "Connected projects" box on /admin. Read-only: it joins the key records
// above with the D1 request log (index.ts logs every project-key call under
// projectKeyRecord's id, sg16p_<project>_<last12>). Nothing new is stored.

export const LIVE_WINDOW_MS = 5 * 60 * 1000;
export const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;
const ACTIVITY_LOOKBACK_MS = 30 * ACTIVE_WINDOW_MS;

export type ProjectStatus = "live" | "active" | "idle" | "never" | "off" | "broken" | "blocked";

export interface ActivityRow {
  key_id: string;
  project: string;
  last_ts: number;
  calls_24h: number;
  errors_24h: number;
  avg_ms_24h: number | null;
}

export interface ProjectActivity {
  /** the key's record id (sg16p_<project>_<last12>): what the ON/OFF/BROKEN switch acts on */
  id: string;
  /** the operator's switch for this key */
  control: KeyControl;
  project: string;
  last12: string;
  created: number | null;
  status: ProjectStatus;
  lastCall: number | null;
  calls24h: number;
  errors24h: number;
  avgMs24h: number | null;
}

const STATUS_ORDER: Record<ProjectStatus, number> = { live: 0, active: 1, idle: 2, never: 3, off: 4, broken: 5, blocked: 6 };

/** Merge key records with logged activity. Keys minted before records existed
 * still appear when they called within the lookback window. */
export function projectActivity(
  records: readonly ProjectKeyRecord[],
  rows: readonly ActivityRow[],
  revokedProjects: readonly string[],
  now: number,
  controls: ReadonlyMap<string, KeyControl> = new Map(),
): ProjectActivity[] {
  const byKeyId = new Map(rows.map((r) => [r.key_id, r]));
  const out: ProjectActivity[] = [];
  const entry = (project: string, last12: string, created: number | null, revoked: boolean, row?: ActivityRow) => {
    const id = `${PROJECT_KEY_PREFIX}${project}_${last12}`;
    const lastCall = row ? Number(row.last_ts) : null;
    // a revoked record is a retired key: the same as BROKEN
    const control: KeyControl = revoked ? "broken" : controls.get(id) ?? "on";
    const status: ProjectStatus = control === "broken" ? "broken"
      : revokedProjects.includes(project) ? "blocked"
      : control === "off" ? "off"
      : lastCall === null ? "never"
      : now - lastCall <= LIVE_WINDOW_MS ? "live"
      : now - lastCall <= ACTIVE_WINDOW_MS ? "active"
      : "idle";
    out.push({
      id, control, project, last12, created, status, lastCall,
      calls24h: row ? Number(row.calls_24h) || 0 : 0,
      errors24h: row ? Number(row.errors_24h) || 0 : 0,
      avgMs24h: row && row.avg_ms_24h !== null ? Math.round(Number(row.avg_ms_24h)) : null,
    });
  };
  for (const r of records) {
    const keyId = `${PROJECT_KEY_PREFIX}${r.project}_${r.last12}`;
    entry(r.project, r.last12, r.created, r.revoked, byKeyId.get(keyId));
    byKeyId.delete(keyId);
  }
  for (const row of byKeyId.values()) entry(row.project, row.key_id.slice(-12), null, false, row);
  return out.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (b.lastCall ?? 0) - (a.lastCall ?? 0));
}

async function activityRows(env: DesignEnv, now: number): Promise<ActivityRow[]> {
  const result = await env.LOGS.prepare(
    `SELECT key_id, project, MAX(ts) AS last_ts,
            SUM(CASE WHEN ts >= ?1 THEN 1 ELSE 0 END) AS calls_24h,
            SUM(CASE WHEN ts >= ?1 AND http >= 400 THEN 1 ELSE 0 END) AS errors_24h,
            AVG(CASE WHEN ts >= ?1 AND http < 400 THEN latency_ms END) AS avg_ms_24h
       FROM requests
      WHERE key_id LIKE 'sg16p\\_%' ESCAPE '\\' AND ts >= ?2
      GROUP BY key_id`,
  ).bind(now - ACTIVE_WINDOW_MS, now - ACTIVITY_LOOKBACK_MS).all<ActivityRow>();
  return result.results ?? [];
}

/** Per-key revocation for /v1. A key with no record is not managed by the
 * record system (every key minted before this feature) and keeps working. */
export async function isProjectKeyRevoked(store: { get(key: string): Promise<string | null> }, key: string): Promise<boolean> {
  const raw = await store.get(PROJECT_KEY_RECORD_PREFIX + (await keyHash(key)));
  if (!raw) return false;
  try {
    return (JSON.parse(raw) as ProjectKeyRecord).revoked === true;
  } catch {
    return true; // unreadable record: fail closed
  }
}

// ------------------------------------------------------------------ routes

interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * The device's remembered turns, so follow-up questions ("continue", "how?")
 * keep their context. The core keeps no host-side history; the design panel
 * re-sends the last few finished turns with every message and they reach the
 * model as real chat turns (owner request 2026-10-22: folding them into one
 * text confused the small chat model). Capped at the core's 8K chat budget.
 */
export function recentHistory(history: unknown, message: string): HistoryTurn[] {
  if (!Array.isArray(history)) return [];
  const turns: HistoryTurn[] = [];
  for (const item of history.slice(-6)) {
    if (!item || typeof item !== "object") continue;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const text = content.trim();
    if (text) turns.push({ role, content: text.slice(0, 800) });
  }
  const MESSAGE_BUDGET = 8192;
  let used = message.length;
  const kept: HistoryTurn[] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const cost = turns[i].content.length + turns[i].role.length + 4;
    if (used + cost > MESSAGE_BUDGET) break;
    kept.unshift(turns[i]);
    used += cost;
  }
  return kept;
}

export interface DesignCompatDeps {
  env: DesignEnv;
  /** Run one chat turn through the /v1/ask pipeline with a derived record. */
  chatDoor: (payload: unknown, record: KeyRecord) => Promise<Response>;
  /** Probe D1 and the inference VPS. */
  healthProbe: () => Promise<{ d1: boolean; model: boolean; power?: boolean }>;
  /** The operator's BRAIN POWER switch (held by the global queue DO); optional. */
  brainPower?: { get(): Promise<boolean>; set(on: boolean): Promise<boolean> };
  /** Free tokens left in a free-tier bucket (MatrixDO); optional. */
  freeTokens?: (record: KeyRecord) => Promise<number | null>;
  /** The /v1 key check (sg16_ KV keys and sg16p_ project keys); null when absent or invalid. */
  keyAuth: (authorization: string | null) => Promise<KeyRecord | null>;
}

export async function designCompatRoute(
  request: Request,
  path: string,
  deps: DesignCompatDeps,
): Promise<Response | null> {
  const { env } = deps;

  // ---- /api/identity: the design's operator sign-in --------------------
  if (path === "/api/identity" && request.method === "GET") {
    return json({
      service: "SG16 sign-in",
      accounts: "email-code",
      emailSignIn: Boolean(env.EMAIL),
      storage:
        "An account stores only its email, when it was created and last used, and its pass. Chat history and files stay on the visitor's device.",
      operatorLogin: operatorConfigured(env),
    });
  }
  if (path === "/api/identity" && request.method === "POST") {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return json({ ok: false, error: "JSON object required" }, 400);
    const action = String(body.action ?? "");
    if (action === "admin-login") {
      const networkKey = request.headers.get("cf-connecting-ip") ?? "unverified-network";
      const result = await adminLogin(body.email, body.password, networkKey, env);
      if (!result.ok) return json({ ok: false, error: result.error }, result.status);
      return json({ ok: true, token: result.token, email: result.email, admin: true });
    }
    const networkKey = request.headers.get("cf-connecting-ip") ?? "unverified-network";
    // visitor sign-up / sign-in, step 1: email a 6-digit code
    if (action === "request") {
      const sent = await requestCode(env, body.email, networkKey, Date.now(), new URL(request.url).host);
      if (!sent.ok) return json({ ok: false, error: sent.error }, sent.status);
      return json({ ok: true, sent: true });
    }
    // step 2: the right code signs in (and the first time, creates the account)
    if (action === "verify") {
      const result = await verifyCode(env, body.email, body.code, networkKey);
      if (!result.ok) return json({ ok: false, error: result.error }, result.status);
      const token = await signAccountToken(result.email, env.SG16_IDENTITY_SECRET ?? "");
      const pass = await linkPass(env, result.email, body.pass);
      const freeLeft = pass || !deps.freeTokens
        ? null
        : await deps.freeTokens(await accountFreeRecord(result.email)).catch(() => null);
      return json({
        ok: true, token, email: result.email, admin: false, account: true, created: result.created,
        pass: pass ? passRecordOf(pass) : null,
        ...(freeLeft !== null ? { freeTokensRemaining: freeLeft } : {}),
      });
    }
    if (action === "me") {
      const who = await signedInAs(request, env);
      if (!who) return json({ ok: false, error: "invalid token" }, 401);
      const pass = await linkPass(env, who.email, body.pass);
      const freeLeft = pass || !deps.freeTokens
        ? null
        : await deps.freeTokens(await accountFreeRecord(who.email)).catch(() => null);
      return json({
        ok: true, email: who.email, plan: null, admin: who.admin, account: true,
        tier: pass ? "work" : "free",
        pass: pass ? passRecordOf(pass) : null,
        ...(freeLeft !== null ? { freeTokensRemaining: freeLeft } : {}),
      });
    }
    if (action === "bind") {
      const who = await signedInAs(request, env);
      if (!who) return json({ ok: false, error: "Sign in first." }, 401);
      const pass = await linkPass(env, who.email, body.pass);
      return json({ ok: true, pass: pass ? passRecordOf(pass) : null });
    }
    return json({ ok: false, error: "unknown action" }, 400);
  }

  // ---- /api/admin/project-keys: the operator's key mint ----------------
  if (path === "/api/admin/project-keys" && (request.method === "GET" || request.method === "POST" || request.method === "DELETE")) {
    const signedIn = Boolean(request.headers.get("authorization"));
    const operator = await operatorBearer(request, env);
    if (!operator) {
      return json(
        { error: signedIn ? "This account is not an operator." : "Operator sign-in required." },
        signedIn ? 403 : 401,
      );
    }
    if (request.method === "GET") {
      return json({
        configured: Boolean(env.SG16_PROJECT_KEY_SECRET?.trim()),
        revoked: revokedProjects(env),
        keys: await listProjectKeyRecords(env),
      });
    }
    if (request.method === "DELETE") {
      const params = new URL(request.url).searchParams;
      const keyParam = (params.get("key") ?? "").trim();
      const idParam = (params.get("id") ?? "").trim();
      let id: string;
      if (keyParam) {
        if (!keyParam.startsWith(PROJECT_KEY_PREFIX)) {
          return json({ error: "key must be a sg16p_ project key." }, 400);
        }
        id = await keyHash(keyParam);
      } else if (idParam) {
        if (!/^[0-9a-f]{64}$/.test(idParam)) {
          return json({ error: "id must be the 64-hex fingerprint of a project key." }, 400);
        }
        id = idParam;
      } else {
        return json({ error: "Pass ?id=<64-hex fingerprint> or ?key=<sg16p_ key>." }, 400);
      }
      const revoked = await revokeProjectKeyRecord(env, id);
      if (!revoked) return json({ error: "No project-key record with that id." }, 404);
      return json({ ok: true, id: revoked.id, project: revoked.project, revoked: true });
    }
    const secret = env.SG16_PROJECT_KEY_SECRET?.trim();
    if (!secret || secret.length < 32) {
      return json({ error: "SG16_PROJECT_KEY_SECRET is not set on this server (32+ characters)." }, 503);
    }
    const body = await request.json().catch(() => null) as { project?: unknown } | null;
    const project = typeof body?.project === "string" ? body.project.trim().toLowerCase() : "";
    if (!isValidProjectName(project)) {
      return json({ error: "Project name: 1-40 characters, lowercase letters, digits and dashes." }, 400);
    }
    const key = await createProjectKey(project, secret);
    // Record the fingerprint BEFORE the key is disclosed: if the put throws,
    // the key is never shown, so no valid key is left unmanaged.
    await recordProjectKey(env, key, project, Date.now());
    return json({ project, key, shownOnce: true });
  }

  // ---- /api/admin/project-activity: the "Connected projects" box --------
  if (path === "/api/admin/project-activity" && request.method === "GET") {
    const signedIn = Boolean(request.headers.get("authorization"));
    const operator = await operatorBearer(request, env);
    if (!operator) {
      return json(
        { error: signedIn ? "This account is not an operator." : "Operator sign-in required." },
        signedIn ? 403 : 401,
      );
    }
    const now = Date.now();
    const [records, rows, controls] = await Promise.all([listProjectKeyRecords(env), activityRows(env, now), listProjectControls(env)]);
    return json({
      now,
      liveWindowMs: LIVE_WINDOW_MS,
      projects: projectActivity(records, rows, revokedProjects(env), now, controls),
    });
  }

  // ---- /api/admin/project-control: one key ON / OFF / BROKEN ------------
  if (path === "/api/admin/project-control" && request.method === "POST") {
    const signedIn = Boolean(request.headers.get("authorization"));
    const operator = await operatorBearer(request, env);
    if (!operator) {
      return json({ error: signedIn ? "This account is not an operator." : "Operator sign-in required." }, signedIn ? 403 : 401);
    }
    const body = await request.json().catch(() => null) as { id?: unknown; state?: unknown } | null;
    const id = typeof body?.id === "string" ? body.id : "";
    const state = body?.state;
    if (!PROJECT_RECORD_ID.test(id) || (state !== "on" && state !== "off" && state !== "broken")) {
      return json({ error: "Send { id: <key id from the list>, state: \"on\" | \"off\" | \"broken\" }." }, 400);
    }
    const before = await projectKeyControl(env.KEYS, id);
    if (before === "broken" && state !== "broken") {
      return json({ error: "This key is broken (retired for good). Create a new key instead.", id, control: "broken" }, 409);
    }
    const control = await setProjectControl(env, id, state, Date.now());
    return json({ ok: true, id, control });
  }

  // ---- /api/admin/brain-power: the BRAIN POWER switch -------------------
  if (path === "/api/admin/brain-power" && (request.method === "GET" || request.method === "POST")) {
    const signedIn = Boolean(request.headers.get("authorization"));
    const operator = await operatorBearer(request, env);
    if (!operator) {
      return json({ error: signedIn ? "This account is not an operator." : "Operator sign-in required." }, signedIn ? 403 : 401);
    }
    if (!deps.brainPower) return json({ error: "The brain switch is not available on this server." }, 503);
    if (request.method === "GET") return json({ on: await deps.brainPower.get() });
    const body = await request.json().catch(() => null) as { on?: unknown } | null;
    if (typeof body?.on !== "boolean") return json({ error: "Send { on: true } or { on: false }." }, 400);
    return json({ ok: true, on: await deps.brainPower.set(body.on) });
  }

  // ---- /api/brain: the design's chat panel ------------------------------
  if (path === "/api/brain" && request.method === "GET") {
    const probe = new URL(request.url).searchParams.get("probe");
    if (probe === "turnstile") return json({ enabled: false, siteKey: null });
    if (probe === "health") {
      const health = await deps.healthProbe();
      if (health.power === false) return json({ ok: false, brain: "off" }, 503);
      const up = health.d1 && health.model;
      return json({ ok: up, brain: up ? "online" : "offline" }, up ? 200 : 503);
    }
    return json(
      { error: "Conversation history is kept on your device, not on this server.", stored: false, storedOn: "device" },
      404,
    );
  }
  if (path === "/api/brain" && request.method === "POST") {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return json({ error: "The SG16 core is unreachable. Try again." }, 400);
    if (typeof body.forgetSessionId === "string" && body.forgetSessionId) {
      return json({ ok: true, forgotten: true });
    }
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return json({ error: "Enter a message." }, 400);
    if (message.length > 8192) return json({ error: "A chat message is at most 8K characters." }, 400);
    // The connector contract (docs/SG16-CONNECTOR-API.md): a project body
    // forwards its key as a Bearer and is rate-limited as that project, never
    // as one anonymous visitor behind its server's address (the old host's
    // work tier). Then the design's own contract: a device-held pass is
    // verified server-side; absent or expired -> free tier under the
    // standard host limits.
    // A signed-in visitor (account token) chats on their account: a pass
    // held on this device is kept with the account, and a pass the account
    // already holds works here too. Without a pass, the account's own
    // one-time free tokens are used. Visitors who are not signed in and hold
    // no pass are asked to sign in (free), so the allowance follows people.
    const keyed = await deps.keyAuth(request.headers.get("authorization"));
    const who = keyed ? null : await signedInAs(request, env);
    let pass = keyed ? null : await resolvePass(request.headers.get("x-sg16-pass"), env);
    if (who) {
      const stored = await accountPass(env, who.email).catch(() => null);
      if (pass) await rememberPass(env, who.email, pass.pass, stored).catch(() => undefined);
      else if (stored) pass = await resolvePass(stored, env);
    }
    if (!keyed && /^Bearer\s+sg16p_/i.test(request.headers.get("authorization") ?? "")) {
      return json(
        { error: "This API key is not working: it is switched off, retired or not valid. Ask the operator.", keyOff: true },
        403,
      );
    }
    if (!keyed && !pass && !who) {
      return json(
        {
          error: `Sign in free to chat: new accounts get ${freeTokenAllowance(env.FREE_TOKEN_ALLOWANCE).toLocaleString("en-US")} free tokens. Press My Domain (or Sign In in the menu).`,
          signInRequired: true,
          signInUrl: "/login",
          tier: "free",
        },
        401,
        { "X-Chat-Tier": "free" },
      );
    }
    const record = keyed
      ?? (pass ? await passKeyRecord(pass.pass, pass.activatedAt) : await accountFreeRecord(who!.email));
    const tier = keyed || pass ? "work" : "free";
    const tierHeaders: Record<string, string> = { "X-Chat-Tier": tier };
    // An API project (keyed) gets the brain clean: its message, its own rules
    // (`system`) and its history go through as sent — no SG16 wrapper. The
    // website's visitors get SG16's rules with their recent turns.
    const res = await deps.chatDoor(
      keyed
        ? { kind: "chat", text: message, system: body.system, history: body.history }
        : { kind: "chat", text: message, history: recentHistory(body.history, message) },
      record,
    );
    const out = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (res.ok && out && out.ok === true && typeof out.answer === "string") {
      const meta = (out.meta ?? {}) as Record<string, unknown>;
      // free tier: tell the client how much of its one-time allowance is left
      const freeLeft = typeof meta.free_tokens_remaining === "number" ? meta.free_tokens_remaining : null;
      if (freeLeft !== null) tierHeaders["X-Free-Tokens-Remaining"] = String(freeLeft);
      const sessionId =
        typeof body.sessionId === "string" && body.sessionId ? body.sessionId : crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const reply = {
        sessionId,
        userMessage: {
          id: crypto.randomUUID(), sessionId, role: "user", content: message,
          modelId: "sg16-brain", relay: false, latencyMs: 0, createdAt,
        },
        assistantMessage: {
          id: crypto.randomUUID(), sessionId, role: "assistant", content: out.answer,
          modelId: "sg16-brain", relay: false,
          latencyMs: typeof meta.latency_ms === "number" ? meta.latency_ms : 0, createdAt,
        },
        brain: typeof meta.engine === "string" ? meta.engine : "sg16",
        tier,
        ...(freeLeft !== null ? { freeTokensRemaining: freeLeft } : {}),
      };
      if (body.stream === true) {
        const ndjson =
          JSON.stringify({ type: "delta", text: out.answer }) + "\n" + JSON.stringify({ type: "done", ...reply }) + "\n";
        return new Response(ndjson, {
          headers: { "content-type": "application/x-ndjson", "cache-control": "no-store", ...tierHeaders },
        });
      }
      return json(reply, 200, tierHeaders);
    }
    const code = String(out?.code ?? "E_INTERNAL");
    if (code === "E_FREE_TOKENS") {
      // shown as-is in the chat panel's existing error line, next to its
      // "FREE · GET A PASS" chip (which links to /subscription)
      return json(
        {
          error: "Your free SG16 Brain tokens are used up. Get a pass on the Subscription page to keep chatting.",
          freeTokensExhausted: true,
          freeTokensRemaining: 0,
          subscribeUrl: "/subscription",
          tier,
        },
        402,
        { ...tierHeaders, "X-Free-Tokens-Remaining": "0" },
      );
    }
    if (code === "E_BRAIN_OFF") {
      return json(
        { error: "SG16 Brain is switched off by the operator right now. Please come back a little later.", brainOff: true, tier },
        503,
        tierHeaders,
      );
    }
    if (res.status === 429) {
      return json(
        { error: "You're sending messages very quickly - please wait a few seconds and try again.", rateLimited: true, retryAt: Date.now() + 60_000, tier },
        429,
        tierHeaders,
      );
    }
    if (code === "E_QUEUE_TIMEOUT") {
      return json({ error: "The SG16 core is busy right now. Try again shortly.", busy: true }, 503, tierHeaders);
    }
    if (code === "E_FORBIDDEN") {
      return json({ error: "The request is not allowed by the SG16 policy." }, 403, tierHeaders);
    }
    if (code === "E_BAD_REQUEST") {
      return json({ error: "Bad request: \"system\" must be text of at most 16K characters." }, 400, tierHeaders);
    }
    return json({ error: "The SG16 core is unreachable. Try again." }, 503, tierHeaders);
  }

  // ---- /api/models: the one honest model ---------------------------------
  if (path === "/api/models" && request.method === "GET") {
    const health = await deps.healthProbe();
    const status = health.model ? "online" : "offline";
    const models = [{
      id: "sg16-brain",
      name: "SG16 Brain",
      vendor: "Sovereign Systems",
      role: "Open, independent and friendly to everyone",
      description: "",
      glyph: "brain",
      accent: "#22e08c",
      status,
      latencyMs: null,
      contextWindow: "8K chars",
      selfHosted: true,
      capabilities: [],
      sortOrder: 0,
    }];
    const operator = await operatorBearer(request, env);
    if (operator) {
      const brain = env.MODEL_NAME || SG16_BRAIN_MODEL;
      return json({
        models,
        engines: [
          { id: brain, label: "SG16 Brain Q4_K_M, self-hosted through the tunnel (the one brain)", primary: true },
        ],
      });
    }
    return json({ models });
  }

  return null;
}

/**
 * Keep the device's pass (if it sent a valid one) with the account, then
 * return the valid pass the account holds, or null.
 */
async function linkPass(env: DesignEnv, email: string, devicePass: unknown): Promise<string | null> {
  try {
    const stored = await accountPass(env, email);
    const device = typeof devicePass === "string" && devicePass.length <= 8000
      ? await resolvePass(devicePass, env)
      : null;
    const held = device ? await rememberPass(env, email, device.pass, stored) : stored;
    return held && (await resolvePass(held, env)) ? held : null;
  } catch {
    return null;
  }
}

function revokedProjects(env: DesignEnv): string[] {
  return (env.SG16_REVOKED_PROJECTS ?? "")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
}

// ------------------------------------------------------------------ rsc routes
// Next.js client-side navigation asks the origin for a flight payload
// (header rsc: 1, response content-type text/x-component). The mirrored
// design is a static export, so those requests used to fall through to the
// page HTML and the router died with "This page couldn't load" (E394) —
// every in-site link, and the post-login jump to /admin, was broken.
// The payload the router expects is the same flight stream embedded in each
// page's own HTML, extracted once into site/rsc/<route>.txt by
// scripts/extract-rsc.mjs and staged by sync-web.mjs. Serve it with the same
// headers the old host sent.

const RSC_ROUTES = new Set([
  "", "/admin", "/api-access", "/chat", "/contact", "/files", "/history",
  "/login", "/services", "/signed-out", "/subscription", "/support", "/vision",
]);

export async function designRscRoute(
  request: Request,
  path: string,
  assets: Fetcher,
): Promise<Response | null> {
  if (request.method !== "GET") return null;
  if (!request.headers.get("rsc")) return null;
  if (request.headers.get("next-action")) return null; // server actions are not part of the design
  const route = path === "/" ? "" : path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  if (route.includes("/", 1)) return null; // the design's routes are flat
  if (!RSC_ROUTES.has(route)) return null;
  const assetPath = route === "" ? "/rsc/index.txt" : "/rsc" + route + ".txt";
  const asset = await assets.fetch("https://assets.local" + assetPath);
  if (!asset.ok) return null;
  return new Response(asset.body, {
    status: 200,
    headers: {
      "content-type": "text/x-component",
      "cache-control": "public, max-age=300, stale-while-revalidate=86400",
      "vary": "rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch",
      "x-nextjs-prerender": "1",
      "x-nextjs-stale-time": "300",
    },
  });
}
