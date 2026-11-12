import { test } from "node:test";
import assert from "node:assert/strict";
import { InferenceGate } from "../src/inference-gate.ts";
import { KeyState, newRow } from "../src/matrix-do.ts";

test("one slot: second caller queues, FIFO after release", () => {
  let now = 1000;
  const gate = new InferenceGate({ waitBudgetMs: 10000, leaseMs: 90000 }, () => now);

  const a = gate.acquire();
  assert.ok(a.granted);
  const b = gate.acquire();
  assert.ok(!b.granted && b.position === 1);
  const c = gate.acquire();
  assert.ok(!c.granted && c.position === 2);

  assert.equal(gate.release(a.ticket), true);
  now += 1;
  const bPoll = gate.poll(b.ticket);
  assert.ok(bPoll.granted);                 // FIFO: b before c
  assert.ok(!gate.poll(c.ticket).granted);

  assert.equal(gate.release(b.ticket), true);
  assert.ok(gate.poll(c.ticket).granted);
});

test("release is idempotent for a wrong ticket", () => {
  const gate = new InferenceGate();
  const a = gate.acquire();
  assert.equal(gate.release(a.ticket + 999), false);
  assert.equal(gate.release(a.ticket), true);
  assert.ok(gate.acquire().granted);
});

test("an expired lease reclaims the abandoned slot", () => {
  let now = 1000;
  const gate = new InferenceGate({ waitBudgetMs: 10000, leaseMs: 5000 }, () => now);
  const a = gate.acquire();
  const b = gate.acquire();
  assert.ok(a.granted && !b.granted);
  now += 6000;                                    // caller crashed, never released
  const c = gate.acquire();
  assert.ok(!c.granted, "the waiting caller is ahead of a newcomer");
  assert.ok(gate.poll(b.ticket).granted, "lease expiry must reclaim the slot for the head of the queue");
  const d = new InferenceGate({ waitBudgetMs: 10000, leaseMs: 5000 }, () => now);
  d.acquire();
  now += 6000;
  assert.ok(d.acquire().granted, "with nobody waiting, lease expiry hands the slot to the next caller");
});

test("lease outlasts the longest legitimate hold (draft + retry + self-check at the configured timeout)", async () => {
  const { DEFAULT_QUEUE_CONFIG } = await import("../src/inference-gate.ts");
  const { readFileSync } = await import("node:fs");
  const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const timeout = Number(/"INFERENCE_TIMEOUT_MS"\s*:\s*"(\d+)"/.exec(config)?.[1]);
  assert.ok(timeout > 0, "INFERENCE_TIMEOUT_MS is set in wrangler.jsonc");
  assert.ok(DEFAULT_QUEUE_CONFIG.leaseMs > 3 * timeout, `3 model calls x ${timeout} ms must fit inside the ${DEFAULT_QUEUE_CONFIG.leaseMs} ms lease`);
});

test("a newcomer cannot jump the queue in the gap between release and the head's poll", () => {
  let now = 1000;
  const gate = new InferenceGate({ waitBudgetMs: 10000, leaseMs: 90000, staleMs: 10000 }, () => now);
  const a = gate.acquire();
  const b = gate.acquire();
  assert.ok(a.granted && !b.granted);
  gate.release(a.ticket);
  const c = gate.acquire();                        // arrives before b polls
  assert.ok(!c.granted);
  assert.ok(gate.poll(b.ticket).granted, "b was first");
});

test("a waiter that stopped polling (client gone) no longer blocks the queue", () => {
  let now = 1000;
  const gate = new InferenceGate({ waitBudgetMs: 60000, leaseMs: 90000, staleMs: 10000 }, () => now);
  const a = gate.acquire();
  const ghost = gate.acquire();                    // will never poll again
  const c = gate.acquire();
  assert.ok(a.granted && !ghost.granted && !c.granted);
  for (let i = 0; i < 5; i++) { now += 2000; assert.ok(!gate.poll(c.ticket).granted); }
  gate.release(a.ticket);
  now += 2000;                                     // ghost silent for 12s > staleMs
  assert.ok(gate.poll(c.ticket).granted, "the live waiter gets the slot, not the vanished one");
});

test("waiting tickets past their deadline are dropped", () => {
  let now = 1000;
  const gate = new InferenceGate({ waitBudgetMs: 100, leaseMs: 90000 }, () => now);
  gate.acquire();                                  // slot taken
  const b = gate.acquire(50);                       // waits 50ms
  now += 60;
  const poll = gate.poll(b.ticket);
  assert.ok(!poll.granted && poll.expired);
});

test("priority: pass holders and API projects wait ahead of free chats, first come first served within each group", () => {
  let now = 1000;
  const gate = new InferenceGate({ waitBudgetMs: 60000, leaseMs: 90000, staleMs: 10000 }, () => now);
  const running = gate.acquire();                  // a free chat holds the slot
  const free1 = gate.acquire(undefined, false);
  const free2 = gate.acquire(undefined, false);
  const paid1 = gate.acquire(undefined, true);
  const paid2 = gate.acquire(undefined, true);
  assert.ok(running.granted && !free1.granted && !paid1.granted && !paid2.granted);
  assert.equal(!paid1.granted && paid1.position, 1, "the first paid waiter goes to the front");
  assert.equal(!paid2.granted && paid2.position, 2, "the second paid waiter queues behind the first");
  const order: number[] = [];
  let holder = running.ticket;
  for (let round = 0; round < 4; round++) {
    gate.release(holder);
    now += 200;
    for (const t of [free1, free2, paid1, paid2]) {
      if (!order.includes(t.ticket) && gate.poll(t.ticket).granted) { order.push(t.ticket); holder = t.ticket; break; }
    }
  }
  assert.deepEqual(order, [paid1.ticket, paid2.ticket, free1.ticket, free2.ticket]);
});

test("priority: a paid newcomer never takes a slot that is already running", () => {
  const gate = new InferenceGate({ waitBudgetMs: 60000, leaseMs: 90000 });
  const running = gate.acquire(undefined, false);
  const paid = gate.acquire(undefined, true);
  assert.ok(running.granted && !paid.granted, "it waits for the running chat to finish");
});

test("rate limit: fixed minute window, deterministic", () => {
  const row = newRow("k_1", "platform", 1000);
  const ks = new KeyState(row);
  assert.ok(ks.check(1000, 2).allowed);
  ks.consume(1000);
  assert.ok(ks.check(1001, 2).allowed);
  ks.consume(1001);
  assert.equal(ks.check(1002, 2).allowed, false);       // third in the same minute
  assert.ok(ks.check(61000, 2).allowed, "new window resets the counter");
});

test("score step clamps deterministically", () => {
  const ks = new KeyState(newRow("k_1", "platform", 1000));
  assert.equal(ks.step(5), 5);
  assert.equal(ks.step(-2), 3);
  assert.equal(ks.step(5_000_000), 1_000_000);
  assert.equal(ks.step(-5_000_000), -1_000_000);
});
