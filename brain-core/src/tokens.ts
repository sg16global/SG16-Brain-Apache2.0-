// Free-tier token ledger — pure arithmetic, held per visitor in MatrixDO.
//
// Every website visitor without a pass gets a ONE-TIME allowance of real model
// tokens (prompt + answer, as reported by the model host). When it is spent,
// chat needs a pass (subscription). Pass holders and API project keys are
// never metered by this ledger.

export const DEFAULT_FREE_TOKENS = 10_000;

/** Parse FREE_TOKEN_ALLOWANCE; anything missing or invalid -> the default. */
export function freeTokenAllowance(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_FREE_TOKENS;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : DEFAULT_FREE_TOKENS;
}

export interface TokenBalance {
  allowance: number;
  used: number;
  remaining: number;
}

export function balanceOf(used: number, allowance: number): TokenBalance {
  const spent = Math.max(0, Math.trunc(used) || 0);
  return { allowance, used: spent, remaining: Math.max(0, allowance - spent) };
}

/** Tokens one model call cost. Uses the host's own counts; when a host does
 * not report them, falls back to a conservative estimate (~4 chars/token) so
 * a free answer is never metered as zero. */
export function callTokens(
  reported: { prompt?: unknown; completion?: unknown; total?: unknown },
  promptChars: number,
  answerChars: number,
): number {
  const total = Number(reported.total);
  if (Number.isSafeInteger(total) && total > 0) return total;
  const prompt = Number(reported.prompt);
  const completion = Number(reported.completion);
  if (Number.isSafeInteger(prompt) && Number.isSafeInteger(completion) && prompt >= 0 && completion >= 0 && prompt + completion > 0) {
    return prompt + completion;
  }
  return Math.max(1, Math.ceil((promptChars + answerChars) / 4));
}
