// Files stay on the device: the real IndexedDB code path, run against an in-memory IndexedDB.
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { MAX_FILE_BYTES, addDeviceFile, getDeviceFile, listDeviceFiles, removeDeviceFile } from "./device-files.ts";

test("a file is stored, listed, read back byte for byte, and removed", async () => {
  const saved = await addDeviceFile(new File(["hello vault"], "note.txt", { type: "text/plain" }));
  assert.equal(saved.name, "note.txt");
  assert.equal(saved.sizeBytes, 11);
  assert.deepEqual((await listDeviceFiles()).map((f) => f.id), [saved.id]);
  const back = await getDeviceFile(saved.id);
  assert.equal(await back!.blob.text(), "hello vault");
  await removeDeviceFile(saved.id);
  assert.deepEqual(await listDeviceFiles(), []);
});

test("a file over the limit is refused with a readable message and not stored", async () => {
  const big = new File([new Uint8Array(MAX_FILE_BYTES + 1)], "huge.bin");
  await assert.rejects(() => addDeviceFile(big), /larger than 25 MB/);
  assert.deepEqual(await listDeviceFiles(), []);
});

test("the server no longer writes uploads to its disk", () => {
  const route = fs.readFileSync(path.resolve(import.meta.dirname, "../app/api/files/route.ts"), "utf8");
  assert.doesNotMatch(route, /writeFile|node:fs|UPLOAD_DIR|storedFiles/);
  assert.match(route, /status: 410/);
});
