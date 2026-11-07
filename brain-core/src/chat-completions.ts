// Standard chat-completions door: POST /v1/chat/completions and GET /v1/models.
//
// Lets any client that speaks the industry-standard chat-completions request
// format (the SG16 AI Engine's universal gateway, SDKs, tools) use the brain
// with just a base URL (https://<the site>/v1), a key and the model "sg16-brain".
// It is only a format adapter: the request goes through the same pipeline as
// /v1/ask — same key check (sg16_ or sg16p_ keys), project rate limit, queue,
// safety gate and output verification. Text only; no streaming.

import type { AskRequest } from "./types.ts";

export const COMPLETIONS_MODEL = "sg16-brain";

const MAX_SYSTEM_CHARS = 16384;
const MAX_HISTORY_TURNS = 8;
const MAX_TURN_CHARS = 8192;
const MAX_TEXT_CHARS = 65536;

type Role = "system" | "user" | "assistant";

export type CompletionsParse =
  | { ok: true; ask: AskRequest }
  | { ok: false; status: number; message: string; param?: string };

function contentText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") return null;
    const p = part as { type?: unknown; text?: unknown };
    if (p.type !== "text" || typeof p.text !== "string") return null; // images, audio: not supported
    parts.push(p.text);
  }
  return parts.join("\n");
}

/** Standard chat-completions body -> the brain's /v1/ask body. */
export function parseChatCompletions(body: unknown): CompletionsParse {
  if (!body || typeof body !== "object") return { ok: false, status: 400, message: "Request body must be a JSON object." };
  const b = body as Record<string, unknown>;
  if (b.stream === true) return { ok: false, status: 400, message: "Streaming is not supported; send stream: false.", param: "stream" };
  if (b.model !== undefined && b.model !== COMPLETIONS_MODEL) {
    return { ok: false, status: 404, message: `The model "${String(b.model)}" does not exist. Use "${COMPLETIONS_MODEL}".`, param: "model" };
  }
  if (!Array.isArray(b.messages) || !b.messages.length) {
    return { ok: false, status: 400, message: "messages must be a non-empty array.", param: "messages" };
  }

  const system: string[] = [];
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  for (const raw of b.messages) {
    const m = (raw ?? {}) as { role?: unknown; content?: unknown };
    const role = m.role as Role;
    const text = contentText(m.content);
    if (text === null) {
      return { ok: false, status: 400, message: "Only text content is supported.", param: "messages" };
    }
    if (role === "system" || (role as string) === "developer") system.push(text);
    else if (role === "user" || role === "assistant") turns.push({ role, content: text });
    else return { ok: false, status: 400, message: `Unsupported message role "${String(m.role)}".`, param: "messages" };
  }

  const last = turns.pop();
  if (!last || last.role !== "user" || !last.content.trim()) {
    return { ok: false, status: 400, message: "The last message must be a non-empty user message.", param: "messages" };
  }

  const ask: AskRequest = { kind: "chat", text: last.content.slice(0, MAX_TEXT_CHARS) };
  const systemText = system.join("\n\n").trim();
  if (systemText) ask.system = systemText.slice(0, MAX_SYSTEM_CHARS);
  const history = turns
    .filter((t) => t.content.trim())
    .slice(-MAX_HISTORY_TURNS)
    .map((t) => ({ role: t.role, content: t.content.slice(0, MAX_TURN_CHARS) }));
  if (history.length) ask.history = history;
  return { ok: true, ask };
}

/** The standard chat-completions error body. */
export function completionsError(status: number, message: string, param?: string): Response {
  const type = status === 401 ? "authentication_error"
    : status === 429 ? "rate_limit_error"
    : status >= 500 ? "server_error"
    : "invalid_request_error";
  return Response.json({ error: { message, type, param: param ?? null, code: null } }, { status });
}

const ERROR_MESSAGES: Record<string, string> = {
  E_BAD_REQUEST: "The request is not valid.",
  E_UNAUTHORIZED: "Invalid API key.",
  E_RATE_LIMIT: "Rate limit reached or the brain is busy. Retry shortly.",
  E_FORBIDDEN: "The request is not allowed by the SG16 policy.",
  E_QUEUE_TIMEOUT: "The brain is busy. Retry shortly.",
  E_UPSTREAM: "The model server did not answer. Retry shortly.",
  E_UNVERIFIED: "The model answer did not pass verification. Retry.",
};

/** The brain's /v1/ask response -> a standard chat.completion (or the standard error body). */
export async function toChatCompletion(res: Response): Promise<Response> {
  const out = (await res.json().catch(() => null)) as { ok?: boolean; answer?: unknown; code?: unknown } | null;
  if (res.ok && out?.ok === true && typeof out.answer === "string") {
    return Response.json({
      id: `chatcmpl-${crypto.randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: COMPLETIONS_MODEL,
      choices: [{ index: 0, message: { role: "assistant", content: out.answer }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  }
  const code = typeof out?.code === "string" ? out.code : "E_INTERNAL";
  return completionsError(res.ok ? 500 : res.status, ERROR_MESSAGES[code] ?? "The brain could not answer. Retry.");
}

/** GET /v1/models — the one model the brain exposes. */
export function modelList(): Response {
  return Response.json({
    object: "list",
    data: [{ id: COMPLETIONS_MODEL, object: "model", created: 0, owned_by: "sg16" }],
  });
}
