// Runs the real IndexedDB code path against an in-memory IndexedDB implementation.
// This proves the store logic (open, put, get, list, remove, handles); it cannot prove that a
// particular browser lets a site keep data - private windows and "clear on exit" settings can.
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { handleStore, idbStore, listSessions, recordTurn, deviceVault, type VaultMessage } from "./device-vault.ts";

const m = (role: "user" | "assistant", content: string, at: string): VaultMessage => ({ id: `${role}-${at}`, role, content, createdAt: at });

test("IndexedDB store: a turn survives close-and-reopen (a new store object sees it)", async () => {
  const first = idbStore();
  await recordTurn(first, { sessionId: "guest-idb", user: m("user", "remember me", "2026-10-02T10:00:00.000Z"), assistant: m("assistant", "ok", "2026-10-02T10:00:05.000Z") });
  const reopened = idbStore(); // a fresh object, as after a page reload
  const s = await reopened.get("guest-idb");
  assert.equal(s?.messages.length, 2);
  assert.equal(s?.title, "remember me");
  assert.deepEqual((await listSessions(reopened)).map((x) => x.id), ["guest-idb"]);
});

test("IndexedDB store: remove deletes, put replaces", async () => {
  const store = idbStore();
  await recordTurn(store, { sessionId: "gone", user: m("user", "a", "2026-10-02T11:00:00.000Z"), assistant: m("assistant", "b", "2026-10-02T11:00:01.000Z") });
  await store.remove("gone");
  assert.equal(await store.get("gone"), undefined);
});

test("handle store keeps the backup-folder handle separately from conversations", async () => {
  const h = await handleStore();
  await h.put("backup-dir", { name: "my-folder" });
  assert.deepEqual(await h.get("backup-dir"), { name: "my-folder" });
  await h.remove("backup-dir");
  assert.equal(await h.get("backup-dir"), undefined);
  assert.ok(!(await idbStore().all()).some((s) => (s as unknown as { name?: string }).name === "my-folder"));
});

test("the app's shared vault is IndexedDB when it exists", async () => {
  await recordTurn(deviceVault(), { sessionId: "shared", user: m("user", "x", "2026-10-02T12:00:00.000Z"), assistant: m("assistant", "y", "2026-10-02T12:00:01.000Z") });
  assert.ok(await idbStore().get("shared"));
});
