import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

// GET /api/live — the cheap liveness probe for the watchdog (scripts/healthcheck.sh).
// Unlike /api/health it never calls the core or Ollama, so it answers in
// milliseconds even when those are slow or down: "is THIS process alive and can
// it reach its database?". It returns no details and holds no per-request state.
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
