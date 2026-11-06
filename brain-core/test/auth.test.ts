import { test } from "node:test";
import assert from "node:assert/strict";
import { bearer, isKeyShape, newKey, keyHash } from "../src/keys.ts";
import { authenticate, loadPolicy, parseAsk } from "../src/auth.ts";
import type { KeyRecord } from "../src/types.ts";

class FakeKV {
  map = new Map<string, string>();
  async get(k: string) { return this.map.get(k) ?? null; }
  async put(k: string, v: string) { this.map.set(k, v); }
}

test("key shape and bearer parsing", () => {
  const { key } = newKey();
  assert.ok(isKeyShape(key));
  assert.equal(bearer(`Bearer ${key}`), key);
  assert.equal(bearer("Bearer nope"), null);
  assert.equal(bearer(null), null);
});

test("authenticate accepts a valid key and rejects unknown/revoked", async () => {
  const kv = new FakeKV();
  const { key } = newKey();
  const record: KeyRecord = { id: "k_01", user: 1, project: "platform", created: 1, revoked: false };
  kv.map.set(await keyHash(key), JSON.stringify(record));

  const ok = await authenticate(`Bearer ${key}`, kv);
  assert.ok(ok.ok && ok.record.user === 1);

  const unknown = await authenticate("Bearer " + "sg16_" + "0".repeat(32), kv);
  assert.ok(!unknown.ok);

  const revokedKv = new FakeKV();
  revokedKv.map.set(await keyHash(key), JSON.stringify({ ...record, revoked: true }));
  const revoked = await authenticate(`Bearer ${key}`, revokedKv);
  assert.ok(!revoked.ok);
});

test("loadPolicy returns defaults and sanitizes stored policies", async () => {
  const kv = new FakeKV();
  const def = await loadPolicy(kv, "nope");
  assert.equal(def.rpm, 60);

  kv.map.set("policy:platform", JSON.stringify({ rpm: 5, require_json: true, blocked_patterns: ["x", 3] }));
  const p = await loadPolicy(kv, "platform");
  assert.equal(p.rpm, 5);
  assert.equal(p.require_json, true);
  assert.deepEqual(p.blocked_patterns, ["x"]);
});

test("parseAsk validates kinds and sizes", () => {
  assert.deepEqual(parseAsk({ text: "hello" }), { kind: "chat", text: "hello" });
  assert.equal(parseAsk({ text: "" }), null);
  assert.equal(parseAsk({ text: "x".repeat(70000) }), null);
  assert.equal(parseAsk({ kind: "compute" }), null);              // compute needs op
  assert.deepEqual(parseAsk({ kind: "compute", op: "1+1" }), { kind: "compute", text: "1+1" });
  assert.equal(parseAsk(null), null);
});
