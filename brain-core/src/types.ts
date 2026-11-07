// Shared types for the brain core. Language-neutral by construction:
// human language exists only at the model layer; the core speaks in
// machine codes and structures.

export interface KeyRecord {
  id: string;          // internal id, e.g. "k_01"
  user: number;        // owner = 1; every consumer, including the owner, uses keys
  project: string;     // "platform" for the owner/first party
  created: number;     // unix ms
  revoked: boolean;
}

export interface Policy {
  rpm: number;                 // requests per minute
  max_queue_ms: number;        // how long a request may wait for the model slot
  require_json: boolean;       // answers must be a JSON object {answer: ...}
  blocked_patterns: string[];  // regexes (operator-configured, per project)
  /** API projects only: the project's own instructions for the brain, set by
   * the operator on /admin (PROJECT RULES); sent before the caller's `system` */
  system?: string;
}

export const DEFAULT_POLICY: Policy = {
  rpm: 60,
  max_queue_ms: 45000,
  require_json: false,
  blocked_patterns: [],
};

export interface AskRequest {
  kind: "chat" | "compute" | "state";
  text: string;
  /** API projects only: the project's own rules, sent as the system message. */
  system?: string;
  /** API projects only: earlier turns, sent to the model as real chat turns. */
  history?: { role: "user" | "assistant"; content: string }[];
}

export interface AskMeta {
  engine: "model-vps" | "core";
  model: string;       // the self-hosted brain that answered (saiftechglobal/sg16-brain:Q4_K_M)
  checked: boolean;    // the self-check pass ran on this answer
  queue_ms: number;
  latency_ms: number;
  verified: boolean;
  script: string | null;
  tokens?: number;                // model tokens this answer cost (prompt + completion, every pass)
  free_tokens_remaining?: number; // free tier only: allowance left after this answer
}

export interface ErrorBody {
  ok: false;
  code: string; // machine code, e.g. E_RATE_LIMIT — never a human-language sentence
}

export const ERR = {
  E_BAD_REQUEST: 400,
  E_UNAUTHORIZED: 401,
  E_FORBIDDEN: 403,
  E_NOT_FOUND: 404,
  E_FREE_TOKENS: 402, // free-tier token allowance spent: a pass is required
  E_KEY_OFF: 403,     // the operator switched this API key off (or retired it)
  E_BRAIN_OFF: 503,   // the operator switched the brain off (admin BRAIN POWER)
  E_RATE_LIMIT: 429,
  E_BUSY: 503,
  E_UPSTREAM: 502,
  E_UNVERIFIED: 502,
  E_INTERNAL: 500,
} as const;
