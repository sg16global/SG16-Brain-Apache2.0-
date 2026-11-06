// SG16 BRAIN CORE — visitor accounts (owner request 2026-11-06).
//
// Sign-up and sign-in are one step: the visitor gives an email, gets a
// 6-digit code from the site (Cloudflare Email Sending, binding EMAIL,
// sender EMAIL_FROM) and enters it. The first verified code creates the account.
//
// An account carries two things:
//   * the one-time free token allowance (its own ledger bucket in MatrixDO,
//     so it follows the person, not the internet connection), and
//   * the visitor's pass, so a pass bought on one device works on every
//     device they sign in on.
//
// D1 holds only: accounts(email, created_at, last_login_at, pass) and
// login_codes (one live code per email, stored as an HMAC, never the code).
// The tables are created on first use, so no manual migration is needed.

import type { KeyRecord } from "./types.ts";
import { resolvePass, type ClientEnv } from "./client-routes.ts";

/** Cloudflare Email Sending: the `send_email` binding's structured message. */
export interface SendEmailBinding {
  send(message: {
    to: string;
    from: string | { email: string; name?: string };
    subject: string;
    text?: string;
    html?: string;
  }): Promise<{ messageId?: string }>;
}

export interface AccountEnv extends ClientEnv {
  EMAIL?: SendEmailBinding;
  EMAIL_FROM?: string;
  SG16_IDENTITY_SECRET?: string;
}

export type Outcome<T = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; status: number; error: string };

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const CODE_TTL_MS = 10 * 60_000;
export const RESEND_WAIT_MS = 60_000;
export const SENDS_PER_HOUR = 5;
export const MAX_CODE_ATTEMPTS = 5;

const HOUR_MS = 3600_000;
const NETWORK_WINDOW_MS = 10 * 60_000;
const NETWORK_SENDS = 10;
const NETWORK_VERIFIES = 30;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

// ------------------------------------------------------------------- tables

let tablesReady = new WeakMap<D1Database, Promise<void>>();

export function ensureAccountTables(db: D1Database): Promise<void> {
  let ready = tablesReady.get(db);
  if (!ready) {
    ready = db
      .batch([
        db.prepare(
          `CREATE TABLE IF NOT EXISTS accounts (
             email         TEXT PRIMARY KEY,
             created_at    INTEGER NOT NULL,
             last_login_at INTEGER NOT NULL,
             pass          TEXT
           )`,
        ),
        db.prepare(
          `CREATE TABLE IF NOT EXISTS login_codes (
             email      TEXT PRIMARY KEY,
             code_hash  TEXT NOT NULL,
             expires_at INTEGER NOT NULL,
             attempts   INTEGER NOT NULL DEFAULT 0,
             sent_at    INTEGER NOT NULL,
             sends_hour INTEGER NOT NULL DEFAULT 1,
             hour_start INTEGER NOT NULL
           )`,
        ),
      ])
      .then(() => undefined)
      .catch((e) => {
        tablesReady.delete(db); // try again on the next request
        throw e;
      });
    tablesReady.set(db, ready);
  }
  return ready;
}

/** Tests use a fresh database per case. */
export function resetAccountTablesForTests(): void {
  tablesReady = new WeakMap();
}

function changes(result: unknown): number {
  const r = result as { meta?: { changes?: number }; changes?: number } | null;
  return Number(r?.meta?.changes ?? r?.changes ?? 0);
}

// ---------------------------------------------------------------- throttles
// Per-isolate, best effort: one network cannot spray codes at many emails.
// The per-email limits below live in D1 and hold across isolates.

const networkHits = new Map<string, { count: number; resetAt: number }>();

function networkAllowed(kind: string, networkKey: string, limit: number, now: number): boolean {
  const key = `${kind}|${networkKey}`;
  const hit = networkHits.get(key);
  if (!hit || hit.resetAt <= now) {
    if (networkHits.size > 5000) networkHits.clear();
    networkHits.set(key, { count: 1, resetAt: now + NETWORK_WINDOW_MS });
    return true;
  }
  if (hit.count >= limit) return false;
  hit.count += 1;
  return true;
}

export function resetThrottlesForTests(): void {
  networkHits.clear();
}

// -------------------------------------------------------------------- codes

function sixDigits(): string {
  const a = new Uint32Array(1);
  // 4_294_000_000 is a multiple of 1_000_000: rejecting above it keeps every code equally likely
  do crypto.getRandomValues(a); while (a[0] >= 4_294_000_000);
  return String(a[0] % 1_000_000).padStart(6, "0");
}

