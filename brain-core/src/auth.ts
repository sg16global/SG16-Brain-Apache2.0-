// Key validation against Workers KV. One code path for every consumer,
// including the owner (user #1). The presented key is hashed; KV stores
// hash -> record. A miss and a revoked key are the same 401 to callers.

import type { KeyRecord, Policy, AskRequest } from "./types.ts";
import { DEFAULT_POLICY } from "./types.ts";
import { bearer, keyHash, isKeyShape } from "./keys.ts";
import { verifyProjectKey, projectKeyRecord, isProjectKeyRevoked, projectKeyControl } from "./design-compat.ts";

export interface KeyStore {
  get(key: string): Promise<string | null>;
}

export type AuthResult =
  | { ok: true; record: KeyRecord }
  | { ok: false; off?: boolean };

export async function authenticate(
  authorization: string | null,
  store: KeyStore,
  projectSecret?: string,
  revokedProjects: string[] = [],
): Promise<AuthResult> {
  const key = bearer(authorization);
  if (key && isKeyShape(key)) {
    // the KV path: only the SHA-256 of a key is ever stored
    const raw = await store.get(await keyHash(key));
    if (!raw) return { ok: false };
    let record: KeyRecord;
    try {
      record = JSON.parse(raw) as KeyRecord;
    } catch {
      return { ok: false };
    }
    if (!record || record.revoked || typeof record.user !== "number") return { ok: false };
    return { ok: true, record };
  }
  // the old host's stateless sg16p_ project keys (same secret => old keys keep working)
  const match = /^Bearer\s+(sg16p_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec((authorization ?? "").trim());
  if (match) {
    const project = await verifyProjectKey(match[1], projectSecret, revokedProjects);
    if (!project) return { ok: false };
    // per-key revocation: a minted key with a revoked record dies here; a key
    // with no record is not managed by the record system and keeps working
    if (await isProjectKeyRevoked(store, match[1])) return { ok: false };
    const record = projectKeyRecord(match[1], project.project, project.issuedAt);
    // the operator's ON / OFF / BROKEN switch on /admin (every key, old ones too):
    // OFF is a pause (403 E_KEY_OFF, can come back), BROKEN is a dead key (401)
    const control = await projectKeyControl(store, record.id);
    if (control === "broken") return { ok: false };
    if (control === "off") return { ok: false, off: true };
    return { ok: true, record };
  }
  return { ok: false };
}

/** A project's stored policy over the given defaults (the Worker passes its
 * env-configured queue wait as the default max_queue_ms). */
export async function loadPolicy(store: KeyStore, project: string, defaults: Policy = DEFAULT_POLICY): Promise<Policy> {
  const raw = await store.get(`policy:${project}`);
  if (!raw) return defaults;
  try {
    const p = JSON.parse(raw) as Partial<Policy>;
    return {
      rpm: typeof p.rpm === "number" && p.rpm > 0 ? Math.floor(p.rpm) : defaults.rpm,
      max_queue_ms: typeof p.max_queue_ms === "number" && p.max_queue_ms >= 0 ? p.max_queue_ms : defaults.max_queue_ms,
      require_json: typeof p.require_json === "boolean" ? p.require_json : defaults.require_json,
      blocked_patterns: Array.isArray(p.blocked_patterns) ? p.blocked_patterns.filter((x) => typeof x === "string") : defaults.blocked_patterns,
    };
  } catch {
    return defaults;
  }
}

const MAX_SYSTEM_CHARS = 16384;
const MAX_HISTORY_TURNS = 8;
const MAX_TURN_CHARS = 8192;

export function parseAsk(body: unknown): AskRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const kind = b.kind === "compute" || b.kind === "state" ? b.kind : "chat";
  const text = typeof b.text === "string" ? b.text : "";
  if (kind !== "chat" && typeof b.op !== "string") return null; // compute/state need an op
  if (kind === "chat" && (!text || text.length > 65536)) return null;
  const req = { kind, text: kind === "chat" ? text : String(b.op ?? "") } as AskRequest;
  if (kind !== "chat") return req;
  // an API project's own rules and history (ignored for the website's visitors)
  if (b.system !== undefined) {
    if (typeof b.system !== "string" || b.system.length > MAX_SYSTEM_CHARS) return null;
    if (b.system.trim()) req.system = b.system;
  }
  if (Array.isArray(b.history)) {
    const turns: { role: "user" | "assistant"; content: string }[] = [];
    for (const item of b.history.slice(-MAX_HISTORY_TURNS)) {
      if (!item || typeof item !== "object") continue;
      const { role, content } = item as { role?: unknown; content?: unknown };
      if ((role !== "user" && role !== "assistant") || typeof content !== "string" || !content.trim()) continue;
      turns.push({ role, content: content.slice(0, MAX_TURN_CHARS) });
    }
    if (turns.length) req.history = turns;
  }
  return req;
}
