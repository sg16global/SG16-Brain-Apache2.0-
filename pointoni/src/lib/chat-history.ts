// Conversation memory without server storage.
//
// The server remembers nothing between messages. So that follow-ups work ("and what about the second
// one?", "continue"), the visitor's own device sends the last few turns with each message. They are
// used for this one answer and forgotten. Everything in them is untrusted client data: it is trimmed,
// size-capped, and screened by the safety gate together with the new message.

import { turnLimit } from "./code-mode.ts";

export type HistoryTurn = { role: "user" | "assistant"; content: string };

// Measured on the CPU-only server: text the model has not seen before is read at ~20-40 tokens/s, so every
// remembered character costs waiting time. Four messages (two exchanges) of at most 800 characters keeps a
// follow-up cheap; the fixed system prompt is cached and costs almost nothing.
export const MAX_HISTORY_TURNS = 4;
export const MAX_TURN_CHARS = 800;
export const MAX_GATE_CHARS = 8000;

export function sanitizeHistory(raw: unknown): HistoryTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: HistoryTurn[] = [];
  for (const item of raw.slice(-MAX_HISTORY_TURNS)) {
    if (!item || typeof item !== "object") continue;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const text = content.trim().slice(0, turnLimit(content, MAX_TURN_CHARS));
    if (text) turns.push({ role, content: text });
  }
  return turns;
}

/** What the safety gate reads: the remembered turns AND the new message (the newest text is kept if too long). */
export function gateTextFor(history: HistoryTurn[], message: string): string {
  return [...history.map((h) => h.content), message].join("\n").slice(-MAX_GATE_CHARS);
}

const NOT_AN_ANSWER = new Set(["core-gate", "busy", "rate-limited"]);

/**
 * Pick the turns worth remembering from the visible conversation: finished question/answer pairs only.
 * A refused question and its refusal are left out, otherwise the gate would keep re-reading the blocked
 * text and refuse every later message in the conversation.
 */
export function historyFromMessages(
  messages: { role: string; content: string; engine?: string; pending?: boolean }[],
): HistoryTurn[] {
  const out: HistoryTurn[] = [];
  for (let i = 0; i + 1 < messages.length; i++) {
    const q = messages[i];
    const a = messages[i + 1];
    if (q.role !== "user" || a.role !== "assistant" || q.pending || a.pending) continue;
    if (a.engine && NOT_AN_ANSWER.has(a.engine)) continue;
    out.push({ role: "user", content: q.content }, { role: "assistant", content: a.content });
    i += 1;
  }
  return sanitizeHistory(out);
}
