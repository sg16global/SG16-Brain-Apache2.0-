// SG16 BRAIN CORE — free chat trial for visitors (owner request 2026-11-13).
//
// A visitor who is not signed in and holds no pass can chat for free, with no
// sign-in, for FREE_TRIAL_DAYS days (default 3, at most 7) from their first
// message. After that the chat asks for a pass (subscription).
// FREE_TRIAL_DAYS = "0" switches the trial off: visitors are asked to sign in,
// exactly as before.
//
// The trial clock lives in a signed, HttpOnly cookie the Worker sets itself
// on /api, so the public design's pages need no change: the browser sends it
// back on the next same-origin fetch. The cookie is kept for a year, so an
// ended trial stays ended in that browser. Signed with SG16_IDENTITY_SECRET:
// a visitor cannot move their own start date. Without that secret there is
// no trial (sign-in, as before).
//
// The trial's key record is per network (cf-connecting-ip), not per cookie,
// so the standard per-record rate limit holds even for clients that drop
// cookies. Trial chat is not metered against the free-token allowance.

import type { KeyRecord } from "./types.ts";

export const TRIAL_COOKIE = "sg16_trial";
export const DEFAULT_TRIAL_DAYS = 3;
export const MAX_TRIAL_DAYS = 7;
const DAY_MS = 86_400_000;
const COOKIE_MAX_AGE_S = 365 * 86_400;

/** Parse FREE_TRIAL_DAYS: missing/invalid -> 3; "0" -> off; capped at 7. */
export function trialDays(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_TRIAL_DAYS;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) return DEFAULT_TRIAL_DAYS;
  return Math.min(n, MAX_TRIAL_DAYS);
}

async function sign(secret: string, start: number, id: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`sg16-trial-v1|${start}|${id}`)),
  );
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cookieValue(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** The trial start (unix ms) from a valid signed cookie, or null. */
export async function readTrialStart(cookieHeader: string | null, secret: string, now: number): Promise<number | null> {
  const value = cookieValue(cookieHeader, TRIAL_COOKIE);
  const m = value ? /^v1\.(\d{1,15})\.([0-9a-f]{32})\.([0-9a-f]{64})$/.exec(value) : null;
  if (!m) return null;
  const start = Number(m[1]);
  if (!Number.isSafeInteger(start) || start > now + 60_000) return null;
  return sameHex(await sign(secret, start, m[2]), m[3]) ? start : null;
}

/** A Set-Cookie header value starting a new trial at `now`. */
export async function newTrialCookie(secret: string, now: number): Promise<string> {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const id = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const value = `v1.${now}.${id}.${await sign(secret, now, id)}`;
  return `${TRIAL_COOKIE}=${value}; Max-Age=${COOKIE_MAX_AGE_S}; Path=/api; HttpOnly; Secure; SameSite=Lax`;
}

export type TrialState =
  | { state: "off" }
  | { state: "active"; endsAt: number; setCookie?: string }
  | { state: "ended"; endsAt: number };

/** Where this visitor's free trial stands; a first visit starts it. */
export async function visitorTrial(
  cookieHeader: string | null,
  secret: string | undefined,
  rawDays: string | undefined,
  now = Date.now(),
): Promise<TrialState> {
  const days = trialDays(rawDays);
  const key = (secret ?? "").trim();
  if (days === 0 || !key) return { state: "off" };
  const start = await readTrialStart(cookieHeader, key, now);
  if (start === null) return { state: "active", endsAt: now + days * DAY_MS, setCookie: await newTrialCookie(key, now) };
  const endsAt = start + days * DAY_MS;
  return now < endsAt ? { state: "active", endsAt } : { state: "ended", endsAt };
}

/** The trial's key record: one rate-limit bucket per network, project "web". */
export async function trialRecord(networkKey: string): Promise<KeyRecord> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("trial|net|" + networkKey)));
  const hex = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { id: "trial_" + hex.slice(0, 12), user: 0, project: "web", created: 0, revoked: false };
}