async function codeHash(secret: string, email: string, code: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`sg16-login-code-v1|${email}|${code}`)),
  );
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The sender from EMAIL_FROM ("Name <addr>" or "addr"); null when not set. */
export function senderOf(raw: string | undefined): { email: string; name?: string } | null {
  const value = (raw ?? "").trim();
  const named = /^(.*?)\s*<([^<>\s]+@[^<>\s]+)>$/.exec(value);
  if (named) return named[1] ? { email: named[2], name: named[1].replace(/^"|"$/g, "") } : { email: named[2] };
  if (EMAIL_PATTERN.test(value)) return { email: value };
  return null;
}

function codeEmail(code: string, site: string): { subject: string; text: string; html: string } {
  const subject = `${code} is your SG16 Brain sign-in code`;
  const text =
    `Your SG16 Brain sign-in code is ${code}\n\n` +
    `Enter it on ${site} within 10 minutes. If this is your first time, the code also creates your free account.\n\n` +
    "If you did not ask for this code, you can ignore this email: nobody can sign in without it.\n\n" +
    `Sovereign SG16 Brain - ${site}`;
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0b0d12;color:#e2e8f0;border-radius:12px">' +
    '<p style="margin:0 0 6px;font-size:12px;letter-spacing:2px;color:#f87171">SOVEREIGN SG16 BRAIN</p>' +
    '<p style="margin:0 0 18px;font-size:15px">Your sign-in code:</p>' +
    `<p style="margin:0 0 18px;font-size:34px;font-weight:bold;letter-spacing:8px;color:#ffffff">${code}</p>` +
    `<p style="margin:0 0 12px;font-size:13px;line-height:1.6">Enter it on ${escapeHtml(site)} within 10 minutes. ` +
    "If this is your first time, the code also creates your free account.</p>" +
    '<p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8">If you did not ask for this code, you can ignore this email: nobody can sign in without it.</p>' +
    "</div>";
  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Send a sign-in code. The same answer for new and existing emails: nobody can probe who has an account. */
export async function requestCode(
  env: AccountEnv,
  rawEmail: unknown,
  networkKey: string,
  now = Date.now(),
  site = "the SG16 Brain website",
): Promise<Outcome> {
  const secret = (env.SG16_IDENTITY_SECRET ?? "").trim();
  const sender = senderOf(env.EMAIL_FROM);
  if (!env.EMAIL || !secret || !sender) return { ok: false, status: 503, error: "Email sign-in is not switched on yet. Please try again later." };
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, status: 400, error: "Enter a valid email address." };
  if (!networkAllowed("send", networkKey, NETWORK_SENDS, now)) {
    return { ok: false, status: 429, error: "Too many codes asked from this connection. Wait ten minutes and try again." };
  }
  const db = env.LOGS;
  await ensureAccountTables(db);
  const row = await db
    .prepare("SELECT sent_at, sends_hour, hour_start FROM login_codes WHERE email = ?")
    .bind(email)
    .first<{ sent_at: number; sends_hour: number; hour_start: number }>();
  if (row && now - row.sent_at < RESEND_WAIT_MS) {
    return { ok: false, status: 429, error: "A code was just sent. Wait a minute before asking for another one." };
  }
  const sameHour = Boolean(row && now - row.hour_start < HOUR_MS);
  const sends = (sameHour ? row!.sends_hour : 0) + 1;
  if (sends > SENDS_PER_HOUR) {
    return { ok: false, status: 429, error: "Too many codes for this email. Try again in an hour." };
  }
  const code = sixDigits();
  const hash = await codeHash(secret, email, code);
  await db
    .prepare(
      `INSERT INTO login_codes (email, code_hash, expires_at, attempts, sent_at, sends_hour, hour_start)
       VALUES (?, ?, ?, 0, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
         attempts = 0, sent_at = excluded.sent_at, sends_hour = excluded.sends_hour, hour_start = excluded.hour_start`,
    )
    .bind(email, hash, now + CODE_TTL_MS, now, sends, sameHour ? row!.hour_start : now)
    .run();
  try {
    await env.EMAIL.send({ to: email, from: sender, ...codeEmail(code, site) });
  } catch (e) {
    const errCode = String((e as { code?: unknown })?.code ?? "");
    console.error("sign-in email not sent", errCode, e instanceof Error ? e.message : String(e));
    // the code never arrived: retire it, and let the visitor ask again at once
    await db
      .prepare("UPDATE login_codes SET expires_at = 0, sent_at = 0 WHERE email = ? AND code_hash = ?")
      .bind(email, hash)
      .run()
      .catch(() => undefined);
    if (/SENDER|DOMAIN|SUSPENDED/.test(errCode)) {
      return { ok: false, status: 503, error: "Email sign-in is not switched on yet. Please try again later." };
    }
    if (/RATE_LIMIT|DAILY_LIMIT/.test(errCode)) {
      return { ok: false, status: 503, error: "Too many sign-in emails are going out right now. Try again later." };
    }
    return { ok: false, status: 502, error: "We could not send the email. Check the address and try again." };
  }
  return { ok: true };
}

