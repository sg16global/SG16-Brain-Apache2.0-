// ===================================================================
// SG16 OLLAMA HEART-BRIDGE — server-side only.
//
// The heart of the platform can live on the operator's own metal. When the
// Q16.16 sovereign core (sg16 python runtime, :8080) is absent but a local
// Ollama daemon is present, this bridge lets the brain keep answering from
// the operator's own machine — zero vendor APIs, zero per-token cost, zero
// data leaving the host. Same doctrine as the core gateway:
//
//   * the daemon URL comes ONLY from SG16_OLLAMA_URL (never from a request)
//     and is never echoed to the client;
//   * the charter preamble is distilled in front of every turn, so the
//     heart speaks with the platform's law, not with a vendor's defaults;
//   * a hard timeout wraps every call so a stalled daemon can never pin the
//     Next.js runtime;
//   * no logging of message content, ever;
//   * honest capability reporting: a turn answered here is flagged
//     `brain: "ollama"` — never dressed up as the core.
//
// Enable by pointing SG16_OLLAMA_URL at the daemon (default is the standard
// loopback port). The model is the one SG16 Brain (Q4_K_M), registered from its GGUF:
//   ollama create saiftechglobal/sg16-brain:q4_k_m -f brain-core/model/Modelfile
//   SG16_OLLAMA_MODEL=saiftechglobal/sg16-brain:q4_k_m   (the default)
// ===================================================================

import { distillCharter, type CharterBody } from "./charter-prompt.ts";
import type { ResolvedMode } from "./code-mode.ts";

export type OllamaTurn = {
  /** the model that actually answered (daemon-reported) */
  model: string;
  /** assistant text */
  reply: string;
  /** wall-clock time for the whole bridge call */
  latencyMs: number;
  /** always "ollama" — the platform reports the real runtime, never a guess */
  source: "ollama";
  /** true when the answer was cut (time budget or token cap) rather than finished by the model */
  truncated: boolean;
};

export type OllamaHealth = {
  status: "online" | "offline";
  model: string;
  models?: string[];
  latencyMs?: number;
  detail?: string;
};

export type OllamaBridgeKind = "unreachable" | "http-error" | "bad-payload" | "timeout";

export class OllamaBridgeError extends Error {
  kind: OllamaBridgeKind;
  status?: number;

  constructor(kind: OllamaBridgeKind, message: string, status?: number) {
    super(message);
    this.name = "OllamaBridgeError";
    this.kind = kind;
    this.status = status;
  }
}

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
// the one brain: SG16 Brain, Q4_K_M weights (brain-core/model/Modelfile)
const DEFAULT_OLLAMA_MODEL = "saiftechglobal/sg16-brain:q4_k_m";
const DEFAULT_TIMEOUT_MS = 45_000;
/** What the prompt says about where the Brain runs. Deliberately generic: the inner model is not named. */
export const RUNTIME_LABEL = "the operator's own server";

const MAX_TURNS = 12;
const DEFAULT_MAX_TOKENS = 600;
/** a cut-off answer shorter than this is not worth showing: fall back instead */
const MIN_PARTIAL_CHARS = 120;

/** Loopback default; overridable by the operator only. */
function ollamaBaseUrl(): string {
  return (process.env.SG16_OLLAMA_URL?.trim() || DEFAULT_OLLAMA_URL).replace(/\/+$/, "");
}

export function ollamaModel(): string {
  return process.env.SG16_OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL;
}

/** Hard cap on generated tokens per answer. */
export function ollamaMaxTokens(): number {
  const parsed = Number(process.env.SG16_OLLAMA_MAX_TOKENS);
  return Number.isInteger(parsed) && parsed >= 50 && parsed <= 4000 ? parsed : DEFAULT_MAX_TOKENS;
}

