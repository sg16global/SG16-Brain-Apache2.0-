// Output verification — the core never trusts the model blindly.
//
// Checks are language-neutral and deterministic: structure (JSON when the
// project requires it), size, control characters, and the project's blocked
// regex patterns (operator-configured, per project). On failure the caller
// retries once, then rejects with a machine code — never a human sentence.

import type { Policy } from "./types.ts";

export interface VerifyInput {
  text: string;
  requireJson: boolean;
  maxOutputChars: number;
  blockedPatterns: string[];
}

export type VerifyResult = { ok: true } | { ok: false; reason: "EMPTY" | "TOO_LARGE" | "CONTROL_CHARS" | "BAD_JSON" | "POLICY" };

export function verifyOutput(input: VerifyInput): VerifyResult {
  const text = input.text ?? "";
  if (!text.trim()) return { ok: false, reason: "EMPTY" };
  if (text.length > input.maxOutputChars) return { ok: false, reason: "TOO_LARGE" };
  // tab, LF and CR are ordinary text (CRLF line endings are common in code answers)
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return { ok: false, reason: "CONTROL_CHARS" };

  if (input.requireJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: "BAD_JSON" };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "BAD_JSON" };
    const answer = (parsed as Record<string, unknown>).answer;
    if (typeof answer !== "string" || !answer.trim()) return { ok: false, reason: "BAD_JSON" };
  }

  for (const pattern of input.blockedPatterns) {
    try {
      if (new RegExp(pattern, "u").test(text)) return { ok: false, reason: "POLICY" };
    } catch {
      // an operator's broken regex must never wedge verification
    }
  }
  return { ok: true };
}

/** Deterministic policy gate applied to the user's request before inference. */
export function requestAllowed(text: string, policy: Policy): boolean {
  for (const pattern of policy.blocked_patterns) {
    try {
      if (new RegExp(pattern, "u").test(text)) return false;
    } catch {
      // ignore broken operator regex
    }
  }
  return true;
}
