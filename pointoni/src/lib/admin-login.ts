// Operator login: the official email (listed in SG16_ADMIN_EMAILS) plus the password whose hash is
// in SG16_ADMIN_PASSWORD_HASH. Anyone else is turned away with the same answer and the same delay.
// Success returns the same stateless signed token the rest of the platform already understands, so
// nothing is stored: the server remembers neither the login nor the operator.
import crypto from "node:crypto";
import { isAdminEmail } from "./admin-auth.ts";
import { DUMMY_HASH, verifyPassword } from "./admin-password.ts";

export type AdminLoginResult =
  | { ok: true; token: string; email: string }
  | { ok: false; status: 400 | 401 | 429 | 503; error: string };

const WINDOW_MS = 10 * 60_000;
const PER_VISITOR = 5;
const GLOBAL = 40;
type Counter = { count: number; resetAt: number };
const attempts = new Map<string, Counter>();
let globalCounter: Counter = { count: 0, resetAt: 0 };

function hit(table: Map<string, Counter>, key: string, limit: number, now: number): boolean {
  const c = table.get(key);
  if (!c || c.resetAt <= now) {
    table.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (c.count >= limit) return false;
  c.count += 1;
  return true;
}

/** For tests: forget all attempt counters. */
export function resetAdminLoginLimits() {
  attempts.clear();
  globalCounter = { count: 0, resetAt: 0 };
}

export function adminLogin(
  input: { email: unknown; password: unknown; networkKey: string },
  sign: (email: string) => string,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): AdminLoginResult {
  const configuredHash = env.SG16_ADMIN_PASSWORD_HASH?.trim();
  if (!configuredHash || !(env.SG16_ADMIN_EMAILS ?? "").includes("@")) {
    return { ok: false, status: 503, error: "Operator login is not set up on this server." };
  }
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (!email || !password || email.length > 254 || password.length > 256) {
    return { ok: false, status: 400, error: "Enter your email and password." };
  }

  // lock out guessing: per visitor+email, and across everyone
  if (globalCounter.resetAt <= now) globalCounter = { count: 0, resetAt: now + WINDOW_MS };
  const visitorKey = crypto.createHash("sha256").update(`${email}|${input.networkKey}`).digest("hex");
  if (globalCounter.count >= GLOBAL || !hit(attempts, visitorKey, PER_VISITOR, now)) {
    return { ok: false, status: 429, error: "Too many attempts. Wait ten minutes and try again." };
  }
  globalCounter.count += 1;

  // always do the expensive check, so a wrong email takes as long as a wrong password
  const isAdmin = isAdminEmail(email, env);
  const passwordOk = verifyPassword(password, isAdmin ? configuredHash : DUMMY_HASH);
  if (!isAdmin || !passwordOk) return { ok: false, status: 401, error: "Email or password is wrong." };

  return { ok: true, token: sign(email), email };
}
