// ===================================================================
// CLOUDFLARE TURNSTILE — server-side verification, feature-flagged.
//
// Active only when BOTH TURNSTILE_SECRET_KEY and TURNSTILE_SITE_KEY are set, so
// a deploy without them is never blocked. Keys come only from the environment.
//
// Flow: the page renders the widget and sends its token with a message. The
// server verifies it once with Cloudflare, then hands back a short-lived
// in-memory "human pass" so the visitor is not asked again for every message
// (Turnstile tokens are single use). The pass store lives only in memory.
//
// FAIL OPEN: if Cloudflare cannot be reached (network error, timeout, 5xx), the
// check is skipped and only the rate limiter protects the endpoint. That
// decision is made by the server from its own probe of Cloudflare - never from
// a flag the client sends, which anyone could set.
// ===================================================================

import crypto from "node:crypto";

export const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.TURNSTILE_SECRET_KEY?.trim() && env.TURNSTILE_SITE_KEY?.trim());
}

/** Public by design (it is embedded in the page); never returns the secret. */
export function turnstileSiteKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return turnstileEnabled(env) ? (env.TURNSTILE_SITE_KEY as string).trim() : null;
}

export type VerifyOutcome = "pass" | "fail" | "error";
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** "pass"/"fail" are Cloudflare's answer; "error" means we could not get one. */
export async function verifyTurnstileToken(
  token: string,
  secret: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 3000,
): Promise<VerifyOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // no visitor IP is sent: the check works without it
    const res = await fetchImpl(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }).toString(),
      signal: controller.signal,
    });
    if (res.status >= 500) return "error";
    const data = (await res.json()) as { success?: boolean };
    return data.success === true ? "pass" : "fail";
  } catch {
    return "error";
  } finally {
    clearTimeout(timer);
  }
}

// ---- short-lived in-memory human pass -------------------------------------
const PASS_TTL_MS = 15 * 60_000;
const PASS_MAX_USES = 60;
const PASS_MAX_ENTRIES = 50_000;

export class HumanPassStore {
  private passes = new Map<string, { exp: number; uses: number }>();

  mint(now = Date.now()): string {
    if (this.passes.size >= PASS_MAX_ENTRIES) {
      for (const [k, v] of this.passes) if (v.exp <= now) this.passes.delete(k);
      while (this.passes.size >= PASS_MAX_ENTRIES) {
        const oldest = this.passes.keys().next().value;
        if (oldest === undefined) break;
        this.passes.delete(oldest);
      }
    }
    const token = crypto.randomBytes(24).toString("hex");
    this.passes.set(this.hash(token), { exp: now + PASS_TTL_MS, uses: 0 });
    return token;
  }

  /** true while the pass is unexpired and under its use cap */
  use(token: string, now = Date.now()): boolean {
    const h = this.hash(token);
    const p = this.passes.get(h);
    if (!p) return false;
    if (p.exp <= now || p.uses >= PASS_MAX_USES) {
      this.passes.delete(h);
      return false;
    }
    p.uses += 1;
    return true;
  }

  size(): number {
    return this.passes.size;
  }

  private hash(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }
}

export type HumanCheck =
  | { ok: true; humanToken?: string; skipped?: "disabled" | "fail-open" }
  | { ok: false };

export type HumanDeps = {
  store: HumanPassStore;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** cached "can we reach Cloudflare?" so a flood of token-less requests probes at most every 30s */
  reachability: { at: number; ok: boolean };
  now?: number;
};

async function cloudflareReachable(secret: string, deps: HumanDeps): Promise<boolean> {
  const now = deps.now ?? Date.now();
  if (now - deps.reachability.at < 30_000) return deps.reachability.ok;
  // a junk token: "fail" means Cloudflare answered (reachable), "error" means it did not
  const outcome = await verifyTurnstileToken("reachability-probe", secret, deps.fetchImpl, deps.timeoutMs);
  deps.reachability.at = now;
  deps.reachability.ok = outcome !== "error";
  return deps.reachability.ok;
}

export async function checkHuman(
  input: { turnstileToken?: unknown; humanToken?: unknown },
  deps: HumanDeps,
  env: NodeJS.ProcessEnv = process.env,
): Promise<HumanCheck> {
  if (!turnstileEnabled(env)) return { ok: true, skipped: "disabled" };
  const secret = (env.TURNSTILE_SECRET_KEY as string).trim();

  if (typeof input.humanToken === "string" && input.humanToken.length <= 128 && deps.store.use(input.humanToken, deps.now)) {
    return { ok: true };
  }
  if (typeof input.turnstileToken === "string" && input.turnstileToken.length > 0 && input.turnstileToken.length <= 4096) {
    const outcome = await verifyTurnstileToken(input.turnstileToken, secret, deps.fetchImpl, deps.timeoutMs);
    if (outcome === "pass") return { ok: true, humanToken: deps.store.mint(deps.now) };
    if (outcome === "error") return { ok: true, skipped: "fail-open" };
    return { ok: false };
  }
  // no proof at all: demand it, unless Cloudflare itself is unreachable
  return (await cloudflareReachable(secret, deps)) ? { ok: false } : { ok: true, skipped: "fail-open" };
}

const KEY = Symbol.for("sg16.turnstile");
type Shared = { store: HumanPassStore; reachability: { at: number; ok: boolean } };
export function sharedHumanDeps(): HumanDeps {
  const g = globalThis as unknown as Record<symbol, Shared | undefined>;
  const s = (g[KEY] ??= { store: new HumanPassStore(), reachability: { at: 0, ok: true } });
  return { store: s.store, reachability: s.reachability };
}