/** Check a code. The first right code for an email creates its account. */
export async function verifyCode(
  env: AccountEnv,
  rawEmail: unknown,
  rawCode: unknown,
  networkKey: string,
  now = Date.now(),
): Promise<Outcome<{ email: string; created: boolean }>> {
  const secret = (env.SG16_IDENTITY_SECRET ?? "").trim();
  if (!secret) return { ok: false, status: 503, error: "Email sign-in is not switched on yet. Please try again later." };
  const email = normalizeEmail(rawEmail);
  const code = typeof rawCode === "string" ? rawCode.replace(/\s+/g, "") : "";
  if (!email || !/^\d{6}$/.test(code)) return { ok: false, status: 400, error: "Enter your email and the 6-digit code." };
  if (!networkAllowed("verify", networkKey, NETWORK_VERIFIES, now)) {
    return { ok: false, status: 429, error: "Too many tries from this connection. Wait ten minutes and try again." };
  }
  const db = env.LOGS;
  await ensureAccountTables(db);
  const row = await db
    .prepare("SELECT code_hash, expires_at FROM login_codes WHERE email = ?")
    .bind(email)
    .first<{ code_hash: string; expires_at: number }>();
  if (!row || row.expires_at <= now) {
    return { ok: false, status: 400, error: "This code has expired. Ask for a new one." };
  }
  // count the try first, atomically: parallel guesses cannot exceed the limit
  const counted = await db
    .prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE email = ? AND code_hash = ? AND attempts < ? AND expires_at > ?")
    .bind(email, row.code_hash, MAX_CODE_ATTEMPTS, now)
    .run();
  if (changes(counted) !== 1) {
    return { ok: false, status: 429, error: "Too many wrong codes. Ask for a new one." };
  }
  if (!sameHex(await codeHash(secret, email, code), row.code_hash)) {
    return { ok: false, status: 401, error: "That code is not right. Check the email and try again." };
  }
  // a code works once
  const used = await db
    .prepare("DELETE FROM login_codes WHERE email = ? AND code_hash = ?")
    .bind(email, row.code_hash)
    .run();
  if (changes(used) !== 1) return { ok: false, status: 400, error: "This code has expired. Ask for a new one." };
  const existing = await db.prepare("SELECT email FROM accounts WHERE email = ?").bind(email).first();
  await db
    .prepare(
      `INSERT INTO accounts (email, created_at, last_login_at, pass) VALUES (?, ?, ?, NULL)
       ON CONFLICT(email) DO UPDATE SET last_login_at = excluded.last_login_at`,
    )
    .bind(email, now, now)
    .run();
  return { ok: true, email, created: !existing };
}

// ------------------------------------------------------------------ the pass

/** The pass stored with the account (the X-SG16-Pass value), or null. */
export async function accountPass(env: AccountEnv, email: string): Promise<string | null> {
  await ensureAccountTables(env.LOGS);
  const row = await env.LOGS.prepare("SELECT pass FROM accounts WHERE email = ?").bind(email).first<{ pass: string | null }>();
  return typeof row?.pass === "string" && row.pass ? row.pass : null;
}

/** The signed pass record inside an X-SG16-Pass value (base64url JSON), or null for legacy tokens. */
export function passRecordOf(value: string): Record<string, unknown> | null {
  try {
    const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const record = JSON.parse(atob(padded)) as unknown;
    return record && typeof record === "object" && !Array.isArray(record) ? (record as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function expiresAt(value: string): number {
  const exp = passRecordOf(value)?.expires_at;
  return typeof exp === "number" && Number.isFinite(exp) ? exp : 0;
}

/**
 * Keep a verified pass with the account when the account has none, its
 * stored one is no longer valid, or this one runs longer. Returns the pass
 * the account holds afterwards.
 */
export async function rememberPass(
  env: AccountEnv,
  email: string,
  verifiedPass: string,
  stored?: string | null,
): Promise<string> {
  const current = stored === undefined ? await accountPass(env, email) : stored;
  if (current === verifiedPass) return current;
  const keep = current && (await resolvePass(current, env)) && expiresAt(current) >= expiresAt(verifiedPass);
  if (keep) return current!;
  await env.LOGS.prepare("UPDATE accounts SET pass = ? WHERE email = ?").bind(verifiedPass, email).run();
  return verifiedPass;
}

// --------------------------------------------------------------- the tokens

/** The account's own free-token bucket ("free_" ids are metered by the core). */
export async function accountFreeRecord(email: string): Promise<KeyRecord> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("free|account|" + email)));
  const hex = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { id: "free_" + hex.slice(0, 12), user: 0, project: "web", created: 0, revoked: false };
}
