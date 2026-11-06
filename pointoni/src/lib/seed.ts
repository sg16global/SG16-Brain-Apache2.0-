import { db } from "@/db";
import { aiModels } from "@/db/schema";
import { eq } from "drizzle-orm";

// The only model on this platform. Status and latency are NOT stored here: they are
// measured live (see /api/models), so nothing in this row can go stale or be invented.
const SG16_MODEL = {
  id: "sg16-brain",
  name: "SG16 Brain",
  vendor: "Sovereign Systems",
  role: "Open, independent and friendly to everyone",
  description:
    "Every message is screened by the SG16 safety gate, then answered by the Brain's own language model on the operator's own server.",
  glyph: "brain",
  accent: "#22e08c",
  status: "configured",
  latencyMs: 0,
  contextWindow: "8K chars",
  selfHosted: true,
  capabilities: ["Safety gate", "Any language", "Private by design"],
  sortOrder: 0,
};

let seedingPromise: Promise<void> | null = null;

export async function ensureSeeded(): Promise<void> {
  if (seedingPromise) return seedingPromise;
  seedingPromise = (async () => {
    // Chat sessions reference this row, so it must exist. Older databases may still hold
    // rows for other models; they are left alone but never offered or used (see /api/models).
    const sg16 = await db.select({ id: aiModels.id }).from(aiModels).where(eq(aiModels.id, SG16_MODEL.id)).limit(1);
    if (sg16.length === 0) {
      await db.insert(aiModels).values(SG16_MODEL);
    }
  })();
  try {
    await seedingPromise;
  } finally {
    seedingPromise = null;
  }
}
