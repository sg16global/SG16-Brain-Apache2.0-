// ===================================================================
// PER-VISITOR RATE LIMIT — in memory only.
//
//   * The visitor key is HMAC(random per-process salt, client IP). The salt and
//     the counters exist only in this process's memory: nothing is written to
//     disk, nothing is logged, and a restart forgets everything.
//   * Forwarding headers (CF-Connecting-IP, X-Forwarded-For) are spoofable by
//     anyone who can reach the server directly, so they are used ONLY when the
//     request proves it came through our proxy: it must carry
//     `X-SG16-Proxy-Auth` equal to SG16_PROXY_AUTH_SECRET (the same setting the
//     Python core uses). Otherwise there is no trustworthy per-visitor
//     identity, `key` is null, and only the shared global cap applies.
//   * Counters expire with their window and the table is size-bounded, so a
//     flood of distinct addresses cannot grow memory without limit.
// ===================================================================

import crypto from "node:crypto";
import net from "node:net";

export type ClientIdentity = { key: string | null; trusted: boolean };

const SALT = crypto.randomBytes(32);

function sameSecret(supplied: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(supplied).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/** True when the request proved it came through our own proxy. */
export function proxyTrusted(headers: Headers, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = env.SG16_PROXY_AUTH_SECRET;
  const supplied = headers.get("x-sg16-proxy-auth");
  return Boolean(expected && supplied && sameSecret(supplied, expected));
}

/**
 * True only for our own scripts (deploy checks, smoke tests): they send the server secret in a header of their
 * own, X-SG16-Probe-Auth. The public proxy adds X-SG16-Proxy-Auth to EVERY visitor request, so that header
 * proves nothing about who is asking; the probe header is one the proxy never adds and a visitor cannot guess.
 * (Do not infer "local" from missing forwarded-address headers: the web server fills those in itself.)
 */
export function directProbe(headers: Headers, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = env.SG16_PROXY_AUTH_SECRET;
  const supplied = headers.get("x-sg16-probe-auth");
  return Boolean(expected && supplied && sameSecret(supplied, expected));
}

export function clientIdentity(headers: Headers, env: NodeJS.ProcessEnv = process.env): ClientIdentity {
  if (!proxyTrusted(headers, env)) return { key: null, trusted: false };
  const candidates = [
    headers.get("cf-connecting-ip")?.trim(),
    headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
  ];
  const ip = candidates.find((c): c is string => Boolean(c) && net.isIP(c as string) !== 0);
  if (!ip) return { key: null, trusted: false };
  const key = crypto.createHmac("sha256", SALT).update(ip).digest("hex").slice(0, 24);
  return { key, trusted: true };
}

export type RateConfig = {
  perMinute: number;
  perHour: number;
  globalPerMinute: number;
  maxKeys: number;
};

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Safe defaults; every value can be overridden from the environment. */
export function rateConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RateConfig {
  return {
    perMinute: positiveInt(env.SG16_RATE_PER_MINUTE, 8),
    perHour: positiveInt(env.SG16_RATE_PER_HOUR, 60),
    globalPerMinute: positiveInt(env.SG16_RATE_GLOBAL_PER_MINUTE, 300),
    maxKeys: positiveInt(env.SG16_RATE_MAX_KEYS, 100_000),
  };
}

export type RateDecision = { ok: true } | { ok: false; retryAfterSec: number; scope: "visitor" | "global" };

type Entry = { minStart: number; minCount: number; hourStart: number; hourCount: number };

export class RateLimiter {
  private cfg: RateConfig;
  private visitors = new Map<string, Entry>();
  private globalStart = 0;
  private globalCount = 0;
  private sincePrune = 0;

  constructor(cfg: RateConfig) {
    this.cfg = cfg;
  }

  size(): number {
    return this.visitors.size;
  }

  check(identity: ClientIdentity, now = Date.now()): RateDecision {
    // shared flood guard: applies to everyone, and is the ONLY limit when no
    // trustworthy per-visitor identity exists
    if (now - this.globalStart >= 60_000) {
      this.globalStart = now;
      this.globalCount = 0;
    }
    if (this.globalCount >= this.cfg.globalPerMinute) {
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((this.globalStart + 60_000 - now) / 1000)), scope: "global" };
    }

    if (identity.key) {
      let e = this.visitors.get(identity.key);
      if (!e) {
        this.makeRoom(now);
        e = { minStart: now, minCount: 0, hourStart: now, hourCount: 0 };
        this.visitors.set(identity.key, e);
      }
      if (now - e.minStart >= 60_000) {
        e.minStart = now;
        e.minCount = 0;
      }
      if (now - e.hourStart >= 3_600_000) {
        e.hourStart = now;
        e.hourCount = 0;
      }
      if (e.minCount >= this.cfg.perMinute) {
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((e.minStart + 60_000 - now) / 1000)), scope: "visitor" };
      }
      if (e.hourCount >= this.cfg.perHour) {
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((e.hourStart + 3_600_000 - now) / 1000)), scope: "visitor" };
      }
      e.minCount += 1;
      e.hourCount += 1;
    }
    this.globalCount += 1;
    return { ok: true };
  }

  /** Drop expired entries now and then; evict the oldest if still over the cap. */
  private makeRoom(now: number): void {
    this.sincePrune += 1;
    if (this.visitors.size < this.cfg.maxKeys && this.sincePrune < 1000) return;
    this.sincePrune = 0;
    for (const [k, e] of this.visitors) {
      if (now - e.hourStart >= 3_600_000) this.visitors.delete(k);
    }
    while (this.visitors.size >= this.cfg.maxKeys) {
      const oldest = this.visitors.keys().next().value;
      if (oldest === undefined) break;
      this.visitors.delete(oldest);
    }
  }
}

const KEY = Symbol.for("sg16.rateLimiter");
export function sharedRateLimiter(): RateLimiter {
  const g = globalThis as unknown as Record<symbol, RateLimiter | undefined>;
  return (g[KEY] ??= new RateLimiter(rateConfigFromEnv()));
}
