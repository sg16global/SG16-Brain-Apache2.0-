// Run with: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ConcurrencyGuard, lastAnswer, recordAnswer } from "./answer-ladder.ts";
import { ENGINES, Metrics, fileSink, metricsFileFromEnv, type HourLine } from "./metrics.ts";

const HOUR = 3600_000;
const T0 = 10 * HOUR; // an exact hour boundary
const noQueue = { active: 0, queued: 0 };

test("counts per engine, average and p95", () => {
  const m = new Metrics(null, T0);
  for (const ms of [100, 200, 300, 400, 1000]) m.record("ollama", ms, T0 + 1);
  m.record("core-gate", 5, T0 + 1);
  m.record("busy", undefined, T0 + 1);
  m.record("rate-limited", undefined, T0 + 1);
  const s = m.snapshot({ active: 1, queued: 2 }, T0 + 2);
  assert.equal(s.answered.ollama, 5);
  assert.equal(s.answered["core-gate"], 1);
  assert.equal(s.answered.busy, 1);
  assert.equal(s.answered["rate-limited"], 1);
  assert.equal(s.total, 8);
  assert.equal(s.samples, 6); // busy / rate-limited carry no timing
  assert.equal(s.p95Ms, 1000);
  assert.deepEqual(s.queue, { active: 1, queued: 2 });
  assert.equal(typeof s.avgMs, "number");
});

test("empty metrics report nulls, not NaN", () => {
  const s = new Metrics(null, T0).snapshot(noQueue, T0);
  assert.equal(s.avgMs, null);
  assert.equal(s.p95Ms, null);
  assert.equal(s.total, 0);
});

test("the timing window is bounded", () => {
  const m = new Metrics(null, T0);
  for (let i = 0; i < 5000; i++) m.record("ollama", i, T0);
  assert.equal(m.snapshot(noQueue, T0).samples, 1000);
});

test("a finished hour is emitted once as an aggregate line; an idle hour emits nothing", () => {
  const lines: HourLine[] = [];
  const m = new Metrics((l) => lines.push(l), T0);
  m.record("ollama", 100, T0 + 10);
  m.record("ollama", 300, T0 + 20);
  m.record("busy", undefined, T0 + 30);
  m.record("ollama", 50, T0 + HOUR + 5); // next hour: closes the first
  assert.equal(lines.length, 1);
  assert.equal(lines[0].hour, new Date(T0).toISOString());
  assert.equal(lines[0].counts.ollama, 2);
  assert.equal(lines[0].counts.busy, 1);
  assert.equal(lines[0].samples, 2);
  m.snapshot(noQueue, T0 + 5 * HOUR); // hour 1 had traffic -> one line; hours 2-4 idle -> none
  assert.equal(lines.length, 2);
  m.snapshot(noQueue, T0 + 9 * HOUR);
  assert.equal(lines.length, 2);
});

test("a failing sink never breaks recording", () => {
  const m = new Metrics(() => {
    throw new Error("disk full");
  }, T0);
  m.record("ollama", 1, T0);
  assert.doesNotThrow(() => m.record("ollama", 1, T0 + HOUR + 1));
});

test("snapshots and log lines contain only counts and timings - no identifiers or text", () => {
  const lines: HourLine[] = [];
  const m = new Metrics((l) => lines.push(l), T0);
  m.record("core-gate", 1, T0);
  m.record("ollama", 1, T0 + HOUR);
  const allowed = new Set(["hour", "counts", "avgMs", "p95Ms", "samples"]);
  assert.deepEqual(Object.keys(lines[0]).filter((k) => !allowed.has(k)), []);
  assert.deepEqual(Object.keys(lines[0].counts).sort(), [...ENGINES].sort());
  assert.ok(Object.values(lines[0].counts).every((n) => typeof n === "number"));
  const snap = JSON.stringify(m.snapshot(noQueue, T0 + HOUR));
  assert.doesNotMatch(snap, /ip|session|message|content|visitor/i);
});

test("file sink: appends lines, owner-only mode, prunes lines older than 30 days", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sg16-metrics-"));
  try {
    const file = path.join(dir, "state", "metrics.jsonl");
    const sink = fileSink(file);
    const counts = Object.fromEntries(ENGINES.map((e) => [e, 0])) as HourLine["counts"];
    const old = new Date(Date.now() - 31 * 24 * HOUR).toISOString();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ hour: old, counts, avgMs: 1, p95Ms: 1, samples: 1 }) + "\n" + "not json\n");
    const recent = new Date(Date.now() - 2 * HOUR).toISOString();
    sink({ hour: recent, counts, avgMs: 2, p95Ms: 3, samples: 4 });
    const rows = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].hour, recent);
    if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["metrics.jsonl"]); // no temp file left
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the log file is opt-in", () => {
  assert.equal(metricsFileFromEnv({} as unknown as NodeJS.ProcessEnv), null);
  assert.match(
    metricsFileFromEnv({ SG16_METRICS_LOG: "1" } as unknown as NodeJS.ProcessEnv) ?? "",
    /metrics\.jsonl$/,
  );
  assert.equal(
    metricsFileFromEnv({ SG16_METRICS_LOG: "1", SG16_METRICS_FILE: "/x/m.jsonl" } as unknown as NodeJS.ProcessEnv),
    "/x/m.jsonl",
  );
});

test("a rate-limited request is counted but is not reported as what 'last answered'", () => {
  recordAnswer("ollama", 10);
  const before = lastAnswer();
  recordAnswer("rate-limited");
  assert.deepEqual(lastAnswer(), before);
  assert.equal(before?.engine, "ollama");
});

test("the limiter reports its queue for the counters", async () => {
  const g = new ConcurrencyGuard(1, 2);
  assert.deepEqual(g.stats(), { active: 0, queued: 0 });
  const release = await g.acquire();
  const waiting = g.acquire();
  assert.deepEqual(g.stats(), { active: 1, queued: 1 });
  release?.();
  (await waiting)?.();
  assert.deepEqual(g.stats(), { active: 0, queued: 0 });
});
