// Inference client for the brain server — inference ONLY, zero business logic.
//
// The brain server has zero open ports; it is reachable only through the
// Cloudflare Tunnel (e.g. https://internal.your-domain.com; set on /admin
// under BRAIN SERVER, or with the MODEL_URL deploy setting),
// locked by a Cloudflare Access service token (CF-Access-Client-Id/Secret
// headers) plus a shared secret bearer. The runtime is Ollama serving the one
// published brain, saiftechglobal/sg16-brain:Q4_K_M (POST /api/chat).

import type { ChatTurn } from "./prompt.ts";
import { callTokens } from "./tokens.ts";

/** Where the brain server is and how to get through its door. Any server
 * works (server-agnostic): the address comes from the admin panel's BRAIN
 * SERVER setting, or from the MODEL_URL deploy setting when none is saved. */
export interface BrainServer {
  url: string;              // e.g. https://internal.your-domain.com
  sharedSecret: string;
  accessClientId: string;
  accessClientSecret: string;
}

export interface ModelConfig extends BrainServer {
  model: string;            // the one brain: saiftechglobal/sg16-brain:Q4_K_M
  numCtx: number;           // 8192 — hard context cap
  timeoutMs: number;
}

/** The headers every brain-server call carries (empty credentials are left out). */
export function serverHeaders(server: BrainServer): Record<string, string> {
  const headers: Record<string, string> = {};
  if (server.sharedSecret) headers.authorization = `Bearer ${server.sharedSecret}`;
  if (server.accessClientId) headers["CF-Access-Client-Id"] = server.accessClientId;
  if (server.accessClientSecret) headers["CF-Access-Client-Secret"] = server.accessClientSecret;
  return headers;
}

export interface ServerProbe {
  reachable: boolean;       // the server answered /api/tags with 200 and a model list
  http: number | null;      // its HTTP status (null: no answer at all)
  modelInstalled: boolean;  // the one brain is among its installed models
  installed: string[];      // the installed model names (first 20), for diagnosis
  latencyMs: number;
  error?: "E_NO_URL" | "E_TIMEOUT" | "E_NETWORK" | "E_STATUS" | "E_BODY";
}

/** Ask a brain server which models it has (Ollama GET /api/tags). The brain
 * counts as online only when the server lists `model` — a server that answers
 * without the SG16 Brain installed is not online. */
export async function probeServer(server: BrainServer, model: string, timeoutMs = 5000): Promise<ServerProbe> {
  const started = Date.now();
  const out: ServerProbe = { reachable: false, http: null, modelInstalled: false, installed: [], latencyMs: 0 };
  if (!server.url) return { ...out, error: "E_NO_URL" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(server.url + "/api/tags", { headers: serverHeaders(server), signal: controller.signal });
    out.http = response.status;
    if (!response.ok) return { ...out, error: "E_STATUS", latencyMs: Date.now() - started };
    const tags = await response.json().catch(() => null) as { models?: Array<{ name?: unknown; model?: unknown }> } | null;
    if (!tags || !Array.isArray(tags.models)) return { ...out, error: "E_BODY", latencyMs: Date.now() - started };
    out.reachable = true;
    for (const m of tags.models) {
      const name = typeof m?.name === "string" ? m.name : typeof m?.model === "string" ? m.model : "";
      if (!name) continue;
      if (out.installed.length < 20) out.installed.push(name);
      if (sameModel(name, model) || (typeof m?.model === "string" && sameModel(m.model, model))) out.modelInstalled = true;
    }
  } catch (e) {
    out.error = (e as Error)?.name === "AbortError" ? "E_TIMEOUT" : "E_NETWORK";
  } finally {
    clearTimeout(timer);
  }
  out.latencyMs = Date.now() - started;
  return out;
}

export class ModelError extends Error {
  code: "E_UPSTREAM_TIMEOUT" | "E_UPSTREAM_STATUS" | "E_UPSTREAM_BODY";
  constructor(code: "E_UPSTREAM_TIMEOUT" | "E_UPSTREAM_STATUS" | "E_UPSTREAM_BODY") {
    super(code);
    this.code = code;
  }
}

/** One model answer plus the tokens it cost (prompt + completion). */
export interface ModelAnswer {
  text: string;
  tokens: number;
}

/** Ollama model names compare case-insensitively ("Q4_K_M" == "q4_k_m"). */
export function sameModel(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export async function callModel(cfg: ModelConfig, messages: readonly ChatTurn[]): Promise<ModelAnswer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const response = await fetch(cfg.url + "/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", ...serverHeaders(cfg) },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream: false,
        options: { num_ctx: cfg.numCtx },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new ModelError("E_UPSTREAM_STATUS");
    const data = await response.json() as Record<string, unknown>;
    const msg = data.message as { content?: string } | undefined;
    if (!msg || typeof msg.content !== "string") throw new ModelError("E_UPSTREAM_BODY");
    const promptChars = messages.reduce((n, m) => n + m.content.length, 0);
    const tokens = callTokens({ prompt: data.prompt_eval_count, completion: data.eval_count }, promptChars, msg.content.length);
    return { text: msg.content, tokens };
  } catch (e) {
    if (e instanceof ModelError) throw e;
    if ((e as Error)?.name === "AbortError") throw new ModelError("E_UPSTREAM_TIMEOUT");
    throw new ModelError("E_UPSTREAM_STATUS");
  } finally {
    clearTimeout(timer);
  }
}
