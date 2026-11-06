import type { aiModels } from "@/db/schema";

export type AiModel = typeof aiModels.$inferSelect;

export type ChatMessageDto = {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  modelId: string;
  relay: boolean;
  latencyMs: number;
  createdAt: string;
};
