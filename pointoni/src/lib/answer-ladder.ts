// The answering ladder for self-hosted models, kept free of framework imports
// so it can be tested directly with `node --test`.
//
//   1. the core's safety gate screens the message (blocked -> core's refusal)
//   2. clean -> SG16 Brain (Q4_K_M) via the Ollama bridge, behind a concurrency guard
//   3. Ollama failed/timed out -> the deterministic core
//   4. core unreachable too -> the local guard engine
//
// If the gate itself cannot be reached, nothing is screened, so Ollama is
// skipped and the deterministic paths (which carry their own gate) answer.

import { sharedMetrics } from "./metrics.ts";

export type Engine =
  | "core-gate"
  | "ollama"
  | "core"
  | "fallback-local"
  | "busy"
  | "rate-limited";

export const BUSY_TEXT = "I'm helping someone else right now, please try again in a moment";
export const OWN_BUSY_TEXT = "I'm still answering your previous message, please wait for it to finish.";

// only used if an older core omits `refusal`; mirrors sg16/character.py REFUSAL_TEXT
const DEFAULT_REFUSAL =
  "Sorry, I can't help with that request. The safety checks flagged it as " +
  "potentially harmful, so I won't provide instructions for it. If you share " +
  "a safer goal, I'll try to help with that.";

export type GateVerdict = { allowed: boolean; refusal?: string };

export type LadderDeps = {
  /** core introspect/gate verdict; throws when the core is unreachable */
  gate: (text: string) => Promise<GateVerdict>;
  /** Ollama answer, or null when the bridge is not enabled; throws on failure */
  ollama: ((text: string) => Promise<string>) | null;
  /** deterministic core answer; throws when the core is unreachable */
  core: (text: string) => Promise<string>;
  /** local guard engine; never throws */
  local: (text: string, detail: string) => Promise<string>;
  limiter: ConcurrencyGuard;
  /** longest a request may wait in the queue before it is told "busy" */
  queueWaitMs?: number;
  /** hard cap on one Ollama answer, enforced here even if the bridge stalls */
  ollamaTimeoutMs?: number;
  /**
   * Latest moment (ms after the request started) at which the Ollama phase must be over.
   * Behind Cloudflare a request with no response for ~100s becomes a 524 error page, so
   * the gate + queue + Ollama time is capped here and the fast deterministic core takes
   * over instead. Applies on top of queueWaitMs and ollamaTimeoutMs, whichever is shorter.
   */
  deadlineMs?: number;
  /** fires when the client goes away; a queued request then leaves the queue */
  signal?: AbortSignal;
  /**
   * Fair share: who is asking (a visitor key or a project) and how many answers that owner may have
   * running or waiting at once. One noisy project or visitor then cannot take every slot.
   */
  owner?: string;
  ownerLimit?: number;
};

export type LadderResult = { content: string; engine: Engine };

type Waiter = { wake: () => void };

export class ConcurrencyGuard {
  private active = 0;
  private waiting: Waiter[] = [];
  private perOwner = new Map<string, number>(); // answers running or waiting, per owner

  private maxActive: number;
  private maxQueue: number;

  constructor(maxActive = 1, maxQueue = 2) {
    this.maxActive = maxActive;
    this.maxQueue = maxQueue;
  }

  /** current load, for the anonymous counters */
  stats(): { active: number; queued: number } {
    return { active: this.active, queued: this.waiting.length };
  }

  /** how many answers this owner has running or waiting */
  ownerCount(owner: string): number {
    return this.perOwner.get(owner) ?? 0;
  }

  /** true when a new request would be turned away immediately */
  saturated(): boolean {
    return this.active >= this.maxActive && this.waiting.length >= this.maxQueue;
  }

  /**
   * Resolves to a release function, or null when the queue is full, the wait
   * outlasts `timeoutMs`, or `signal` aborts. A waiter that gives up removes
   * itself from the queue, so a later release never hands the slot to nobody.
   */
  async acquire(opts: { timeoutMs?: number; signal?: AbortSignal; owner?: string } = {}): Promise<(() => void) | null> {
    if (opts.signal?.aborted) return null;
    const owner = opts.owner;
    if (this.active < this.maxActive) {
      this.active++;
      this.count(owner, 1);
      return this.releaser(owner);
    }
    if (this.waiting.length >= this.maxQueue) return null;
    this.count(owner, 1);
    // the slot is handed over directly by release(), so `active` stays put
    const granted = await new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waiter: Waiter = {
        wake: () => {
          cleanup();
          resolve(true);
        },
      };
      // only effective while still queued: release() removes the waiter before waking it
      const giveUp = () => {
        const i = this.waiting.indexOf(waiter);
        if (i === -1) return;
        this.waiting.splice(i, 1);
        this.count(owner, -1);
        cleanup();
        resolve(false);
      };
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        opts.signal?.removeEventListener("abort", giveUp);
      };
      this.waiting.push(waiter);
      if (opts.timeoutMs !== undefined) timer = setTimeout(giveUp, opts.timeoutMs);
      opts.signal?.addEventListener("abort", giveUp, { once: true });
    });
    return granted ? this.releaser(owner) : null;
  }

  private count(owner: string | undefined, delta: number): void {
    if (!owner) return;
    const next = (this.perOwner.get(owner) ?? 0) + delta;
    if (next <= 0) this.perOwner.delete(owner);
    else this.perOwner.set(owner, next);
  }

  private releaser(owner?: string): () => void {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.count(owner, -1);
      const next = this.waiting.shift();
      if (next) next.wake();
      else this.active--;
    };
  }
}

