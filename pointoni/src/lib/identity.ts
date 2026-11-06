// ===================================================================
// Signed operator token and process-local fair-use accounting.
//
// There are no user accounts. The only signed token is the operator's (see admin-login.ts); it is
// stateless: the server recomputes the signature and stores nothing. Visitors are told apart only
// by the pass they hold (signed record) or the project key they present. Rate windows in this
// module are per process and reset on restart.
// ===================================================================

import crypto from "node:crypto";
import { brainVerifyPass } from "@/lib/brain-gateway";
import { clientIdentity } from "@/lib/rate-limit";
import { projectFromHeaders } from "@/lib/project-keys";

const TOKEN_TTL_MS = 30 * 24 * 3600_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const configuredSecret = process.env.SG16_IDENTITY_SECRET;
if (configuredSecret && Buffer.byteLength(configuredSecret, "utf8") < 32) {
  throw new Error("SG16_IDENTITY_SECRET must contain at least 32 UTF-8 bytes");
}
const SECRET: Buffer | null = configuredSecret
  ? Buffer.from(configuredSecret, "utf8")
  : process.env.NODE_ENV === "production"
    ? null
    : crypto.randomBytes(32);

const b64u = (buf: Buffer) => buf.toString("base64url");

type WindowCounter = { count: number; resetAt: number };

function pruneWindows(table: Map<string, WindowCounter>): void {
  if (table.size < 2048) return;
  const now = Date.now();
  for (const [key, value] of table) {
    if (value.resetAt <= now) table.delete(key);
  }
}

function stableKey(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export type SovereignTokenPayload = {
  email: string;
  exp: number; // ms epoch
  v: 1;
};

export function signToken(emailRaw: string): string {
  if (!SECRET) throw new Error("Sign-in is unavailable until SG16_IDENTITY_SECRET is configured.");
  const email = emailRaw.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new Error("Cannot issue a token for an invalid email.");
  const payload: SovereignTokenPayload = { email, exp: Date.now() + TOKEN_TTL_MS, v: 1 };
  const body = b64u(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64u(crypto.createHmac("sha256", SECRET).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyToken(tokenRaw: string): SovereignTokenPayload | null {
  if (!SECRET || typeof tokenRaw !== "string" || tokenRaw.length > 4096) return null;
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(tokenRaw.trim());
  if (!match) return null;
  const [, body, signature] = match;
  const expected = b64u(crypto.createHmac("sha256", SECRET).update(body).digest());
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<SovereignTokenPayload>;
    if (
      payload.v !== 1 ||
      typeof payload.email !== "string" ||
      !EMAIL_PATTERN.test(payload.email) ||
      typeof payload.exp !== "number" ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp <= Date.now()
    ) return null;
    return { email: payload.email.toLowerCase(), exp: payload.exp, v: 1 };
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------
// Process-local sliding windows. These reset on process restart and are not a
// distributed quota system. Use a shared store for production multi-instance
// rate enforcement.
// -------------------------------------------------------------------
export const FREE_BUCKET = 20;
export const WORK_BUCKET = 500;
const buckets = new Map<string, WindowCounter>();

export function consumeBucket(
  key: string,
  limit: number,
): { ok: boolean; remaining: number; resetAt: number } {
  pruneWindows(buckets);
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + 3600_000;
    buckets.set(key, { count: 1, resetAt });
    return { ok: true, remaining: Math.max(0, limit - 1), resetAt };
  }
  if (existing.count >= limit) return { ok: false, remaining: 0, resetAt: existing.resetAt };
  existing.count += 1;
  return { ok: true, remaining: Math.max(0, limit - existing.count), resetAt: existing.resetAt };
}

export type ChatTier = "free" | "work";

export async function resolveTier(req: Request): Promise<{
  tier: ChatTier;
  email: null;
  bucketKey: string;
  limit: number;
  /** host-verified pass token when the request proved one via X-SG16-Pass */
  passToken: string | null;
}> {
  // The operator's own projects: a signed project key is free and unlimited (see project-keys.ts).
  const project = projectFromHeaders(req.headers);
  if (project) {
    const ceiling = Number(process.env.SG16_PROJECT_HOURLY);
    return {
      tier: "work",
      email: null,
      bucketKey: `project:${project.project}`,
      limit: Number.isInteger(ceiling) && ceiling > 0 ? ceiling : 100_000,
      passToken: null,
    };
  }

  // A device-held pass: the 64-hex token is only trusted after the core
  // confirms it. Any failure (bad shape, core down, unknown or expired pass)
  // simply falls through to the free tier.
  // The pass is either the signed record itself (base64url JSON, verified by signature alone:
  // nothing about the subscriber is stored) or the older 64-hex token.
  const passHeader = req.headers.get("x-sg16-pass")?.trim() ?? "";
  if (/^[a-f0-9]{64}$/.test(passHeader) || /^[A-Za-z0-9_-]{40,3000}$/.test(passHeader)) {
    try {
      const verified = await brainVerifyPass(passHeader);
      const record = verified.record;
      if (
        verified.valid === true &&
        typeof record.expires_at === "number" &&
        record.expires_at * 1000 > Date.now()
      ) {
        return {
          tier: "work",
          email: null,
          bucketKey: `work:pass:${stableKey(passHeader).slice(0, 32)}`,
          limit: WORK_BUCKET,
          passToken: passHeader,
        };
      }
    } catch {
      // unverifiable pass -> free tier
    }
  }

  // Behind a trusted reverse proxy, configure it to overwrite these headers;
  // the framework's generic Request API exposes no reliable socket peer IP.
  // Forwarding headers are spoofable, so a per-visitor key exists only for a
  // request that proved it came through our proxy (see rate-limit.ts). Without
  // that proof every free visitor shares one generous bucket instead - a flood
  // guard, not a per-person limit - rather than trusting a forged address.
  const visitor = clientIdentity(req.headers);
  if (visitor.key) {
    return { tier: "free", email: null, bucketKey: `free:${visitor.key}`, limit: FREE_BUCKET, passToken: null };
  }
  const sharedLimit = Number(process.env.SG16_FREE_SHARED_PER_HOUR);
  return {
    tier: "free",
    email: null,
    bucketKey: "free:shared",
    limit: Number.isInteger(sharedLimit) && sharedLimit > 0 ? sharedLimit : 2000,
    passToken: null,
  };
}
