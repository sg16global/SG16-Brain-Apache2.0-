// Inference client for the VPS — inference ONLY, zero business logic.
//
// The VPS has zero open ports; it is reachable only through the Cloudflare
// Tunnel at MODEL_URL (e.g. https://internal.your-domain.com), locked by
// a Cloudflare Access service token (CF-Access-Client-Id/Secret headers)
// plus a shared secret bearer. Supports two provider shapes:
//   ollama   -> POST /api/chat        (Ollama HTTP API)
//   llamacpp -> POST /v1/chat/completions (llama.cpp server, OpenAI-compatible)

import type { ChatTurn } from "./prompt.ts";
import { callTokens } from "./tokens.ts";

export interface ModelConfig {
  provider: "ollama" | "llamacpp";
  url: string;              // e.g. https://internal.your-domain.com
  model: string;            // the one brain: saiftechglobal/sg16-brain:q4_k_m
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

export async function callModel(cfg: ModelConfig, messages: readonly ChatTurn[]): Promise<ModelAnswer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    let body: string;
    if (cfg.provider === "ollama") {
      body = JSON.stringify({
        model: cfg.model,
        messages,
        stream: false,
        options: { num_ctx: cfg.numCtx },
      });
    } else {
      body = JSON.stringify({
        model: cfg.model,
        messages,
        stream: false,
        max_tokens: 4096,
      });
    }
    const path = cfg.provider === "ollama" ? "/api/chat" : "/v1/chat/completions";
    const response = await fetch(cfg.url + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${cfg.sharedSecret}`,
        "CF-Access-Client-Id": cfg.accessClientId,
        "CF-Access-Client-Secret": cfg.accessClientSecret,
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) throw new ModelError("E_UPSTREAM_STATUS");
    const data = await response.json() as Record<string, unknown>;
    const promptChars = messages.reduce((n, m) => n + m.content.length, 0);
    if (cfg.provider === "ollama") {
      const msg = data.message as { content?: string } | undefined;
      if (!msg || typeof msg.content !== "string") throw new ModelError("E_UPSTREAM_BODY");
      const tokens = callTokens({ prompt: data.prompt_eval_count, completion: data.eval_count }, promptChars, msg.content.length);
      return { text: msg.content, tokens };
    }
    const choice = (data.choices as Array<{ message?: { content?: string } }> | undefined)?.[0];
    if (!choice?.message?.content || typeof choice.message.content !== "string") throw new ModelError("E_UPSTREAM_BODY");
    const usage = (data.usage ?? {}) as Record<string, unknown>;
    const tokens = callTokens(
      { prompt: usage.prompt_tokens, completion: usage.completion_tokens, total: usage.total_tokens },
      promptChars,
      choice.message.content.length,
    );
    return { text: choice.message.content, tokens };
  } catch (e) {
    if (e instanceof ModelError) throw e;
    if ((e as Error)?.name === "AbortError") throw new ModelError("E_UPSTREAM_TIMEOUT");
    throw new ModelError("E_UPSTREAM_STATUS");
  } finally {
    clearTimeout(timer);
  }
}
