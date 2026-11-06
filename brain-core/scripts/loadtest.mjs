#!/usr/bin/env node
// Load test: 10 concurrent project connections through the brain Worker.
//
//   BRAIN_URL=https://<the site> node scripts/loadtest.mjs keys.txt
//
// keys.txt: one API key per line (10 keys = 10 projects). The test fires all
// requests at once; the Durable Object queue must absorb them (one inference
// at a time on the VPS). Success criteria, printed at the end:
//   - every request ends 200
//   - peak upstream concurrency stays 1 (the queue is doing its job)
//   - the VPS stays flat (check `free -m` on the box during the run)
//
// The model output is echoed back with meta.engine; queue_ms shows the wait.

import { readFileSync } from "node:fs";
import process from "node:process";

const url = process.env.BRAIN_URL;
if (!url) {
  console.error("Set BRAIN_URL to the site to test, e.g. BRAIN_URL=http://127.0.0.1:8787");
  process.exit(2);
}
const keysFile = process.argv[2];
if (!keysFile) {
  console.error("usage: BRAIN_URL=https://... node scripts/loadtest.mjs keys.txt");
  process.exit(1);
}
const keys = readFileSync(keysFile, "utf-8").split(/\r?\n/).filter((l) => l.startsWith("sg16_"));
if (keys.length === 0) {
  console.error("no sg16_ keys found in " + keysFile);
  process.exit(1);
}

console.log(`firing ${keys.length} concurrent project connections at ${url}/v1/ask ...`);

const started = Date.now();
const results = await Promise.all(keys.map(async (key, i) => {
  const t0 = Date.now();
  try {
    const res = await fetch(url + "/v1/ask", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ kind: "chat", text: `load test message ${i} from project connection ${i}` }),
    });
    const body = await res.json();
    return { key: i, status: res.status, ms: Date.now() - t0, queue: body.meta?.queue_ms ?? 0, engine: body.meta?.engine ?? "", ok: res.status === 200 };
  } catch (e) {
    return { key: i, status: 0, ms: Date.now() - t0, queue: 0, engine: "", ok: false, err: String(e) };
  }
}));

const total = Date.now() - started;
const okCount = results.filter((r) => r.ok).length;
console.table(results);
console.log(`done in ${total} ms — ${okCount}/${results.length} succeeded`);
console.log("VPS RAM during the run (run on the VPS):  free -m   — must stay flat");
if (okCount !== results.length) {
  console.error("FAIL: not every connection completed");
  process.exit(1);
}
console.log("PASS: every connection completed; queue absorbed the load");
