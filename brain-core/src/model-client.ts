// Inference client for the brain server — inference ONLY, zero business logic.
//
// The brain server has zero open ports; it is reachable only through the
// Cloudflare Tunnel at MODEL_URL (e.g. https://internal.your-domain.com),
// locked by a Cloudflare Access service token (CF-Access-Client-Id/Secret
// headers) plus a shared secret bearer. The runtime is Ollama serving the one
// published brain, saiftechglobal/sg16-brain:Q4_K_M (POST /api/chat).

import type { ChatTurn } from "./prompt.ts";
import { callTokens } from "./tokens.ts";

export interface ModelConfig {
  url: string;              // e.g. https://internal.your-domain.com
  model: string;            // the one brain: saiftechglobal/sg16-brain:Q4_K_M
  numCtx: number;           // 8192 — hard context cap
  timeoutMs: number;
  sharedSecret: string;
  accessClientId: string;
  accessClientSecret: string;
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
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${cfg.sharedSecret}`,
        "CF-Access-Client-Id": cfg.accessClientId,
        "CF-Access-Client-Secret": cfg.accessClientSecret,
      },
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
