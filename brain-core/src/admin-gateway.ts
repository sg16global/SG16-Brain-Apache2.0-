// SG16 BRAIN CORE — the operator's gateway on /admin (owner request 2026-11-08).
//
// Two things the owner sets from the admin panel, no redeploy needed:
//
//   BRAIN SERVER — where the brain runs. The core is server-agnostic: any
//   server running Ollama with saiftechglobal/sg16-brain:Q4_K_M works (the
//   recommended door is a Cloudflare Tunnel + Access service token, see
//   scripts/vps-setup-model.sh). The address saved here wins over the
//   MODEL_URL deploy setting; deleting it goes back to MODEL_URL. Access
//   secrets typed here are stored encrypted (AES-GCM, key derived from
//   SG16_IDENTITY_SECRET) and are never sent back to the browser.
//
//   PROJECT RULES — every API project is independent of the website: its own
//   instructions for the brain, its own rate limit, queue wait, JSON-only
//   mode and blocked patterns. Stored as `policy:<project>` in KV (the same
//   record auth.ts loadPolicy has always read).
//
// Routes (operator only — the signed-in admin):
//   GET    /api/admin/brain-server        the saved setting (secrets only as "set"/"not set")
//   POST   /api/admin/brain-server        save { url, credentials, ... } and test it
//   POST   /api/admin/brain-server/test   test a setting without saving it
//   DELETE /api/admin/brain-server        back to the MODEL_URL deploy setting
//   GET    /api/admin/project-rules[?project=]  one project's rules, or every project with its own rules
//   POST   /api/admin/project-rules       save one project's rules
//   DELETE /api/admin/project-rules?project=    back to the default rules
//
// Nothing about visitors is stored here: only the server address, its door
// credentials and the operator's per-project rules.

import { operatorBearer, isValidProjectName, type DesignEnv } from "./design-compat.ts";
import { probeServer, type BrainServer } from "./model-client.ts";
import { DEFAULT_POLICY } from "./types.ts";

export interface GatewayEnv extends DesignEnv {
  MODEL_URL?: string;
  MODEL_NAME?: string;
  MODEL_SHARED_SECRET?: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
  MAX_QUEUE_WAIT_MS?: string;
}

const DEFAULT_MODEL = "saiftechglobal/sg16-brain:Q4_K_M";

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

// ===================================================================== server

export const SERVER_KEY = "brain:server";
export type CredentialMode = "deploy" | "custom" | "none";

interface Credentials {
  accessClientId: string;
  accessClientSecret: string;
  sharedSecret: string;
}

interface StoredServer {
  v: 1;
  url: string;
  credentials: CredentialMode;
  /** custom credentials, AES-GCM encrypted (base64url iv + ciphertext) */
  sealed?: { iv: string; data: string };
  updated: number;
  by: string;
}

export interface EffectiveServer extends BrainServer {
  source: "admin" | "deploy";
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** https://<any host>[/path] — or http:// on this machine only (local testing).
 * No user:password@, no query, no fragment; trailing slashes removed. */
export function normalizeServerUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.length > 300) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return (url.origin + url.pathname).replace(/\/+$/, "");
}

const HEADER_SAFE = /^[\x21-\x7e]{1,500}$/;

function b64u(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64u(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sealKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("sg16-brain-server"), info: new TextEncoder().encode("v1") },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function seal(creds: Credentials, secret: string): Promise<{ iv: string; data: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sealKey(secret), new TextEncoder().encode(JSON.stringify(creds)));
  return { iv: b64u(iv), data: b64u(new Uint8Array(data)) };
}

async function unseal(sealed: { iv: string; data: string } | undefined, secret: string | undefined): Promise<Credentials | null> {
  if (!sealed || !secret) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(sealed.iv) }, await sealKey(secret), unb64u(sealed.data));
    const c = JSON.parse(new TextDecoder().decode(plain)) as Partial<Credentials>;
    return {
      accessClientId: typeof c.accessClientId === "string" ? c.accessClientId : "",
      accessClientSecret: typeof c.accessClientSecret === "string" ? c.accessClientSecret : "",
      sharedSecret: typeof c.sharedSecret === "string" ? c.sharedSecret : "",
    };
  } catch {
    return null; // the identity secret changed: the saved credentials cannot be read
  }
}

function deployCredentials(env: GatewayEnv): Credentials {
  return {
    accessClientId: env.CF_ACCESS_CLIENT_ID ?? "",
    accessClientSecret: env.CF_ACCESS_CLIENT_SECRET ?? "",
    sharedSecret: env.MODEL_SHARED_SECRET ?? "",
  };
}

const EMPTY: Credentials = { accessClientId: "", accessClientSecret: "", sharedSecret: "" };

