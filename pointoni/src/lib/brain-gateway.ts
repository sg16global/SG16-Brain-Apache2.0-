// SG16 core brain gateway — server-side only.
//
// The browser never talks to the Python core directly. Every request flows:
//
//   ChatPanel (browser)
//     -> /api/brain            (Next.js route, same origin)
//       -> this module         (server runtime, nodejs)
//         -> SG16 core host    (POST /api/ingest through the master door)
//
// Security contract:
//   * the core URL comes ONLY from the SG16_BRAIN_URL environment variable,
//     never from request data, and is never sent back to the client;
//   * message size is capped before it leaves this process;
//   * session ids are sanitized to a conservative character set;
//   * every call is wrapped in a hard timeout so a stalled core can never
//     pin the Next.js runtime;
//   * no logging of message content.

export type BrainTransaction = {
  request_id: string;
  session_id: string;
  reply: string;
  canonical_key: string | null;
  stage: string;
  verdict?: { allowed?: boolean; score?: number; reasons?: string[] };
  seal?: string;
  owner?: boolean;
  premium?: boolean;
};

export type BrainHealth = {
  status?: string;
  sealed?: boolean;
  doors?: number;
  sessions?: number;
  charter_invariants?: number;
  knowledge_entries?: number;
  [key: string]: unknown;
};

export type BrainGatewayErrorKind = "unreachable" | "http-error" | "bad-payload";

export class BrainGatewayError extends Error {
  constructor(
    public kind: BrainGatewayErrorKind,
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "BrainGatewayError";
  }
}

// The core host defaults come from config/brain.json (0.0.0.0:8080). The
// gateway dials loopback unless the operator overrides it via the environment.
const DEFAULT_BRAIN_URL = "http://127.0.0.1:8080";
const DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_BRAIN_MESSAGE_CHARS = 8_000;

function brainBaseUrl(): string {
  const raw = process.env.SG16_BRAIN_URL?.trim() || DEFAULT_BRAIN_URL;
  return raw.replace(/\/+$/, "");
}

function brainTimeoutMs(): number {
  const parsed = Number(process.env.SG16_BRAIN_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed >= 1000 ? parsed : DEFAULT_TIMEOUT_MS;
}

export function sanitizeBrainSessionId(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64) || "default";
}

async function callBrain<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), brainTimeoutMs());
  try {
    const res = await fetch(`${brainBaseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
    const body = await res.text();
    if (!res.ok) {
      throw new BrainGatewayError(
        "http-error",
        `core answered ${res.status}${body ? `: ${body.slice(0, 240)}` : ""}`,
        res.status,
      );
    }
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new BrainGatewayError("bad-payload", "core returned non-JSON payload");
    }
  } catch (err) {
    if (err instanceof BrainGatewayError) throw err;
    const aborted = err instanceof Error && err.name === "AbortError";
    throw new BrainGatewayError(
      "unreachable",
      aborted ? "core timed out" : "core is unreachable",
    );
  } finally {
    clearTimeout(timer);
  }
}

/** One payload through the master door (POST /api/ingest). */
export async function brainChat(
  text: string,
  sessionId: string,
  passToken?: string | null,
): Promise<BrainTransaction> {
  return callBrain<BrainTransaction>("/api/ingest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(passToken ? { "X-SG16-Pass": passToken } : {}),
    },
    body: JSON.stringify({
      text,
      session_id: sanitizeBrainSessionId(sessionId),
    }),
  });
}

/** The core's safety-gate verdict for one payload (POST /api/introspect). */
export async function brainIntrospect(
  text: string,
): Promise<{ allowed: boolean; refusal?: string }> {
  const report = await callBrain<{ verdict?: { allowed?: boolean }; refusal?: string }>(
    "/api/introspect",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // lets the core exempt the platform from its per-client throttle (which
        // would otherwise be one bucket for every visitor, all seen as 127.0.0.1)
        ...(process.env.SG16_PROXY_AUTH_SECRET
          ? { "X-SG16-Proxy-Auth": process.env.SG16_PROXY_AUTH_SECRET }
          : {}),
      },
      body: JSON.stringify({ text }),
    },
  );
  if (typeof report.verdict?.allowed !== "boolean") {
    throw new BrainGatewayError("bad-payload", "core returned no gate verdict");
  }
  return { allowed: report.verdict.allowed, refusal: report.refusal };
}

/** Readiness probe against the core host (GET /api/health). */
export async function brainHealth(): Promise<BrainHealth> {
  return callBrain<BrainHealth>("/api/health", { method: "GET" });
}

/** Best-effort: tell the core to forget its in-memory session state. */
export async function brainForgetSession(sessionId: string): Promise<void> {
  try {
    await callBrain("/api/session/forget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sanitizeBrainSessionId(sessionId) }),
    });
  } catch {
    // Best-effort: bounded host session state still expires by LRU/restart.
  }
}

export type BrainBillingInfo = {
  currency?: string;
  humanitarian_region?: string;
  passes?: Record<string, { label: string; price: number; hours: number }>;
  owner_bypass?: string;
  gateway?: {
    provider?: string;
    model?: string;
    mode?: string;
    test_mode?: boolean;
    humanitarian_intercept?: string;
    storage?: string;
  };
};

export type BrainCheckoutResult =
  | { mode: "dodo"; session_id: string; checkout_url: string; pass: string }
  | { mode: "humanitarian_bypass"; record: Record<string, unknown> };

export async function brainVerifyPass(pass: string): Promise<{ valid: true; record: Record<string, unknown> }> {
  return callBrain("/api/pass/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // the platform calls this for every pass-bearing chat from 127.0.0.1: proving itself keeps
      // the core from counting all subscribers against one shared per-address bucket
      ...(process.env.SG16_PROXY_AUTH_SECRET ? { "X-SG16-Proxy-Auth": process.env.SG16_PROXY_AUTH_SECRET } : {}),
    },
    body: JSON.stringify({ pass }),
  });
}

export async function brainConfirmCheckout(sessionId: string): Promise<{
  confirmed: boolean;
  status?: string;
  record?: Record<string, unknown>;
}> {
  return callBrain("/api/dodo/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
}

/** Billing deck + gateway mode from the sovereign host (GET /api/billing). */
export async function brainGetBilling(): Promise<BrainBillingInfo> {
  return callBrain<BrainBillingInfo>("/api/billing", { method: "GET" });
}

/**
 * One pass through the checkout pipeline (POST /api/dodo/checkout).
 * The core itself decides the mode: live Dodo MoR session when credentials
 * exist, sovereign local issuance otherwise — and the humanitarian region
 * is intercepted before the gateway is ever contacted.
 */
export async function brainCheckout(payload: {
  pass: string;
  region?: string | null;
  provider?: string;
  return_url?: string;
  session_id?: string;
}): Promise<BrainCheckoutResult> {
  return callBrain<BrainCheckoutResult>("/api/dodo/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Where the gateway is currently pointing (reporting only). */
export function brainTargetSummary() {
  return {
    configured: Boolean(process.env.SG16_BRAIN_URL?.trim()),
    timeoutMs: brainTimeoutMs(),
    maxMessageChars: MAX_BRAIN_MESSAGE_CHARS,
  };
}
