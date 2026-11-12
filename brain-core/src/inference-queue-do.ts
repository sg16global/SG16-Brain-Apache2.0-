// Durable Object wrapper around InferenceGate — the Worker reaches it as
// QUEUE.idFromName("global"), so the single inference slot is shared by every
// project and user. The DO keeps no user content; only tickets and deadlines.
//
// It also holds the operator's BRAIN POWER switch (owner request 2026-11-06):
// every model call passes /acquire, so "off" here stops the brain everywhere
// at once. The switch is kept in Durable Object storage, so it survives
// restarts and deploys; absent = on.

import { InferenceGate, DEFAULT_QUEUE_CONFIG } from "./inference-gate.ts";

interface DoEnv {
  // bindings for this DO class (none needed; state lives in the gate)
}

export class InferenceQueueDO {
  private gate = new InferenceGate(DEFAULT_QUEUE_CONFIG);
  private power = true;
  private state: DurableObjectState;

  constructor(state: DurableObjectState, _env: DoEnv) {
    this.state = state;
    state.blockConcurrencyWhile(async () => {
      this.power = (await state.storage.get<boolean>("power")) !== false;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    if (request.method === "GET" && path === "/power") {
      return json({ on: this.power });
    }
    if (request.method === "POST" && path === "/power") {
      const { on } = await request.json().catch(() => ({ on: undefined })) as { on?: unknown };
      if (typeof on !== "boolean") return json({ ok: false, code: "E_BAD_REQUEST" }, 400);
      this.power = on;
      await this.state.storage.put("power", on);
      return json({ on: this.power });
    }
    if (request.method === "POST" && path === "/acquire") {
      // brain switched off by the operator: nobody gets a slot
      if (!this.power) return json({ granted: false, off: true });
      const { waitBudgetMs, priority } = await request.json().catch(() => ({ waitBudgetMs: undefined })) as { waitBudgetMs?: number; priority?: unknown };
      return json(this.gate.acquire(waitBudgetMs, priority === true));
    }
    if (request.method === "POST" && path === "/poll") {
      const { ticket } = await request.json().catch(() => ({ ticket: 0 })) as { ticket: number };
      return json(this.gate.poll(ticket));
    }
    if (request.method === "POST" && path === "/release") {
      const { ticket } = await request.json().catch(() => ({ ticket: 0 })) as { ticket: number };
      return json({ released: this.gate.release(ticket) });
    }
    if (request.method === "POST" && path === "/abandon") {
      const { ticket } = await request.json().catch(() => ({ ticket: 0 })) as { ticket: number };
      this.gate.abandon(ticket);
      return json({ abandoned: true });
    }
    if (request.method === "GET" && path === "/stats") {
      return json(this.gate.stats());
    }
    return json({ ok: false, code: "E_NOT_FOUND" }, 404);
  }
}
