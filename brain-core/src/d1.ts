// D1 logging — real events only. Written inside waitUntil; a logging
// failure must never fail a request. By default only digests are stored.
// Each function returns the write so waitUntil keeps the Worker alive until
// the row is stored (a dropped promise lets the runtime cancel the insert).

import type { AskMeta } from "./types.ts";

export interface RequestLog {
  keyId: string;
  userId: number;
  project: string;
  kind: string;
  engine: AskMeta["engine"] | "none";
  http: number;
  latencyMs: number;
  queueMs: number;
  verified: boolean;
  errCode?: string;
  script?: string | null;
}

export interface HistoryLog {
  keyId: string;
  project: string;
  requestDigest: string;
  responseDigest: string;
  engine: AskMeta["engine"];
  verified: boolean;
}

export interface LogDb {
  prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown> } };
}

export async function logRequest(db: LogDb, row: RequestLog, now: number): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO requests (ts, key_id, user_id, project, kind, engine, http, latency_ms, queue_ms, verified, err_code, script)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(now, row.keyId, row.userId, row.project, row.kind, row.engine, row.http,
           row.latencyMs, row.queueMs, row.verified ? 1 : 0, row.errCode ?? null, row.script ?? null).run();
  } catch {
    // never fail the request because of logging
  }
}

export async function logHistory(db: LogDb, row: HistoryLog, now: number): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO history (ts, key_id, project, request_digest, response_digest, engine, verified)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(now, row.keyId, row.project, row.requestDigest, row.responseDigest, row.engine, row.verified ? 1 : 0).run();
  } catch {
    // never fail the request because of logging
  }
}
