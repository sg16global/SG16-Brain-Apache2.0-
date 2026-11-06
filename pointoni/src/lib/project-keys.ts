// PROJECT KEYS - how the operator's other projects talk to the Brain.
//
// A key is signed, never stored. The server keeps no list of keys and no record of who holds one;
// it only recomputes the signature. That is why keys survive every restart and deploy, and why
// there is nothing to leak. Requests carrying a valid key are free: no subscription, no per-visitor
// limit (only a very generous per-project hourly ceiling so a runaway loop cannot flood the model).
//
//   key  = sg16p_<base64url({"v":1,"p":"<project>","iat":<unix>,"n":"<nonce>"})>.<HMAC-SHA256 signature>
//
// Stop ONE project: add its name to SG16_REVOKED_PROJECTS and restart.
// Stop ALL keys: change SG16_PROJECT_KEY_SECRET.
import crypto from "node:crypto";

export const PROJECT_KEY_PREFIX = "sg16p_";
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MIN_SECRET_CHARS = 32;

export function isValidProjectName(name: unknown): name is string {
  return typeof name === "string" && NAME.test(name);
}

export function projectKeySecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const s = env.SG16_PROJECT_KEY_SECRET?.trim();
  return s && s.length >= MIN_SECRET_CHARS ? s : null;
}

export function revokedProjects(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.SG16_REVOKED_PROJECTS ?? "")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
}

const sign = (secret: string, payload: string) =>
  crypto.createHmac("sha256", secret).update(`sg16-project-key-v1|${payload}`).digest("base64url");

export function createProjectKey(project: string, secret: string, now = Date.now()): string {
  if (!isValidProjectName(project)) throw new Error("Project name: 1-40 characters, lowercase letters, digits and dashes.");
  if (secret.length < MIN_SECRET_CHARS) throw new Error("Project key secret is too short.");
  const payload = Buffer.from(
    JSON.stringify({ v: 1, p: project, iat: Math.floor(now / 1000), n: crypto.randomBytes(6).toString("base64url") }),
    "utf8",
  ).toString("base64url");
  return `${PROJECT_KEY_PREFIX}${payload}.${sign(secret, payload)}`;
}

export function verifyProjectKey(key: string, secret: string, revoked: string[] = []): { project: string } | null {
  if (typeof key !== "string" || key.length > 400 || !key.startsWith(PROJECT_KEY_PREFIX)) return null;
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(key.slice(PROJECT_KEY_PREFIX.length));
  if (!m) return null;
  const [, payload, signature] = m;
  const expected = sign(secret, payload);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { v?: number; p?: unknown };
    if (data.v !== 1 || !isValidProjectName(data.p)) return null;
    if (revoked.includes(data.p)) return null;
    return { project: data.p };
  } catch {
    return null;
  }
}

/** The project making this request, if it carries a valid, unrevoked project key. */
export function projectFromHeaders(headers: Headers, env: NodeJS.ProcessEnv = process.env): { project: string } | null {
  const secret = projectKeySecret(env);
  if (!secret) return null;
  const m = /^Bearer\s+(sg16p_[^\s]+)$/i.exec(headers.get("authorization") ?? "");
  return m ? verifyProjectKey(m[1], secret, revokedProjects(env)) : null;
}
