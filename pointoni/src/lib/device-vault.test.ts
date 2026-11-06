// Run with: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  MAX_CONTENT_CHARS,
  MAX_SESSIONS,
  buildExport,
  importSessions,
  listSessions,
  memoryStore,
  parseExport,
  recordTurn,
  titleFrom,
  type VaultMessage,
  type VaultSession,
} from "./device-vault.ts";

const msg = (role: "user" | "assistant", content: string, at: string, id = `${role}-${at}`): VaultMessage => ({ id, role, content, createdAt: at });
const T1 = "2026-10-02T10:00:00.000Z";
const T2 = "2026-10-02T10:05:00.000Z";
const T3 = "2026-10-02T11:00:00.000Z";

test("a turn creates the session with a title and both messages", async () => {
  const store = memoryStore();
  const s = await recordTurn(store, { sessionId: "guest-1", user: msg("user", "How do rainbows form?", T1), assistant: { ...msg("assistant", "Light bends.", T2), engine: "ollama" } });
  assert.equal(s.title, "How do rainbows form?");
  assert.equal(s.messages.length, 2);
  assert.equal(s.createdAt, T1);
  assert.equal(s.updatedAt, T2);
  assert.equal((await store.get("guest-1"))?.messages[1].engine, "ollama");
});

test("later turns append to the same session and move it to the top of the list", async () => {
  const store = memoryStore();
  await recordTurn(store, { sessionId: "a", user: msg("user", "first", T1), assistant: msg("assistant", "1", T1) });
  await recordTurn(store, { sessionId: "b", user: msg("user", "second", T2), assistant: msg("assistant", "2", T2) });
  await recordTurn(store, { sessionId: "a", user: msg("user", "again", T3), assistant: msg("assistant", "3", T3) });
  const list = await listSessions(store);
  assert.deepEqual(list.map((s) => s.id), ["a", "b"]);
  assert.equal(list[0].messages.length, 4);
  assert.equal(list[0].title, "first"); // the title is the first question
});

test("long titles are shortened and blank ones get a name", () => {
  assert.equal(titleFrom("x".repeat(100)).length, 57);
  assert.equal(titleFrom("   "), "Conversation");
  assert.equal(titleFrom("a\n\n  b"), "a b");
});

test("the vault is bounded: the oldest conversations are dropped past the cap", async () => {
  const store = memoryStore();
  for (let i = 0; i < MAX_SESSIONS + 5; i++) {
    const at = new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
    await recordTurn(store, { sessionId: `s${i}`, user: msg("user", "q", at), assistant: msg("assistant", "a", at) });
  }
  const all = await store.all();
  assert.equal(all.length, MAX_SESSIONS);
  assert.equal(await store.get("s0"), undefined);
  assert.ok(await store.get(`s${MAX_SESSIONS + 4}`));
});

test("export then import round-trips exactly", async () => {
  const a = memoryStore();
  await recordTurn(a, { sessionId: "guest-9", user: msg("user", "hello", T1), assistant: { ...msg("assistant", "hi", T2), engine: "core" } });
  const file = JSON.parse(JSON.stringify(buildExport(await listSessions(a), new Date(T3))));
  const b = memoryStore();
  const result = await importSessions(b, parseExport(file));
  assert.deepEqual(result, { added: 1, updated: 0, kept: 0 });
  assert.deepEqual(await b.all(), await a.all());
});

test("importing merges: newer wins, older is kept out, nothing is duplicated", async () => {
  const store = memoryStore();
  await recordTurn(store, { sessionId: "x", user: msg("user", "mine", T1), assistant: msg("assistant", "m", T3) });
  const older: VaultSession = { id: "x", title: "old copy", createdAt: T1, updatedAt: T2, messages: [] };
  const newer: VaultSession = { id: "x", title: "new copy", createdAt: T1, updatedAt: "2026-10-03T00:00:00.000Z", messages: [] };
  assert.deepEqual(await importSessions(store, [older]), { added: 0, updated: 0, kept: 1 });
  assert.equal((await store.get("x"))?.title, "mine");
  assert.deepEqual(await importSessions(store, [newer]), { added: 0, updated: 1, kept: 0 });
  assert.equal((await store.get("x"))?.title, "new copy");
  assert.equal((await store.all()).length, 1);
});

test("an untrusted file is validated strictly", () => {
  const good = { format: "sg16-vault", version: 1, exportedAt: T1, sessions: [] };
  assert.deepEqual(parseExport(good), []);
  const session = (over: Record<string, unknown> = {}) => ({
    id: "guest-1", title: "t", createdAt: T1, updatedAt: T2,
    messages: [{ id: "m1", role: "user", content: "hi", createdAt: T1 }], ...over,
  });
  const wrap = (s: unknown) => ({ ...good, sessions: [s] });
  for (const [label, file] of [
    ["not an object", "nope"],
    ["null", null],
    ["wrong format", { ...good, format: "other" }],
    ["wrong version", { ...good, version: 2 }],
    ["no sessions", { format: "sg16-vault", version: 1 }],
    ["bad id characters", wrap(session({ id: "../../etc/passwd" }))],
    ["empty id", wrap(session({ id: "" }))],
    ["bad date", wrap(session({ createdAt: "yesterday" }))],
    ["bad role", wrap(session({ messages: [{ id: "m", role: "system", content: "x", createdAt: T1 }] }))],
    ["non-string content", wrap(session({ messages: [{ id: "m", role: "user", content: 5, createdAt: T1 }] }))],
    ["oversized content", wrap(session({ messages: [{ id: "m", role: "user", content: "x".repeat(MAX_CONTENT_CHARS + 1), createdAt: T1 }] }))],
    ["messages not a list", wrap(session({ messages: "x" }))],
  ] as [string, unknown][]) {
    assert.throws(() => parseExport(file), /Not a valid SG16 history file/, label);
  }
});

test("unknown fields in an imported file are dropped, not stored", () => {
  const file = {
    format: "sg16-vault", version: 1, exportedAt: T1,
    sessions: [{
      id: "guest-1", title: "t", createdAt: T1, updatedAt: T2, secretField: "x",
      messages: [{ id: "m1", role: "user", content: "hi", createdAt: T1, extra: { a: 1 } }],
    }],
  };
  const [s] = parseExport(file);
  assert.deepEqual(Object.keys(s).sort(), ["createdAt", "id", "messages", "title", "updatedAt"]);
  assert.deepEqual(Object.keys(s.messages[0]).sort(), ["content", "createdAt", "id", "role"]);
});

test("the server stores no chat history: the chat route has no database writes for messages or sessions", () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, "../app/api/brain/route.ts"), "utf8");
  assert.doesNotMatch(src, /chatSessions|chatMessages/);
  assert.equal(fs.existsSync(path.resolve(import.meta.dirname, "../app/api/brain/restore/route.ts")), false);
});
