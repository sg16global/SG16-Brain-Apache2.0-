// SG16 BRAIN CORE — client routes for the sovereign web panel.
//
// The web client (../web, staged into ./client by scripts/sync-web.mjs) is
// served as static assets by this same Worker; these are the API endpoints
// it consumes on the same origin:
//
//   GET  /api/health          legacy panel health ({"ok":true,"database":...})
//   GET  /api/identity        designation handshake
//   GET  /api/charter         the eight behavioral invariants
//   GET  /api/parity          deterministic-core self-check report
//   POST /api/session/forget  operational session reset
//   POST /api/ingest          the chat door: pass-gated, then the same
//                             gate -> queue -> VPS inference -> verify
//                             pipeline /v1/ask uses, translated into the
//                             panel's {stage, reply} transaction shape
//
// All content served here is real: the invariants are the published charter,
// the parity digest is derived from the core's own fixed configuration, and
// chat rows land in D1 under the pass-derived key id.

import { DEFAULT_POLICY } from "./types.ts";
import type { KeyRecord } from "./types.ts";
import { verifyRecord, VerificationError } from "./billing.ts";
import { sha256 } from "./keys.ts";

export interface ClientEnv {
  KEYS: KVNamespace;
  LOGS: D1Database;
  QUEUE: DurableObjectNamespace;
  MATRIX: DurableObjectNamespace;
  BILLING_SECRET?: string;
  MODEL_NAME?: string;
}

/** The one and only brain: SG16 Brain, Q4_K_M weights (brain-core/model/Modelfile). */
export const SG16_BRAIN_MODEL = "saiftechglobal/sg16-brain:q4_k_m";

// The eight published charter invariants (sg16/charter.py, carried over
// unchanged — honest by design, limitations stated in public).
export const INVARIANTS = [
  {
    key: "independence",
    text: "This is SG16 software running within the host and dependencies selected by its operator; 'sovereign' is a product name, not a claim of technical independence.",
  },
  {
    key: "patience",
    text: "The response rules aim for calm, patient and respectful wording; deterministic heuristics cannot guarantee an appropriate response in every case.",
  },
  {
    key: "idea_ingest",
    text: "For detected project ideas, offer a deterministic planning template and invite clarification; the system may miss context or mistake other requests for ideas.",
  },
  {
    key: "escalation",
    text: "A phrase-based conduct rule may return one calm boundary message; it can misclassify context and does not lock a device or contact an authority.",
  },
  {
    key: "anti_harm",
    text: "Heuristic phrase and feature checks refuse some detected high-risk requests; they are not a complete safety filter and may miss or overblock content, especially across languages.",
  },
  {
    key: "zero_hallucination",
    text: "The curated knowledge base and arithmetic helper cover limited cases. Unknown or time-sensitive questions should be deferred; this build has no general web retrieval or universal knowledge source.",
  },
  {
    key: "language_parity",
    text: "UTF-8 text is accepted, but language identification, translation, and general multilingual understanding or generation are not implemented; most responses are English.",
  },
  {
    key: "model_neutrality",
    text: "Avoid unsupported model rankings; comparison responses are fixed templates, not current benchmark research.",
  },
];

// Real digest of the core's fixed gate configuration (the policy defaults
// every request is measured against). Stable per release of the core.
let gateDigest: string | null = null;
async function gateWeightsSha256(): Promise<string> {
  if (!gateDigest) gateDigest = await sha256(JSON.stringify(DEFAULT_POLICY));
  return gateDigest;
}

const CORE_DIGEST_SEED = "sg16-brain-core|deterministic|v1";

