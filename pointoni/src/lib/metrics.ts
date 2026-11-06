// ===================================================================
// ANONYMOUS COUNTERS — numbers only, in memory.
//
// What is counted: how many requests each engine answered, and how long
// answers took. What is NOT here: no IP, no visitor key, no session id, no
// message text, no per-request record of any kind - only running totals.
//
// Optionally (SG16_METRICS_LOG=1) one aggregate line per hour is appended to
// state/metrics.jsonl: counts and timings only, file mode 0600, lines older
// than 30 days pruned. A failure to write is swallowed - metrics must never
// break answering.
// ===================================================================

import fs from "node:fs";
import path from "node:path";

export const ENGINES = [
  "core-gate",
  "core",
  "ollama",
  "fallback-local",
  "busy",
  "rate-limited",
] as const;
export type MetricEngine = (typeof ENGINES)[number];

const SAMPLE_WINDOW = 1000;
const RETENTION_MS = 30 * 24 * 3600_000;
const HOUR_MS = 3600_000;

export type Counts = Record<MetricEngine, number>;
const zero = (): Counts => Object.fromEntries(ENGINES.map((e) => [e, 0])) as Counts;

export type MetricsSnapshot = {
  since: string;
  answered: Counts;
  total: number;
  avgMs: number | null;
  p95Ms: number | null;
  samples: number;
  queue: { active: number; queued: number };
};

export type HourLine = {
  hour: string; // ISO start of the hour
  counts: Counts;
  avgMs: number | null;
  p95Ms: number | null;
  samples: number;
};

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

function stats(samples: number[]): { avgMs: number | null; p95Ms: number | null } {
  if (samples.length === 0) return { avgMs: null, p95Ms: null };
  const sorted = [...samples].sort((a, b) => a - b);
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  const p95 = percentile(sorted, 0.95);
  return { avgMs: Math.round(avg), p95Ms: p95 === null ? null : Math.round(p95) };
}

export class Metrics {
  private since = new Date().toISOString();
  private totals = zero();
  private ring: number[] = [];
  private hourStart: number;
  private hourCounts = zero();
  private hourSamples: number[] = [];
  private sink: ((line: HourLine) => void) | null;

  constructor(sink: ((line: HourLine) => void) | null = null, now = Date.now()) {
    this.sink = sink;
    this.hourStart = now - (now % HOUR_MS);
  }

  /** `ms` only for requests that actually took answering time. */
  record(engine: MetricEngine, ms?: number, now = Date.now()): void {
    this.roll(now);
    this.totals[engine] += 1;
    this.hourCounts[engine] += 1;
    if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0) {
      this.ring.push(ms);
      if (this.ring.length > SAMPLE_WINDOW) this.ring.shift();
      this.hourSamples.push(ms);
    }
  }

  snapshot(queue: { active: number; queued: number }, now = Date.now()): MetricsSnapshot {
    this.roll(now);
    const { avgMs, p95Ms } = stats(this.ring);
    return {
      since: this.since,
      answered: { ...this.totals },
      total: ENGINES.reduce((n, e) => n + this.totals[e], 0),
      avgMs,
      p95Ms,
      samples: this.ring.length,
      queue,
    };
  }

  /** Close finished hours: emit one aggregate line, start a fresh bucket. */
  private roll(now: number): void {
    const current = now - (now % HOUR_MS);
    if (current <= this.hourStart) return;
    const any = ENGINES.some((e) => this.hourCounts[e] > 0);
    if (any && this.sink) {
      const { avgMs, p95Ms } = stats(this.hourSamples);
      try {
        this.sink({
          hour: new Date(this.hourStart).toISOString(),
          counts: { ...this.hourCounts },
          avgMs,
          p95Ms,
          samples: this.hourSamples.length,
        });
      } catch {
        // never let metrics break a request
      }
    }
    this.hourStart = current;
    this.hourCounts = zero();
    this.hourSamples = [];
  }
}

/** Append one line to a 0600 JSONL file and drop lines older than 30 days. */
export function fileSink(file: string): (line: HourLine) => void {
  return (line) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const cutoff = Date.now() - RETENTION_MS;
      let kept: string[] = [];
      try {
        kept = fs
          .readFileSync(file, "utf8")
          .split("\n")
          .filter((l) => {
            if (!l.trim()) return false;
            try {
              return Date.parse((JSON.parse(l) as { hour?: string }).hour ?? "") >= cutoff;
            } catch {
              return false; // drop unparseable lines rather than carry them forever
            }
          });
      } catch {
        // no file yet
      }
      kept.push(JSON.stringify(line));
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, kept.join("\n") + "\n", { mode: 0o600 });
      fs.chmodSync(tmp, 0o600);
      fs.renameSync(tmp, file);
    } catch {
      // best effort only
    }
  };
}

export function metricsFileFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.SG16_METRICS_LOG !== "1") return null;
  return env.SG16_METRICS_FILE?.trim() || path.resolve(process.cwd(), "..", "state", "metrics.jsonl");
}

const KEY = Symbol.for("sg16.metrics");
export function sharedMetrics(): Metrics {
  const g = globalThis as unknown as Record<symbol, Metrics | undefined>;
  if (!g[KEY]) {
    const file = metricsFileFromEnv();
    g[KEY] = new Metrics(file ? fileSink(file) : null);
  }
  return g[KEY] as Metrics;
}
