// D1 logging: the write must be awaitable (waitUntil keeps the Worker alive
// only for promises it is given) and a failing write must never throw.

import test from "node:test";
import assert from "node:assert/strict";
import { logRequest, logHistory } from "../src/d1.ts";

function slowDb(fail = false) {
  const rows: unknown[][] = [];
  return {
    rows,
    prepare: (_sql: string) => ({
      bind: (...values: unknown[]) => ({
        run: () => new Promise<unknown>((resolve, reject) =>
          setTimeout(() => (fail ? reject(new Error("d1 down")) : (rows.push(values), resolve({}))), 5)),
      }),
    }),
  };
}

test("logRequest resolves only after the row is written, with the detected script", async () => {
  const db = slowDb();
  await logRequest(db, {
    keyId: "k_1", userId: 1, project: "platform", kind: "chat", engine: "model-vps",
    http: 200, latencyMs: 10, queueMs: 0, verified: true, script: "bengali",
  }, 1000);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].at(-1), "bengali");
});

test("logHistory resolves after the write; a failing D1 never throws", async () => {
  const db = slowDb();
  await logHistory(db, {
    keyId: "k_1", project: "platform", requestDigest: "a", responseDigest: "b", engine: "model-vps", verified: true,
  }, 1000);
  assert.equal(db.rows.length, 1);

  const down = slowDb(true);
  await logRequest(down, {
    keyId: "k_1", userId: 1, project: "platform", kind: "chat", engine: "none",
    http: 500, latencyMs: 1, queueMs: 0, verified: false,
  }, 1000);
  assert.equal(down.rows.length, 0);
});