function parseStored(raw: string | null): StoredServer | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as StoredServer;
    if (s?.v !== 1 || typeof s.url !== "string" || !normalizeServerUrl(s.url)) return null;
    if (s.credentials !== "deploy" && s.credentials !== "custom" && s.credentials !== "none") s.credentials = "deploy";
    return s;
  } catch {
    return null;
  }
}

// one decoded setting per isolate, keyed by the raw KV value (decrypting on
// every request would be wasted work; the value changes only when saved)
let memo: { raw: string; secret: string; server: EffectiveServer } | null = null;

/** The brain server every model call uses: the admin setting when one is
 * saved, else the MODEL_URL deploy setting with the deploy secrets. */
export async function effectiveBrainServer(env: GatewayEnv, fresh = false): Promise<EffectiveServer> {
  const deploy: EffectiveServer = { url: env.MODEL_URL ?? "", ...deployCredentials(env), source: "deploy" };
  let raw: string | null = null;
  try {
    // KV caches reads at the edge for 30 s: a saved change reaches every
    // location within about a minute (the admin panel reads fresh)
    raw = fresh ? await env.KEYS.get(SERVER_KEY) : await env.KEYS.get(SERVER_KEY, { cacheTtl: 30 });
  } catch {
    return deploy;
  }
  const stored = parseStored(raw);
  if (!stored || raw === null) return deploy;
  const secret = env.SG16_IDENTITY_SECRET ?? "";
  if (memo && memo.raw === raw && memo.secret === secret) return memo.server;
  let creds: Credentials;
  if (stored.credentials === "deploy") creds = deployCredentials(env);
  else if (stored.credentials === "none") creds = EMPTY;
  else creds = (await unseal(stored.sealed, secret)) ?? EMPTY;
  const server: EffectiveServer = { url: stored.url, ...creds, source: "admin" };
  memo = { raw, secret, server };
  return server;
}

interface ServerInput {
  url: string;
  credentials: CredentialMode;
  /** custom mode: the credentials to store (blank secret = keep the saved one) */
  creds: Credentials;
}

async function parseServerInput(
  body: Record<string, unknown> | null,
  env: GatewayEnv,
  stored: StoredServer | null,
): Promise<{ ok: true; input: ServerInput } | { ok: false; error: string }> {
  if (!body) return { ok: false, error: "Send a JSON object." };
  const url = normalizeServerUrl(body.url);
  if (!url) {
    return { ok: false, error: "Server address: https://… (any host, optional path; http:// only for this machine, e.g. http://127.0.0.1:11434)." };
  }
  const mode = body.credentials ?? "deploy";
  if (mode !== "deploy" && mode !== "custom" && mode !== "none") {
    return { ok: false, error: "credentials must be \"deploy\", \"custom\" or \"none\"." };
  }
  let creds = EMPTY;
  if (mode === "custom") {
    const saved = stored?.credentials === "custom" ? await unseal(stored.sealed, env.SG16_IDENTITY_SECRET) : null;
    const field = (name: keyof Credentials): string | null => {
      const v = body[name];
      if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
        // blank: keep what is saved (the browser never sees saved secrets)
        return saved?.[name] ?? "";
      }
      if (typeof v !== "string" || !HEADER_SAFE.test(v.trim())) return null;
      return v.trim();
    };
    const accessClientId = field("accessClientId");
    const accessClientSecret = field("accessClientSecret");
    const sharedSecret = field("sharedSecret");
    if (accessClientId === null || accessClientSecret === null || sharedSecret === null) {
      return { ok: false, error: "Credentials: printable characters only, no spaces, up to 500 each." };
    }
    creds = { accessClientId, accessClientSecret, sharedSecret };
  }
  return { ok: true, input: { url, credentials: mode, creds } };
}

function serverForInput(input: ServerInput, env: GatewayEnv): BrainServer {
  const creds = input.credentials === "deploy" ? deployCredentials(env) : input.credentials === "none" ? EMPTY : input.creds;
  return { url: input.url, ...creds };
}

function present(c: Credentials) {
  return {
    accessClientId: c.accessClientId, // an identifier, not a secret
    accessClientSecret: Boolean(c.accessClientSecret),
    sharedSecret: Boolean(c.sharedSecret),
  };
}

