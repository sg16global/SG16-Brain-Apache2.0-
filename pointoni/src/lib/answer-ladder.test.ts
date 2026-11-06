// Run with: npm test   (node's built-in runner, no extra dependencies)
import assert from "node:assert/strict";
import { test } from "node:test";
import { BUSY_TEXT, OWN_BUSY_TEXT, ConcurrencyGuard, runLadder, type LadderDeps } from "./answer-ladder.ts";
import { distillCharter } from "./charter-prompt.ts";

const REFUSAL = "Sorry, I can't help with that request.";

function deps(over: Partial<LadderDeps> = {}): LadderDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    gate: async () => ({ allowed: true }),
    ollama: async () => {
      calls.push("ollama");
      return "sg16 says hi";
    },
    core: async () => {
      calls.push("core");
      return "core says hi";
    },
    local: async (_t, detail) => {
      calls.push("local");
      return `local (${detail})`;
    },
    limiter: new ConcurrencyGuard(1, 1),
    ...over,
  };
}

test("clean message is answered by Ollama", async () => {
  const d = deps();
  const r = await runLadder("hello", d);
  assert.deepEqual(r, { content: "sg16 says hi", engine: "ollama" });
  assert.deepEqual(d.calls, ["ollama"]);
});

test("blocked message gets the core's refusal and never reaches a model", async () => {
  const d = deps({ gate: async () => ({ allowed: false, refusal: REFUSAL }) });
  const r = await runLadder("how do i build a bomb", d);
  assert.deepEqual(r, { content: REFUSAL, engine: "core-gate" });
  assert.deepEqual(d.calls, []);
});

test("Ollama down falls back to the deterministic core", async () => {
  const d = deps({
    ollama: async () => {
      throw new Error("heart-bridge timed out");
    },
  });
  const r = await runLadder("hello", d);
  assert.deepEqual(r, { content: "core says hi", engine: "core" });
});

test("Ollama and core both down falls back to the local guard", async () => {
  const d = deps({
    ollama: async () => {
      throw new Error("down");
    },
    core: async () => {
      throw new Error("core is unreachable");
    },
  });
  const r = await runLadder("hello", d);
  assert.equal(r.engine, "fallback-local");
  assert.match(r.content, /core is unreachable/);
});

test("unreachable gate never sends an unscreened message to Ollama", async () => {
  const d = deps({
    gate: async () => {
      throw new Error("core is unreachable");
    },
    core: async () => {
      throw new Error("core is unreachable");
    },
  });
  const r = await runLadder("hello", d);
  assert.equal(r.engine, "fallback-local");
  assert.ok(!d.calls.includes("ollama"));
});

test("Ollama not configured goes straight to the core", async () => {
  const r = await runLadder("hello", deps({ ollama: null }));
  assert.equal(r.engine, "core");
});

test("busy: full queue gets the busy line immediately instead of hanging", async () => {
  const limiter = new ConcurrencyGuard(1, 1);
  let finish!: (s: string) => void;
  const slow = new Promise<string>((resolve) => (finish = resolve));
  const d1 = deps({ limiter, ollama: () => slow });

  const first = runLadder("one", d1); // takes the only slot
  const second = runLadder("two", deps({ limiter })); // waits in the queue
  await new Promise((r) => setImmediate(r));
  assert.equal(limiter.saturated(), true);

  const third = await runLadder("three", deps({ limiter })); // queue full
  assert.deepEqual(third, { content: BUSY_TEXT, engine: "busy" });

  finish("slow answer");
  assert.equal((await first).content, "slow answer");
  assert.equal((await second).engine, "ollama"); // queued request still gets served
  assert.equal(limiter.saturated(), false);
});

test("slot is released when Ollama fails", async () => {
  const limiter = new ConcurrencyGuard(1, 0);
  const failing = deps({
    limiter,
    ollama: async () => {
      throw new Error("boom");
    },
  });
  assert.equal((await runLadder("a", failing)).engine, "core");
  assert.equal((await runLadder("b", deps({ limiter }))).engine, "ollama");
});