function withTimeout<T>(work: Promise<T>, ms: number | undefined): Promise<T> {
  if (ms === undefined) return work;
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("answer timed out")), ms);
  });
  // an abandoned `work` must not surface as an unhandled rejection later
  work.catch(() => undefined);
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

export async function runLadder(text: string, deps: LadderDeps): Promise<LadderResult> {
  const startedAt = Date.now();
  const remaining = () => (deps.deadlineMs === undefined ? Infinity : deps.deadlineMs - (Date.now() - startedAt));
  const within = (limit: number | undefined) => {
    const left = remaining();
    return limit === undefined ? (left === Infinity ? undefined : left) : Math.min(limit, left);
  };
  let gateDetail = "";
  let gateUp = true;
  try {
    const verdict = await deps.gate(text);
    if (!verdict.allowed) {
      return {
        content: verdict.refusal || DEFAULT_REFUSAL,
        engine: "core-gate",
      };
    }
  } catch (err) {
    gateUp = false;
    gateDetail = err instanceof Error ? err.message : "core link down";
  }

  // no time left for a model answer (slow gate): go straight to the fast core
  if (gateUp && deps.ollama && remaining() > Math.min(1000, (deps.deadlineMs ?? 0) / 4)) {
    if (deps.owner && deps.limiter.ownerCount(deps.owner) >= (deps.ownerLimit ?? Infinity)) {
      return { content: OWN_BUSY_TEXT, engine: "busy" };
    }
    const release = await deps.limiter.acquire({ timeoutMs: within(deps.queueWaitMs), signal: deps.signal, owner: deps.owner });
    if (!release) return { content: BUSY_TEXT, engine: "busy" };
    try {
      const answer = await withTimeout(deps.ollama(text), within(deps.ollamaTimeoutMs));
      return { content: answer, engine: "ollama" };
    } catch {
      // fall through to the deterministic core
    } finally {
      release();
    }
  }

  try {
    return { content: await deps.core(text), engine: "core" };
  } catch (err) {
    const detail = gateDetail || (err instanceof Error ? err.message : "core link down");
    return { content: await deps.local(text, detail), engine: "fallback-local" };
  }
}

// Process-wide state, held on globalThis so the chat route and /api/health see
// the same values even if the bundler gives each route its own module copy.
type Shared = {
  limiter: ConcurrencyGuard;
  last: { engine: Engine; at: string } | null;
};
const KEY = Symbol.for("sg16.answerLadder");
function shared(): Shared {
  const g = globalThis as unknown as Record<symbol, Shared | undefined>;
  return (g[KEY] ??= {
    limiter: new ConcurrencyGuard(
      Math.max(1, Number(process.env.SG16_ANSWER_CONCURRENCY) || 1),
      Math.max(0, Number(process.env.SG16_ANSWER_QUEUE ?? 2) || 0),
    ),
    last: null,
  });
}

/**
 * Cloudflare answers 524 when the origin is silent for ~100s. The core fallback needs up to
 * ~15s after this, so the model phase must end well before that.
 */
export const answerDeadlineMs = (): number => {
  const n = Number(process.env.SG16_ANSWER_DEADLINE_MS);
  return Number.isFinite(n) && n >= 5000 ? Math.min(n, 85_000) : 80_000;
};

/** longest a queued request waits for the single answer slot */
export const queueWaitMs = (): number => {
  const n = Number(process.env.SG16_ANSWER_QUEUE_WAIT_MS);
  return Number.isFinite(n) && n >= 1000 ? n : 60_000;
};

export const sharedLimiter = (): ConcurrencyGuard => shared().limiter;
/** `ms` only when the request spent real time being answered. */
export const recordAnswer = (engine: Engine, ms?: number): void => {
  sharedMetrics().record(engine, ms);
  // a rate-limited request was not answered by anything
  if (engine !== "rate-limited") shared().last = { engine, at: new Date().toISOString() };
};
export const answerMetrics = () => sharedMetrics().snapshot(shared().limiter.stats());
export const lastAnswer = (): { engine: Engine; at: string } | null => shared().last;