async function serverState(env: GatewayEnv) {
  const stored = parseStored(await env.KEYS.get(SERVER_KEY));
  const deploy = deployCredentials(env);
  const custom = stored?.credentials === "custom" ? await unseal(stored.sealed, env.SG16_IDENTITY_SECRET) : null;
  return {
    model: env.MODEL_NAME || DEFAULT_MODEL,
    source: stored ? "admin" : "deploy",
    url: stored ? stored.url : env.MODEL_URL ?? "",
    credentials: stored ? stored.credentials : "deploy",
    custom: custom ? present(custom) : null,
    customUnreadable: stored?.credentials === "custom" && !custom,
    updated: stored?.updated ?? null,
    deploy: { url: env.MODEL_URL ?? "", ...present(deploy) },
  };
}

// ===================================================================== rules

export interface ProjectRules {
  system: string;
  rpm: number;
  max_queue_ms: number;
  require_json: boolean;
  blocked_patterns: string[];
}

export const MAX_RULES_CHARS = 16384;
export const MAX_RPM = 10000;
const MAX_PATTERNS = 50;
const MAX_PATTERN_CHARS = 200;
/** the website's own visitors (pass and free tiers) — not an API project */
const RESERVED_PROJECTS = new Set(["web"]);

function queueCeiling(env: GatewayEnv): number {
  return Number(env.MAX_QUEUE_WAIT_MS) || DEFAULT_POLICY.max_queue_ms;
}

function defaultRules(env: GatewayEnv): ProjectRules {
  return {
    system: "",
    rpm: DEFAULT_POLICY.rpm,
    max_queue_ms: queueCeiling(env),
    require_json: DEFAULT_POLICY.require_json,
    blocked_patterns: [],
  };
}

function parseRules(body: Record<string, unknown>, env: GatewayEnv): { ok: true; rules: ProjectRules } | { ok: false; error: string } {
  const d = defaultRules(env);
  const system = body.system === undefined ? "" : body.system;
  if (typeof system !== "string" || system.length > MAX_RULES_CHARS) {
    return { ok: false, error: `Instructions: text up to ${MAX_RULES_CHARS} characters.` };
  }
  const rpm = body.rpm === undefined ? d.rpm : body.rpm;
  if (typeof rpm !== "number" || !Number.isInteger(rpm) || rpm < 1 || rpm > MAX_RPM) {
    return { ok: false, error: `Requests per minute: a whole number from 1 to ${MAX_RPM}.` };
  }
  const wait = body.max_queue_ms === undefined ? d.max_queue_ms : body.max_queue_ms;
  if (typeof wait !== "number" || !Number.isFinite(wait) || wait < 0 || wait > d.max_queue_ms) {
    return { ok: false, error: `Queue wait: 0 to ${Math.round(d.max_queue_ms / 1000)} seconds (the server's ceiling).` };
  }
  const requireJson = body.require_json === undefined ? false : body.require_json;
  if (typeof requireJson !== "boolean") return { ok: false, error: "JSON-only must be true or false." };
  const patterns = body.blocked_patterns === undefined ? [] : body.blocked_patterns;
  if (!Array.isArray(patterns) || patterns.length > MAX_PATTERNS) {
    return { ok: false, error: `Blocked patterns: a list of up to ${MAX_PATTERNS}.` };
  }
  const cleaned: string[] = [];
  for (const p of patterns) {
    if (typeof p !== "string" || !p.trim() || p.length > MAX_PATTERN_CHARS) {
      return { ok: false, error: `Each blocked pattern: 1-${MAX_PATTERN_CHARS} characters.` };
    }
    try {
      new RegExp(p, "u");
    } catch {
      return { ok: false, error: `Not a valid pattern: ${p.slice(0, 60)}` };
    }
    cleaned.push(p);
  }
  return {
    ok: true,
    rules: { system, rpm, max_queue_ms: Math.round(wait), require_json: requireJson, blocked_patterns: cleaned },
  };
}

function rulesOf(raw: string | null, env: GatewayEnv): ProjectRules | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<ProjectRules>;
    const d = defaultRules(env);
    return {
      system: typeof p.system === "string" ? p.system : "",
      rpm: typeof p.rpm === "number" && p.rpm > 0 ? Math.floor(p.rpm) : d.rpm,
      max_queue_ms: typeof p.max_queue_ms === "number" && p.max_queue_ms >= 0 ? Math.min(p.max_queue_ms, d.max_queue_ms) : d.max_queue_ms,
      require_json: typeof p.require_json === "boolean" ? p.require_json : false,
      blocked_patterns: Array.isArray(p.blocked_patterns) ? p.blocked_patterns.filter((x): x is string => typeof x === "string") : [],
    };
  } catch {
    return null;
  }
}

function projectParam(raw: unknown): string | null {
  const name = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return isValidProjectName(name) && !RESERVED_PROJECTS.has(name) ? name : null;
}

const PROJECT_ERROR = "Project name: 1-40 characters, lowercase letters, digits and dashes (\"web\" is the website itself).";

