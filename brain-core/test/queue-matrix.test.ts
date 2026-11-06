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

test("lease outlasts the longest legitimate hold (2 x 60s draft + 60s self-check)", async () => {
  const { DEFAULT_QUEUE_CONFIG } = await import("../src/inference-gate.ts");
  assert.ok(DEFAULT_QUEUE_CONFIG.leaseMs > 2 * 60_000 + 60_000, "draft retries + the self-check pass must fit inside the lease");
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