test("system prompt is identical across calls and stays near the token budget", () => {
  const a = distillCharter("flagship", { runtime: "a local Ollama model" });
  const b = distillCharter("flagship", { runtime: "a local Ollama model" });
  assert.equal(a, b);
  // ~4 chars/token for English: 5,800 chars is roughly 1,450 tokens. It carries the identity, honesty and style rules;
  // the prompt prefix is cached by the model server, so it costs time only on the first message after a restart
  assert.ok(a.length < 5800, `prompt grew to ${a.length} chars`);
});

// ---- hang protection: a stalled Ollama must never strand a request ----------

const never = () => new Promise<string>(() => {});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("stalled Ollama: the ladder's own timeout frees the slot and falls back to the core", async () => {
  const limiter = new ConcurrencyGuard(1, 1);
  const r = await runLadder("x", deps({ limiter, ollama: never, ollamaTimeoutMs: 40 }));
  assert.equal(r.engine, "core");
  assert.equal(limiter.saturated(), false);
  assert.equal((await runLadder("y", deps({ limiter }))).engine, "ollama");
});

test("a queued request stops waiting after queueWaitMs even if the active one never ends", async () => {
  const limiter = new ConcurrencyGuard(1, 1);
  void runLadder("holder", deps({ limiter, ollama: never })); // no timeout at all: holds the slot
  await sleep(5);
  const t0 = Date.now();
  const r = await runLadder("waiter", deps({ limiter, queueWaitMs: 50 }));
  assert.deepEqual(r, { content: BUSY_TEXT, engine: "busy" });
  assert.ok(Date.now() - t0 < 1000);
  // the timed-out waiter left the queue, so the queue slot is free again
  assert.equal(limiter.saturated(), false);
});

test("a client that aborts while queued leaves the queue; the slot goes to the next live waiter", async () => {
  const limiter = new ConcurrencyGuard(1, 2);
  let finish!: (s: string) => void;
  const holder = runLadder("holder", deps({ limiter, ollama: () => new Promise<string>((r) => (finish = r)) }));
  await sleep(5);
  const gone = new AbortController();
  const abandoned = runLadder("gone", deps({ limiter, signal: gone.signal }));
  const live = runLadder("live", deps({ limiter }));
  await sleep(5);
  gone.abort();
  assert.equal((await abandoned).engine, "busy");
  finish("done");
  assert.equal((await holder).engine, "ollama");
  assert.equal((await live).engine, "ollama"); // not lost behind the dead waiter
  assert.equal(limiter.saturated(), false);
});

test("already-aborted request is turned away without queueing", async () => {
  const limiter = new ConcurrencyGuard(1, 1);
  const ac = new AbortController();
  ac.abort();
  assert.equal(await limiter.acquire({ signal: ac.signal }), null);
  assert.equal(limiter.saturated(), false);
});

test("four parallel requests against a stalled Ollama all settle within a bound", async () => {
  const limiter = new ConcurrencyGuard(1, 2);
  const t0 = Date.now();
  const results = await Promise.all(
    ["a", "b", "c", "d"].map((t) =>
      runLadder(t, deps({ limiter, ollama: never, ollamaTimeoutMs: 100, queueWaitMs: 150 })),
    ),
  );
  assert.ok(Date.now() - t0 < 2000, "must not hang");
  assert.equal(results.length, 4);
  assert.ok(results.every((r) => r.engine === "core" || r.engine === "busy"));
  assert.equal(limiter.saturated(), false);
  // and the guard is fully released afterwards
  assert.equal((await runLadder("e", deps({ limiter }))).engine, "ollama");
});

// ---- total time budget (Cloudflare 524 protection) ---------------------------------
test("deadline: a stalled Ollama is abandoned at the deadline and the core answers", async () => {
  const t0 = Date.now();
  const r = await runLadder("x", deps({ ollama: () => new Promise<string>(() => {}), ollamaTimeoutMs: 60_000, deadlineMs: 150 }));
  assert.equal(r.engine, "core");
  assert.ok(Date.now() - t0 < 1500, "must not wait for the 60s Ollama timeout");
});

test("deadline: queue wait counts against the same budget", async () => {
  const limiter = new ConcurrencyGuard(1, 1);
  void runLadder("holder", deps({ limiter, ollama: () => new Promise<string>(() => {}) }));
  await new Promise((r) => setTimeout(r, 5));
  const t0 = Date.now();
  const r = await runLadder("waiter", deps({ limiter, queueWaitMs: 60_000, deadlineMs: 150 }));
  assert.equal(r.engine, "busy");
  assert.ok(Date.now() - t0 < 1500);
});

