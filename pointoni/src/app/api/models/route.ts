import { NextResponse } from "next/server";
import { db } from "@/db";
import { aiModels } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureSeeded } from "@/lib/seed";
import { brainHealth } from "@/lib/brain-gateway";
import { ollamaEnabled, ollamaHealth } from "@/lib/ollama-brain";
import { answerMetrics } from "@/lib/answer-ladder";
import { isAdminRequest } from "@/lib/admin-gate";

export const dynamic = "force-dynamic";

// GET /api/models - what this platform can really do right now.
// One model (the SG16 brain). Its status comes from probing the core and the Ollama
// daemon at request time, and its latency is the measured average of answers actually
// given (null until there is one). The engines list names what is installed in Ollama.
export async function GET(req: Request) {
  await ensureSeeded();
  const [row] = await db.select().from(aiModels).where(eq(aiModels.id, "sg16-brain")).limit(1);

  const [core, heart] = await Promise.all([
    brainHealth().then(() => true).catch(() => false),
    ollamaHealth(),
  ]);
  const heartUp = ollamaEnabled() && heart.status === "online";
  const status = core && heartUp ? "online" : core ? "core-only" : heartUp ? "degraded" : "offline";
  const metrics = answerMetrics();

  return NextResponse.json({
    models: [
      {
        id: row?.id ?? "sg16-brain",
        name: row?.name ?? "SG16 Brain",
        vendor: row?.vendor ?? "Sovereign Systems",
        role: row?.role ?? "Open, independent and friendly to everyone",
        description: row?.description ?? "",
        glyph: row?.glyph ?? "brain",
        accent: row?.accent ?? "#22e08c",
        status,
        latencyMs: metrics.avgMs,
        contextWindow: row?.contextWindow ?? "8K chars",
        selfHosted: true,
        capabilities: row?.capabilities ?? [],
        sortOrder: 0,
      },
    ],
    // which engines sit behind it, and what Ollama has installed, is for the operator only
    ...((await isAdminRequest(req))
      ? {
          engines: [
            { id: "gate+core", status: core ? "online" : "offline" },
            {
              id: "ollama",
              status: heartUp ? "online" : "offline",
              model: heart.model,
              installed: heart.models ?? [],
              detail: heart.detail,
            },
          ],
        }
      : {}),
    serverTime: new Date().toISOString(),
  });
}
