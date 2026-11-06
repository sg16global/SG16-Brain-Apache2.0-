// What the PUBLIC sees about which engine answered. The inner engines (the language model, the
// deterministic core, the local guard) are an internal matter: to a visitor they are all "sg16".
// Outcomes that are about the visitor's own request (refused by the gate, busy, rate-limited) are still named,
// since they explain why they got that reply. Trusted
// infrastructure (our own scripts via the proxy secret, project keys) gets the exact engine.

const INNER = new Set(["ollama", "core", "fallback-local"]);

export function publicEngine(engine: string): string {
  return INNER.has(engine) ? "sg16" : engine;
}