export function ollamaTimeoutMs(): number {
  const parsed = Number(process.env.SG16_OLLAMA_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed >= 1000 ? parsed : DEFAULT_TIMEOUT_MS;
}

/** Master switch — the bridge is inert unless the operator opts in. */
export function ollamaEnabled(): boolean {
  return process.env.SG16_OLLAMA_ENABLED !== "0" && Boolean(process.env.SG16_OLLAMA_URL?.trim());
}

export type OllamaTurnInput = {
  message: string;
  /** rolling history, oldest first — kept tiny on purpose */
  history?: { role: "user" | "assistant"; content: string }[];
  body?: CharterBody;
  mode?: ResolvedMode;
  tier?: string;
  humanitarianRegion?: string | null;
  /** extra context injected into the system preamble (e.g. a tape snapshot) */
  context?: string | null;
  /** hard cap on generated tokens for this turn */
  maxTokens?: number;
  /** called with each piece of the answer as it is written, so the person can read along */
  onDelta?: (text: string) => void;
  /** the person left: stop asking the model to write (closing the stream makes Ollama stop) */
  signal?: AbortSignal;
};

type OllamaChatChunk = {
  message?: { role?: string; content?: string };
  model?: string;
  done?: boolean;
  error?: string;
};

/** Cut at the last sentence end when that keeps most of the text; otherwise at the last word. */
export function trimToSentence(text: string): string {
  const clean = text.trimEnd();
  const stops = [". ", "! ", "? ", "\n", "\u3002", "\u0964 "].map((m) => clean.lastIndexOf(m));
  const end = Math.max(...stops);
  if (end > clean.length * 0.5) return clean.slice(0, end + 1).trimEnd();
  return clean.replace(/\s+\S*$/, "");
}

/**
 * One turn through the heart-bridge: charter preamble + history + message, STREAMED off the daemon.
 *
 * Streaming matters twice over. A long answer on this hardware takes about a minute, so when the time
 * budget (SG16_OLLAMA_TIMEOUT_MS) runs out we return what has been written so far instead of throwing
 * the whole answer away; and closing the stream tells Ollama to stop generating instead of burning the
 * model on an answer nobody will read. Throws OllamaBridgeError so the caller can degrade honestly.
 */
export async function ollamaChat(input: OllamaTurnInput): Promise<OllamaTurn> {
  const started = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ollamaTimeoutMs());

  const body: CharterBody = input.body ?? "flagship";
  const system = distillCharter(body, {
    tier: input.tier,
    humanitarianRegion: input.humanitarianRegion,
    mode: input.mode,
    // constant on purpose: the system prompt must be byte-identical every
    // request so Ollama can reuse its cached prompt start
    runtime: RUNTIME_LABEL,
    context: input.context ?? null,
  });

  const messages = [
    { role: "system", content: system },
    ...(input.history ?? []).slice(-MAX_TURNS),
    { role: "user", content: input.message },
  ];

  let text = "";
  let modelName: string | undefined;
  let finished = false;
  let hitTokenCap = false;
  const onCallerAbort = () => controller.abort();
  if (input.signal?.aborted) controller.abort();
  input.signal?.addEventListener("abort", onCallerAbort, { once: true });

  try {
    const res = await fetch(`${ollamaBaseUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel(),
        messages,
        stream: true,
        options: {
          temperature: 0.7,
          num_predict: input.maxTokens ?? ollamaMaxTokens(),
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      // read a bounded slice for the operator error, never the whole body
      const errText = await res.text().catch(() => "");
      throw new OllamaBridgeError(
        "http-error",
        `heart-bridge answered ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`,
        res.status,
      );
    }
    if (!res.body) throw new OllamaBridgeError("bad-payload", "heart-bridge sent no body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    const take = (line: string) => {
      let chunk: OllamaChatChunk;
      try {
        chunk = JSON.parse(line) as OllamaChatChunk;
      } catch {
        throw new OllamaBridgeError("bad-payload", "heart-bridge sent an unreadable chunk");
      }
      if (chunk.error) throw new OllamaBridgeError("bad-payload", `heart-bridge error: ${String(chunk.error).slice(0, 200)}`);
      const piece = chunk.message?.content ?? "";
      text += piece;
      if (piece && input.onDelta) {
        try {
          input.onDelta(piece);
        } catch {
          // a broken display callback must never break the answer
        }
      }
      modelName ??= chunk.model;
      if (chunk.done) {
        finished = true;
        hitTokenCap = (chunk as { done_reason?: string }).done_reason === "length";
      }
    };
    try {
      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        let nl = pending.indexOf("\n");
        while (nl >= 0 && !finished) {
          const line = pending.slice(0, nl).trim();
          pending = pending.slice(nl + 1);
          if (line) take(line);
          nl = pending.indexOf("\n");
        }
      }
      if (!finished && pending.trim()) take(pending.trim());
    } finally {
      // closing the stream tells Ollama to stop generating
      reader.cancel().catch(() => undefined);
    }
  } catch (err) {
    if (err instanceof OllamaBridgeError) throw err;
    const aborted = timedOut || (err instanceof Error && err.name === "AbortError");
    if (!aborted || text.trim().length < MIN_PARTIAL_CHARS) {
      throw new OllamaBridgeError(
        aborted ? "timeout" : "unreachable",
        aborted ? "heart-bridge timed out" : "heart-bridge is unreachable",
      );
    }
    // out of time but most of an answer exists: keep it, honestly cut
    return {
      model: modelName ?? ollamaModel(),
      reply: `${trimToSentence(text)} \u2026`,
      latencyMs: Date.now() - started,
      source: "ollama",
      truncated: true,
    };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onCallerAbort);
  }

  const reply = text.trim();
  if (!reply) throw new OllamaBridgeError("bad-payload", "heart-bridge returned an empty reply");
  return {
    model: modelName ?? ollamaModel(),
    reply: hitTokenCap ? `${trimToSentence(reply)} \u2026` : reply,
    latencyMs: Date.now() - started,
    source: "ollama",
    truncated: hitTokenCap,
  };
}

/** Readiness probe (GET /api/tags) — cheap, also lists pulled models. */
export async function ollamaHealth(): Promise<OllamaHealth> {
  const model = ollamaModel();
  if (!ollamaEnabled()) {
    return { status: "offline", model, detail: "not configured (set SG16_OLLAMA_URL to enable)" };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(ollamaTimeoutMs(), 5_000));
  try {
    const res = await fetch(`${ollamaBaseUrl()}/api/tags`, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      return { status: "offline", model, detail: `daemon answered ${res.status}` };
    }
    const data = (await res.json()) as { models?: { name?: string }[] };
    const models = (data.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => Boolean(n));
    return {
      status: "online",
      model,
      models,
      latencyMs: Date.now() - started,
      detail: models.includes(model) ? "model present" : "daemon up — model may need `ollama pull`",
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { status: "offline", model, detail: aborted ? "probe timed out" : "daemon unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/** Reporting only — always safe to expose (no URL, no credentials). */
export function ollamaTargetSummary() {
  return {
    enabled: ollamaEnabled(),
    configured: Boolean(process.env.SG16_OLLAMA_URL?.trim()),
    defaultUrl: DEFAULT_OLLAMA_URL,
    model: ollamaModel(),
    timeoutMs: ollamaTimeoutMs(),
  };
}
