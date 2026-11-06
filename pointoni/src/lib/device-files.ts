// "My Files" lives on THIS device too: the bytes go into the browser's own database and never
// to the server. (Earlier builds wrote uploads to the server's disk; that route is retired.)
import { openDb, run } from "./device-vault.ts";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 250 * 1024 * 1024;

export type DeviceFile = { id: string; name: string; mime: string; sizeBytes: number; createdAt: string };
type StoredFile = DeviceFile & { blob: Blob };

const meta = ({ id, name, mime, sizeBytes, createdAt }: StoredFile): DeviceFile => ({ id, name, mime, sizeBytes, createdAt });

export async function listDeviceFiles(): Promise<DeviceFile[]> {
  const all = await run<StoredFile[]>(await openDb(), "files", "readonly", (s) => s.getAll());
  return all.map(meta).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Throws a message fit for the screen when the file does not fit. */
export async function addDeviceFile(file: File): Promise<DeviceFile> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  const used = (await listDeviceFiles()).reduce((n, f) => n + f.sizeBytes, 0);
  if (used + file.size > MAX_TOTAL_BYTES) throw new Error("This device's file vault is full. Remove something first.");
  const record: StoredFile = {
    id: crypto.randomUUID(),
    name: file.name.slice(0, 200) || "file",
    mime: file.type || "application/octet-stream",
    sizeBytes: file.size,
    createdAt: new Date().toISOString(),
    blob: file,
  };
  await run(await openDb(), "files", "readwrite", (s) => s.put(record));
  return meta(record);
}

export async function getDeviceFile(id: string): Promise<(DeviceFile & { blob: Blob }) | undefined> {
  return run<StoredFile | undefined>(await openDb(), "files", "readonly", (s) => s.get(id));
}

export async function removeDeviceFile(id: string): Promise<void> {
  await run(await openDb(), "files", "readwrite", (s) => s.delete(id));
}