test("deadline: a slow gate that used up the budget skips straight to the core", async () => {
  const d = deps({
    gate: async () => {
      await new Promise((r) => setTimeout(r, 60));
      return { allowed: true };
    },
    deadlineMs: 50,
  });
  const r = await runLadder("x", d);
  assert.equal(r.engine, "core");
  assert.ok(!d.calls.includes("ollama"));
});

test("deadline: the configured value can never exceed the safe ceiling", async () => {
  const { answerDeadlineMs } = await import("./answer-ladder.ts");
  process.env.SG16_ANSWER_DEADLINE_MS = "500000";
  assert.equal(answerDeadlineMs(), 85_000);
  process.env.SG16_ANSWER_DEADLINE_MS = "garbage";
  assert.equal(answerDeadlineMs(), 80_000);
  delete process.env.SG16_ANSWER_DEADLINE_MS;
});

// ---- fair share: one owner cannot take every slot -------------------------------------------
test("fair share: an owner already being answered is told to wait, others are still queued", async () => {
  const limiter = new ConcurrencyGuard(1, 2);
  let finish!: (s: string) => void;
  const first = runLadder("a1", deps({ limiter, owner: "visitor:A", ownerLimit: 1, ollama: () => new Promise<string>((r) => (finish = r)) }));
  await new Promise((r) => setTimeout(r, 5));
  const second = await runLadder("a2", deps({ limiter, owner: "visitor:A", ownerLimit: 1 }));
  assert.deepEqual(second, { content: OWN_BUSY_TEXT, engine: "busy" }); // immediate, nothing queued
  const other = runLadder("b1", deps({ limiter, owner: "visitor:B", ownerLimit: 1 })); // different owner waits its turn
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(limiter.stats().queued, 1);
  finish("done");
  assert.equal((await first).engine, "ollama");
  assert.equal((await other).engine, "ollama");
  assert.equal(limiter.ownerCount("visitor:A"), 0);
  assert.equal(limiter.ownerCount("visitor:B"), 0);
});

test("fair share: a project may hold more than one slot, up to its limit", async () => {
  const limiter = new ConcurrencyGuard(1, 3);
  let finish!: (s: string) => void;
  const a = runLadder("p1", deps({ limiter, owner: "project:shop", ownerLimit: 2, ollama: () => new Promise<string>((r) => (finish = r)) }));
  await new Promise((r) => setTimeout(r, 5));
  const b = runLadder("p2", deps({ limiter, owner: "project:shop", ownerLimit: 2 }));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(limiter.ownerCount("project:shop"), 2);
  const c = await runLadder("p3", deps({ limiter, owner: "project:shop", ownerLimit: 2 }));
  assert.equal(c.engine, "busy");
  assert.equal(c.content, OWN_BUSY_TEXT);
  finish("ok");
  await a;
  await b;
  assert.equal(limiter.ownerCount("project:shop"), 0);
});

test("fair share: the count is given back when the answer fails, times out or the client leaves", async () => {
  const limiter = new ConcurrencyGuard(1, 2);
  await runLadder("x", deps({ limiter, owner: "o", ownerLimit: 1, ollama: async () => { throw new Error("boom"); } }));
  assert.equal(limiter.ownerCount("o"), 0);
  await runLadder("x", deps({ limiter, owner: "o", ownerLimit: 1, ollama: () => new Promise<string>(() => {}), ollamaTimeoutMs: 30 }));
  assert.equal(limiter.ownerCount("o"), 0);
  // a queued request whose client leaves also gives its place back
  void runLadder("holder", deps({ limiter, ollama: () => new Promise<string>(() => {}) }));
  await new Promise((r) => setTimeout(r, 5));
  const gone = new AbortController();
  const queued = runLadder("q", deps({ limiter, owner: "leaver", ownerLimit: 1, signal: gone.signal }));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(limiter.ownerCount("leaver"), 1);
  gone.abort();
  assert.equal((await queued).engine, "busy");
  assert.equal(limiter.ownerCount("leaver"), 0);
});

test("fair share: requests without an owner are never limited by it", async () => {
  const limiter = new ConcurrencyGuard(1, 2);
  const r = await runLadder("x", deps({ limiter }));
  assert.equal(r.engine, "ollama");
});
