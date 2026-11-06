// Technical / build requests: raw scripts, config, structured text, "build me an app".
//
// The brain answers these as a working engineer would: the code first, in fenced blocks, with no
// greeting and no closing chatter, and with room for a whole file. This module only DETECTS such a
// request and supplies the matching hint and budgets. It never decides what is allowed: the core's
// safety gate screens every message (code or not) before any model sees it, exactly as before.

export const CODE_HINT =
  "\n\n(This is a technical request. Reply with the finished code or text in fenced code blocks, " +
  "complete and runnable, with no greeting, no introduction and no closing remarks. " +
  "Add at most two short lines of notes after the code, only if they are needed to run it.)";

/** Remembered turns that contain code may be longer than plain chat, or the code is cut in half. */
export const MAX_CODE_TURN_CHARS = 3000;
/** The model may write up to this many times the normal answer budget for a code request. */
export const CODE_TOKEN_FACTOR = 3;
export const CODE_TOKEN_CEILING = 4000;

const FENCE = /```/;
const SYNTAX = [
  /^\s*(import|from)\s+[\w.{}*,\s]+\s+(from\s+)?["']?[\w./@-]+["']?\s*;?\s*$/m,
  /^\s*(def|class|async def)\s+\w+/m,
  /^\s*(function|const|let|var|export|public|private|package|using|namespace|#include)\b.*[({;=]/m,
  /=>\s*[{(]/,
  /^\s*<\/?[a-z][\w-]*(\s[^>]*)?>/im,
  /^\s*(SELECT|INSERT|UPDATE|CREATE|ALTER)\b[\s\S]*?\b(FROM|INTO|SET|TABLE)\b/m,
  /^\s*[\w-]+:\s*$/m, // yaml-ish key block
  /^#!\/(usr\/)?bin\//m,
  /\b(fn|func|impl|struct|interface|enum)\s+\w+\s*[({<]/,
];
const BUILD_REQUEST =
  /\b(write|build|create|make|implement|generate|fix|debug|refactor|port|convert|scaffold|deploy)\b[^.\n]{0,60}\b(app|application|api|script|function|class|component|website|web\s?site|bot|cli|program|code|module|endpoint|server|backend|frontend|database|schema|dockerfile|workflow|regex|query|test|plugin|extension|library|package)\b/i;

export const MODES = ["auto", "chat", "assistant", "code", "build"] as const;
export type Mode = (typeof MODES)[number];
export type ResolvedMode = Exclude<Mode, "auto">;

const BUILD_INTENT = /\b(app|application|website|web\s?site|saas|dashboard|bot|backend|frontend|full[-\s]?stack|project|mvp|landing\s?page|api)\b/i;

/**
 * The mode for one request. An explicit, valid `mode` from the caller always wins (a project that
 * connects over the API picks its own). "auto" or anything unrecognised is decided from the text.
 */
export function resolveMode(requested: unknown, message: string): ResolvedMode {
  if (typeof requested === "string" && (MODES as readonly string[]).includes(requested) && requested !== "auto") {
    return requested as ResolvedMode;
  }
  if (!isTechnicalRequest(message)) return "chat";
  return BUILD_REQUEST.test(message) && BUILD_INTENT.test(message) && !FENCE.test(message) ? "build" : "code";
}

/** True when the text carries code, structured text, or asks for something to be built. */
export function isTechnicalRequest(text: string): boolean {
  if (FENCE.test(text)) return true;
  if (BUILD_REQUEST.test(text)) return true;
  const lines = text.split("\n");
  if (lines.length >= 3 && SYNTAX.some((re) => re.test(text))) return true;
  return false;
}

/** Same detection for a remembered turn, so its code is kept whole. */
export function turnLimit(content: string, normal: number): number {
  return FENCE.test(content) || isTechnicalRequest(content) ? Math.max(normal, MAX_CODE_TURN_CHARS) : normal;
}

/** Modes that write code or whole deliverables: code hint, larger budget. */
export const isCodeLike = (m: ResolvedMode): boolean => m === "code" || m === "build";

export function codeTokenBudget(normal: number): number {
  return Math.min(CODE_TOKEN_CEILING, normal * CODE_TOKEN_FACTOR);
}