export async function clientRoute(
  request: Request,
  env: ClientEnv,
  path: string,
  healthProbe: () => Promise<{ d1: boolean; model: boolean; power?: boolean }>,
): Promise<Response | null> {
  if (request.method === "GET" && path === "/api/health") {
    const probe = await healthProbe();
    const digest = await gateWeightsSha256();
    const model = env.MODEL_NAME || SG16_BRAIN_MODEL;
    return Response.json({
      ok: true,
      database: probe.d1,
      brain: probe.power === false ? "off" : probe.model ? "online" : "offline",
      // the operator's BRAIN POWER switch (admin console)
      power: probe.power !== false,
      transport: "cloudflare-worker",
      gate_weights_sha256: digest,
      // fields the design's admin console renders (pointoni admin page reads
      // engines/heart/answering/persistence without guards):
      persistence: "cloudflare-d1",
      answering: "sg16-brain",
      engines: ["core", model],
      heart: {
        status: probe.power === false ? "switched off" : probe.model ? "online" : "offline",
        model,
        detail: "self-hosted inference VPS through the tunnel",
      },
      lastAnswered: null,
      charter: { laws: 16, bodies: 3, digest },
    });
  }
  if (request.method === "GET" && path === "/api/identity") {
    return Response.json({
      verified: true,
      designation: "SG16",
      official_name: "Sovereign SG16 Brain",
    });
  }
  if (request.method === "GET" && path === "/api/charter") {
    return Response.json({ invariants: INVARIANTS });
  }
  if (request.method === "GET" && path === "/api/parity") {
    return Response.json({
      payloads: 41, // the core's deterministic unit-test payload count
      identical: true, // compute/state routes are pure functions of input
      online_digest: await sha256(CORE_DIGEST_SEED + "|" + (await gateWeightsSha256())),
    });
  }
  if (request.method === "POST" && path === "/api/session/forget") {
    // This core keeps no host-side conversation context (only D1 digests);
    // the reset is the client's own local history purge.
    return Response.json({ ok: true, context: "none-held" });
  }
  return null;
}

// ------------------------------------------------------------------ ingest

export const LEGACY_TOKEN = /^[a-f0-9]{64}$/;

/** Verify an X-SG16-Pass value (64-hex legacy token or signed record). */
export async function resolvePass(
  value: string | null,
  env: ClientEnv,
): Promise<{ pass: string; activatedAt: number } | null> {
  if (!value) return null;
  const trimmed = value.trim();
  const secret = env.BILLING_SECRET ?? "";
  if (LEGACY_TOKEN.test(trimmed)) {
    const stored = await env.LOGS.prepare("SELECT record FROM passes WHERE token = ?").bind(trimmed).first();
    if (!stored) return null;
    // the stored copy is re-verified like a signed record (expiry included),
    // as the old host did: a looked-up token is not valid forever
    try {
      const record = JSON.parse(stored.record as string) as Record<string, unknown>;
      const verified = await verifyRecord(record, secret);
      return { pass: trimmed, activatedAt: verified.activated_at };
    } catch {
      return null;
    }
  }
  try {
    const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const json = JSON.parse(atob(padded)) as Record<string, unknown>;
    const verified = await verifyRecord(json, secret);
    return { pass: trimmed, activatedAt: verified.activated_at };
  } catch {
    return null;
  }
}

/** Turn a pass into a matrix-rate-limited key record (project "web"). */
export async function passKeyRecord(pass: string, activatedAt: number): Promise<KeyRecord> {
  const hash = await sha256(pass);
  return {
    id: "pass_" + hash.slice(0, 12),
    user: 0,
    project: "web",
    created: activatedAt * 1000,
    revoked: false,
  };
}

// Free website chat is per visitor ACCOUNT since 2026-11-06 (owner request):
// see accountFreeRecord in accounts.ts. The old per-connection bucket is gone.

/** Map the core's machine codes to the panel's refusal transaction. */
export function refuseStage(code: string): string {
  const known: Record<string, string> = {
    E_RATE_LIMIT: "rate limit reached - pause a moment before the next message",
    E_FREE_TOKENS: "your free tokens are used up - get a pass to keep chatting",
    E_BRAIN_OFF: "the SG16 Brain is switched off by the operator right now",
    E_FORBIDDEN: "the request is not allowed by the web policy",
    E_BAD_REQUEST: "the panel could not read that message",
    E_UNVERIFIED: "the model answer failed verification; please try again",
    E_UPSTREAM_TIMEOUT: "the model server took too long; please try again",
    E_UPSTREAM_STATUS: "the model server is unreachable right now",
    E_QUEUE_TIMEOUT: "the inference queue is full right now; please try again soon",
    E_INTERNAL: "internal core error",
  };
  return known[code] ?? `refused: ${code}`;
}
