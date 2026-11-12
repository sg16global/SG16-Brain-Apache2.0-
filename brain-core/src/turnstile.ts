// SG16 BRAIN CORE — Cloudflare Turnstile for free-trial chat (owner request
// 2026-11-13). Ported from the old host (pointoni/src/lib/turnstile.ts).
//
// OFF until the owner sets BOTH keys (TURNSTILE_SITE_KEY as a var,
// TURNSTILE_SECRET_KEY as a secret): a deploy without them changes nothing.
// When on, a visitor on the free trial proves once that they are a person;
// the chat panel already carries the widget (it asks GET
// /api/brain?probe=turnstile) and sends the token with the message. Pass
// holders and API projects are never asked.
//
// After one good check the visitor gets a short-lived "human token" (15
// minutes) so they are not asked again for every message. Unlike the old
// host's in-memory store it is signed (SG16_IDENTITY_SECRET), so it works on
// every Worker instance.
//
// FAIL OPEN: if Cloudflare cannot be reached, the check is skipped (the rate
// limit and the queue priority still hold). That is decided by the server's
// own probe of Cloudflare, never by anything the client sends.

export const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const HUMAN_TOKEN_TTL_MS = 15 * 60_000;

export interface TurnstileEnv {
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  SG16_IDENTITY_SECRET?: string;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** On only when both keys are set (and the identity secret that signs human tokens). */
export function turnstileEnabled(env: TurnstileEnv): boolean {
  return Boolean(env.TURNSTILE_SITE_KEY?.trim() && env.TURNSTILE_SECRET_KEY?.trim() && env.SG16_IDENTITY_SECRET?.trim());
}

/** Public by design (the widget embeds it); never the secret. */
export function turnstileSiteKey(env: TurnstileEnv): string | null {
  return turnstileEnabled(env) ? env.TURNSTILE_SITE_KEY!.trim() : null;
}

/** "pass"/"fail" are Cloudflare's answer; "error" means no answer was had. */
export async function verifyTurnstileToken(
  token: string,
  secret: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 3000,
): Promise<"pass" | "fail" | "error"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // no visitor IP is sent: the check works without it
    const res = await fetchImpl(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }).toString(),
      signal: controller.signal,
    });
    if (res.status >= 500) return "error";
    const data = (await res.json().catch(() => null)) as { success?: unknown } | null;
    if (!data) return "error";
    return data.success === true ? "pass" : "fail";
  } catch {
    return "error";
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------ human token

async function sign(secret: string, exp: number, nonce: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`sg16-human-v1|${exp}|${nonce}`)),
  );
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function mintHumanToken(secret: string, now = Date.now()): Promise<string> {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const exp = now + HUMAN_TOKEN_TTL_MS;
  return `h1.${exp}.${nonce}.${await sign(secret, exp, nonce)}`;
}

export async function humanTokenValid(token: unknown, secret: string, now = Date.now()): Promise<boolean> {
  if (typeof token !== "string" || token.length > 128) return false;
  const m = /^h1\.(\d{1,15})\.([0-9a-f]{32})\.([0-9a-f]{64})$/.exec(token);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!Number.isSafeInteger(exp) || exp <= now || exp > now + HUMAN_TOKEN_TTL_MS) return false;
  const expected = await sign(secret, exp, m[2]);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ m[3].charCodeAt(i);
  return diff === 0;
}

// ------------------------------------------------------------- the check

export type HumanCheck =
  | { ok: true; humanToken?: string; skipped?: "disabled" | "fail-open" }
  | { ok: false };

// per isolate: a flood of token-less requests probes Cloudflare at most every 30 s
const reachability = { at: 0, ok: true };

export function resetTurnstileForTests(): void {
  reachability.at = 0;
  reachability.ok = true;
}

async function cloudflareReachable(secret: string, fetchImpl: FetchLike, now: number): Promise<boolean> {
  if (now - reachability.at < 30_000) return reachability.ok;
  // a junk token: "fail" means Cloudflare answered (reachable), "error" means it did not
  reachability.ok = (await verifyTurnstileToken("reachability-probe", secret, fetchImpl)) !== "error";
  reachability.at = now;
  return reachability.ok;
}

/** Is this free-trial visitor a person? Always ok while Turnstile is off. */
export async function checkHuman(
  input: { turnstileToken?: unknown; humanToken?: unknown },
  env: TurnstileEnv,
  fetchImpl: FetchLike = fetch,
  now = Date.now(),
): Promise<HumanCheck> {
  if (!turnstileEnabled(env)) return { ok: true, skipped: "disabled" };
  const secret = env.TURNSTILE_SECRET_KEY!.trim();
  const identity = env.SG16_IDENTITY_SECRET!.trim();
  if (await humanTokenValid(input.humanToken, identity, now)) return { ok: true };
  const token = input.turnstileToken;
  if (typeof token === "string" && token.length > 0 && token.length <= 4096) {
    const outcome = await verifyTurnstileToken(token, secret, fetchImpl);
    if (outcome === "pass") return { ok: true, humanToken: await mintHumanToken(identity, now) };
    if (outcome === "error") return { ok: true, skipped: "fail-open" };
    return { ok: false };
  }
  // no proof at all: ask for it, unless Cloudflare itself cannot be reached
  return (await cloudflareReachable(secret, fetchImpl, now)) ? { ok: false } : { ok: true, skipped: "fail-open" };
}