// ===================================================================== route

export async function adminGatewayRoute(request: Request, path: string, env: GatewayEnv): Promise<Response | null> {
  const serverPath = path === "/api/admin/brain-server" || path === "/api/admin/brain-server/test";
  const rulesPath = path === "/api/admin/project-rules";
  if (!serverPath && !rulesPath) return null;

  const signedIn = Boolean(request.headers.get("authorization"));
  const operator = await operatorBearer(request, env);
  if (!operator) {
    return json({ error: signedIn ? "This account is not an operator." : "Operator sign-in required." }, signedIn ? 403 : 401);
  }
  const model = env.MODEL_NAME || DEFAULT_MODEL;

  // ---- BRAIN SERVER ------------------------------------------------------
  if (path === "/api/admin/brain-server/test" && request.method === "POST") {
    const stored = parseStored(await env.KEYS.get(SERVER_KEY));
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const parsed = await parseServerInput(body, env, stored);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    return json({ ok: true, saved: false, model, probe: await probeServer(serverForInput(parsed.input, env), model, 8000) });
  }
  if (path === "/api/admin/brain-server") {
    if (request.method === "GET") {
      const state = await serverState(env);
      const live = await effectiveBrainServer(env, true);
      return json({ ...state, probe: await probeServer(live, model, 5000) });
    }
    if (request.method === "POST") {
      const stored = parseStored(await env.KEYS.get(SERVER_KEY));
      const body = await request.json().catch(() => null) as Record<string, unknown> | null;
      const parsed = await parseServerInput(body, env, stored);
      if (!parsed.ok) return json({ error: parsed.error }, 400);
      const { input } = parsed;
      const record: StoredServer = { v: 1, url: input.url, credentials: input.credentials, updated: Date.now(), by: operator.email };
      if (input.credentials === "custom") {
        const secret = env.SG16_IDENTITY_SECRET ?? "";
        if (secret.length < 32) return json({ error: "SG16_IDENTITY_SECRET (32+ characters) is needed to store credentials safely." }, 503);
        record.sealed = await seal(input.creds, secret);
      }
      await env.KEYS.put(SERVER_KEY, JSON.stringify(record));
      memo = null;
      const probe = await probeServer(serverForInput(input, env), model, 8000);
      return json({ ok: true, saved: true, ...(await serverState(env)), probe });
    }
    if (request.method === "DELETE") {
      await env.KEYS.delete(SERVER_KEY);
      memo = null;
      const state = await serverState(env);
      return json({ ok: true, ...state, probe: await probeServer(await effectiveBrainServer(env, true), model, 5000) });
    }
    return json({ error: "Method not allowed." }, 405);
  }

  // ---- PROJECT RULES -----------------------------------------------------
  const params = new URL(request.url).searchParams;
  if (request.method === "GET") {
    if (params.has("project")) {
      const project = projectParam(params.get("project"));
      if (!project) return json({ error: PROJECT_ERROR }, 400);
      const own = rulesOf(await env.KEYS.get(`policy:${project}`), env);
      return json({ project, custom: Boolean(own), rules: own ?? defaultRules(env), defaults: defaultRules(env), limits: limits(env) });
    }
    const projects: Array<{ project: string; rules: ProjectRules }> = [];
    let cursor: string | undefined;
    do {
      const page = await env.KEYS.list(cursor ? { prefix: "policy:", cursor } : { prefix: "policy:" });
      for (const item of page.keys) {
        const rules = rulesOf(await env.KEYS.get(item.name), env);
        if (rules) projects.push({ project: item.name.slice("policy:".length), rules });
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return json({ projects, defaults: defaultRules(env), limits: limits(env) });
  }
  if (request.method === "POST") {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return json({ error: "Send a JSON object." }, 400);
    const project = projectParam(body.project);
    if (!project) return json({ error: PROJECT_ERROR }, 400);
    const parsed = parseRules(body, env);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    await env.KEYS.put(`policy:${project}`, JSON.stringify({ ...parsed.rules, updated: Date.now() }));
    return json({ ok: true, project, custom: true, rules: parsed.rules });
  }
  if (request.method === "DELETE") {
    const project = projectParam(params.get("project"));
    if (!project) return json({ error: PROJECT_ERROR }, 400);
    await env.KEYS.delete(`policy:${project}`);
    return json({ ok: true, project, custom: false, rules: defaultRules(env) });
  }
  return json({ error: "Method not allowed." }, 405);
}

function limits(env: GatewayEnv) {
  return { maxRulesChars: MAX_RULES_CHARS, maxRpm: MAX_RPM, maxQueueMs: queueCeiling(env), maxPatterns: MAX_PATTERNS };
}
