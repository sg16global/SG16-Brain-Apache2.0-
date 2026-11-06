// The living matrix — per-key state held in a Durable Object (SQLite-backed).
//
// Deterministic counters and scores only; nothing about content. The rate
// limit is computed here so every consumer, including the owner (user #1),
// passes the same gate. Keys partition into shards by key record id; a shard
// handles its own transactions, so there is no cross-key contention.

import { balanceOf } from "./tokens.ts";

export interface RateVerdict {
  allowed: boolean;
  remaining: number;
  reset_in_ms: number;
}

export interface MatrixRow {
  key_id: string;
  project: string;
  window_start: number;   // unix ms of the current minute window
  count: number;          // requests in the window
  total: number;          // lifetime requests
  score: number;          // deterministic integer score owned by the core
  tokens_used?: number;   // free-tier model tokens spent (tokens.ts); absent on older rows = 0
}

const WINDOW_MS = 60_000;

export class KeyState {
  row: MatrixRow;
  constructor(row: MatrixRow) { this.row = row; }

  /** Deterministic rate limit: fixed minute windows, no floating state. */
  check(now: number, rpm: number): RateVerdict {
    if (now - this.row.window_start >= WINDOW_MS) {
      this.row.window_start = now;
      this.row.count = 0;
    }
    if (this.row.count >= rpm) {
      return { allowed: false, remaining: 0, reset_in_ms: this.row.window_start + WINDOW_MS - now };
    }
    return { allowed: true, remaining: rpm - this.row.count - 1, reset_in_ms: this.row.window_start + WINDOW_MS - now };
  }

  consume(now: number): void {
    this.row.count += 1;
    this.row.total += 1;
  }

  /** State matrix transition — the only scoring the core performs on activity. */
  step(delta: number): number {
    // bounded deterministic walk in integers; state never depends on the model
    const next = Math.max(-1_000_000, Math.min(1_000_000, this.row.score + Math.trunc(delta)));
    this.row.score = next;
    return next;
  }
}

export function newRow(key_id: string, project: string, now: number): MatrixRow {
  return {
    key_id,
    project,
    window_start: Math.floor(now / WINDOW_MS) * WINDOW_MS,
    count: 0,
    total: 0,
    score: 0,
    tokens_used: 0,
  };
}

interface DoEnv {
  // no bindings required for this DO class
}

export class MatrixDO {
  private rows: Record<string, MatrixRow> = {};
  private storage: DurableObjectStorage;

  constructor(state: DurableObjectState, _env: DoEnv) {
    this.storage = state.storage;
    state.blockConcurrencyWhile(async () => {
      const stored = (await state.storage.get<MatrixRow[]>("rows")) ?? [];
      for (const row of stored) this.rows[row.key_id] = row;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    if (request.method === "POST" && path === "/check") {
      const { key_id, project, rpm, now } = await request.json() as {
        key_id: string; project: string; rpm: number; now: number;
      };
      const ks = new KeyState(this.ensure(key_id, project, now));
      const verdict = ks.check(now, rpm);
      if (verdict.allowed) ks.consume(now);
      await this.storage.put("rows", Object.values(this.rows));
      return json(verdict);
    }

    if (request.method === "POST" && path === "/step") {
      const { key_id, project, delta, now } = await request.json() as {
        key_id: string; project: string; delta: number; now: number;
      };
      const ks = new KeyState(this.ensure(key_id, project, now));
      const score = ks.step(delta);
      await this.storage.put("rows", Object.values(this.rows));
      return json({ score });
    }

    // free-tier token ledger (tokens.ts): read the balance, or charge one answer
    if (request.method === "POST" && (path === "/tokens/balance" || path === "/tokens/spend")) {
      const { key_id, project, allowance, tokens, now } = await request.json() as {
        key_id: string; project: string; allowance: number; tokens?: number; now: number;
      };
      const row = this.ensure(key_id, project, now);
      if (path === "/tokens/spend") {
        const charge = Math.max(0, Math.trunc(Number(tokens)) || 0);
        row.tokens_used = (row.tokens_used ?? 0) + charge;
        await this.storage.put("rows", Object.values(this.rows));
      }
      return json(balanceOf(row.tokens_used ?? 0, Math.max(0, Math.trunc(Number(allowance)) || 0)));
    }

    if (request.method === "GET" && path === "/state") {
      const key = url.searchParams.get("key_id");
      if (key && this.rows[key]) return json(this.rows[key]);
      return json(this.rows);
    }

    return json({ ok: false, code: "E_NOT_FOUND" }, 404);
  }

  private ensure(key_id: string, project: string, now: number): MatrixRow {
    if (!this.rows[key_id]) this.rows[key_id] = newRow(key_id, project, now);
    return this.rows[key_id];
  }
}
