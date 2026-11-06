// A browser that already holds the version-1 vault (history only) must upgrade without losing it.
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { idbStore } from "./device-vault.ts";
import { listDeviceFiles } from "./device-files.ts";

test("version 1 database upgrades to version 2: history kept, files store added", async () => {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("sg16-vault", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("sessions", { keyPath: "id" });
      req.result.createObjectStore("handles");
    };
    req.onsuccess = () => {
      const tx = req.result.transaction("sessions", "readwrite");
      tx.objectStore("sessions").put({
        id: "guest-old", title: "from v1", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
        messages: [{ id: "m", role: "user", content: "kept", createdAt: "2026-10-01T00:00:00.000Z" }],
      });
      tx.oncomplete = () => {
        req.result.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
  const old = await idbStore().get("guest-old");
  assert.equal(old?.title, "from v1");
  assert.equal(old?.messages[0].content, "kept");
  assert.deepEqual(await listDeviceFiles(), []); // the new store exists and is empty
});
