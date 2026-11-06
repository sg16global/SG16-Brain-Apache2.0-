// Sovereign local persistence — the platform boots with zero external
// services, true to the SG16 "self-contained, air-gapped" ethos.
//
// When DATABASE_URL is set, src/db/index.ts uses a real PostgreSQL pool and
// this module is never touched. When it is absent, we boot an in-memory
// PostgreSQL (pg-mem), apply the exact drizzle-kit migrations from ./drizzle,
// and hand back a pg.Pool-compatible facade, so every route and page keeps
// issuing the same drizzle queries unchanged.

import { newDb, DataType } from "pg-mem";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Pool, PoolClient, QueryConfig, QueryResult } from "pg";

type MemPool = {
  query: (query: unknown, values?: unknown, cb?: unknown) => unknown;
  connect: (...args: unknown[]) => Promise<PoolClient>;
  end: (...args: unknown[]) => Promise<void>;
};

function migrationStatements(): string[] {
  const dir = path.join(process.cwd(), "drizzle");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    throw new Error(`no drizzle migrations found in ${dir}`);
  }
  return files.flatMap((file) =>
    readFileSync(path.join(dir, file), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function createSovereignLocalPool(): Pool {
  const mem = newDb({ autoCreateForeignKeyIndices: true });

  // drizzle emits DEFAULT gen_random_uuid() for uuid PKs; pg-mem does not
  // ship pgcrypto, so register an equivalent generator before applying DDL.
  try {
    mem.public.registerFunction({
      name: "gen_random_uuid",
      returns: DataType.uuid,
      implementation: () => randomUUID(),
      impure: true,
    });
  } catch {
    // generator already present in this pg-mem build — keep it
  }

  for (const statement of migrationStatements()) {
    mem.public.none(statement);
  }

  // drizzle's node-postgres driver always queries with
  // { text, values, rowMode: "array", types: { getTypeParser } }.
  // pg-mem supports neither rowMode nor custom type parsers, so we teach
  // its Pool exactly those two behaviors: array rows are projected onto the
  // declared field order (what node-postgres returns for rowMode "array"),
  // and the types config is dropped before delegating.
  type PgMemPoolCtor = new () => MemPool & {
    adaptResults(query: unknown, res: QueryResult): QueryResult;
  };
  class CompatPool extends (mem.adapters.createPg().Pool as unknown as PgMemPoolCtor) {
    override adaptResults(query: unknown, res: QueryResult): QueryResult {
      if (
        query &&
        typeof query === "object" &&
        (query as { rowMode?: string }).rowMode === "array"
      ) {
        return {
          ...res,
          rows: res.rows.map((row: Record<string, unknown>) =>
            res.fields.map((f) => row[f.name]),
          ),
        };
      }
      return super.adaptResults(query, res);
    }
  }
  // Note: no adapter arguments are required — the generated Pool class closes
  // over this memory database instance.
  const raw = new CompatPool();

  const facade = {
    query: (config: QueryConfig | string, values?: unknown[], cb?: unknown) => {
      let q = config;
      if (q && typeof q === "object" && "types" in q) {
        q = { ...(q as QueryConfig), types: undefined };
      }
      return raw.query(q, values, cb);
    },
    connect: (...args: unknown[]) => raw.connect(...args),
    end: (...args: unknown[]) => raw.end(...args),
    on: () => facade,
  };

  console.info(
    "[sg16-db] DATABASE_URL not set — sovereign local PostgreSQL (in-memory) online; drizzle migrations applied",
  );
  return facade as unknown as Pool;
}
