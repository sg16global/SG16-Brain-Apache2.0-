// The system prompt — deliberately language-neutral.
//
// No language, country, script or transliteration habit is named here, and no
// language-specific routing exists anywhere in the core. The model receives
// one universal rule — same language as the user — plus the detected script,
// derived generically from Unicode (any script, no special cases).

import type { DetectResult } from "./detect.ts";

export function systemPrompt(detect: DetectResult): string {
  // Warm, natural chat (owner request 2026-10-22): the earlier wording made the
  // small chat model refuse friendly small talk ("you don't like fun?" ->
  // "I'm unable to understand your request"). Honesty rules are unchanged.
  const base = [
    "You are SG16 Brain, a friendly AI assistant made by Saif Tech Global.",
    "Talk like a warm, relaxed friend: natural, short and human. Keep casual replies to one to three sentences and use emojis rarely.",
    "Always reply in the same language the user writes in.",
    "If the user mixes languages, reply in the language that dominates the message.",
    "Small talk, jokes, nicknames and casual questions are welcome: play along kindly and keep the chat flowing.",
    "Only refuse something that is truly harmful; never refuse friendly chat.",
    "Your name is SG16 Brain. When asked who you are, say only that; never compare yourself with movies, characters or other AI products.",
    "Be honest: if you do not know a fact, say so plainly. Never invent facts, names, dates or numbers.",
    "Compute arithmetic; do not recall it.",
    "For questions and tasks, answer directly and clearly.",
  ];
  if (detect.script && detect.confidence >= 0.3 && detect.totalLetters >= 2) {
    base.push(`The user's message is written in the ${detect.script} script. Reply in that same language.`);
  }
  return base.join(" ");
}

// API projects (owner decision 2026-10-19): another project connecting with
// its key gets the brain clean — none of SG16's own rules above. Only the
// project's own rules (its `system`), its history and its message go to the
// model, exactly as sent.
export function apiMessages(system: string | undefined, history: readonly ChatTurn[] | undefined, userText: string): ChatTurn[] {
  const messages: ChatTurn[] = [];
  if (system) messages.push({ role: "system", content: system });
  for (const turn of history ?? []) messages.push(turn);
  messages.push({ role: "user", content: userText });
  return messages;
}

export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export function messagesFor(prompt: string, userText: string, history: readonly ChatTurn[] = []): ChatTurn[] {
  const messages: ChatTurn[] = [{ role: "system", content: prompt }];
  for (const turn of history.slice(-8)) messages.push(turn);
  messages.push({ role: "user", content: userText });
  return messages;
}

// The self-check pass — the brain re-reads its own draft and corrects it
// before the user sees anything. Language-neutral like every prompt here:
// the checker recomputes arithmetic and checks facts and logic, and it
// answers in the draft's own language.

export function checkerPrompt(): string {
  return [
    "You are a strict verifier. You receive one question and one draft answer.",
    "Recompute every arithmetic step from scratch. Check the facts you can check and the logic from end to end.",
    "If the draft answer is fully correct, reply with exactly: OK",
    "If anything in the draft answer is wrong, incomplete or misleading, reply with only the corrected full answer — no explanations, no commentary, no greetings.",
    "Reply in the same language as the draft answer.",
  ].join(" ");
}

export function checkMessages(question: string, draft: string): ChatTurn[] {
  return [
    { role: "system", content: checkerPrompt() },
    { role: "user", content: "Question:\n" + question + "\n\nDraft answer:\n" + draft },
  ];
}
