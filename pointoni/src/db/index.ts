import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createSovereignLocalPool } from "./local";

const databaseUrl = process.env.DATABASE_URL;

// Two persistence modes, one drizzle surface:
//   postgresql      -> DATABASE_URL is set (production path, unchanged)
//   sovereign-local -> no DATABASE_URL: an in-memory PostgreSQL boots inside
//                      this process so the full stack runs air-gapped with
//                      zero external services.
export const persistenceMode: "postgresql" | "sovereign-local" = databaseUrl
  ? "postgresql"
  : "sovereign-local";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  (databaseUrl
    ? new Pool({
        connectionString: databaseUrl,
      })
    : createSovereignLocalPool());

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
