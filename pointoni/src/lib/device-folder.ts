// Optional: mirror the device vault into a folder the visitor chooses (File System Access API,
// Chromium browsers). The browser always asks the person to pick the folder and to allow writing;
// nothing can be written silently to an arbitrary place. If the API is missing (Firefox, Safari)
// the history page offers "Download / Import" instead.
import { handleStore, parseExport, type VaultSession } from "./device-vault";

type FileHandleLike = {
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  getFile(): Promise<{ text(): Promise<string> }>;
};
type DirHandleLike = {
  name: string;
  queryPermission(opts: { mode: "readwrite" }): Promise<"granted" | "denied" | "prompt">;
  requestPermission(opts: { mode: "readwrite" }): Promise<"granted" | "denied" | "prompt">;
  getFileHandle(name: string, opts?: { create: boolean }): Promise<FileHandleLike>;
  values(): AsyncIterable<{ kind: "file" | "directory"; name: string; getFile?: () => Promise<{ text(): Promise<string> }> }>;
};

const KEY = "backup-dir";
const picker = () => (window as unknown as { showDirectoryPicker?: (o: { mode: "readwrite" }) => Promise<DirHandleLike> }).showDirectoryPicker;

export function folderBackupSupported(): boolean {
  return typeof window !== "undefined" && typeof picker() === "function";
}

async function savedHandle(): Promise<DirHandleLike | null> {
  try {
    return ((await (await handleStore()).get(KEY)) as DirHandleLike | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Ask the person to pick a folder; remember it on this device. Returns its name, or null. */
export async function chooseBackupFolder(): Promise<string | null> {
  const show = picker();
  if (!show) return null;
  try {
    const dir = await show.call(window, { mode: "readwrite" });
    if ((await dir.requestPermission({ mode: "readwrite" })) !== "granted") return null;
    await (await handleStore()).put(KEY, dir);
    return dir.name;
  } catch {
    return null; // picker cancelled
  }
}

export async function backupFolderName(): Promise<string | null> {
  return (await savedHandle())?.name ?? null;
}

export async function forgetBackupFolder(): Promise<void> {
  try {
    await (await handleStore()).remove(KEY);
  } catch {
    // nothing to forget
  }
}

const safeName = (id: string) => `sg16-${id.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80)}.json`;

/** Write one session into the chosen folder. Silent: does nothing unless permission is already granted. */
export async function writeSessionBackup(session: VaultSession): Promise<boolean> {
  const dir = await savedHandle();
  if (!dir) return false;
  try {
    if ((await dir.queryPermission({ mode: "readwrite" })) !== "granted") return false;
    const file = await dir.getFileHandle(safeName(session.id), { create: true });
    const out = await file.createWritable();
    await out.write(JSON.stringify({ format: "sg16-vault", version: 1, exportedAt: new Date().toISOString(), sessions: [session] }, null, 2));
    await out.close();
    return true;
  } catch {
    return false;
  }
}

/** Read every sg16-*.json in the chosen folder (asks permission if needed). Invalid files are skipped. */
export async function readFolderBackups(): Promise<{ sessions: VaultSession[]; skipped: number }> {
  const dir = await savedHandle();
  if (!dir) return { sessions: [], skipped: 0 };
  if ((await dir.requestPermission({ mode: "readwrite" })) !== "granted") return { sessions: [], skipped: 0 };
  const sessions: VaultSession[] = [];
  let skipped = 0;
  for await (const entry of dir.values()) {
    if (entry.kind !== "file" || !/^sg16-.*\.json$/.test(entry.name) || !entry.getFile) continue;
    try {
      const text = await (await entry.getFile()).text();
      if (text.length > 20_000_000) throw new Error("too large");
      sessions.push(...parseExport(JSON.parse(text)));
    } catch {
      skipped += 1;
    }
  }
  return { sessions, skipped };
}

/** Save every session into the chosen folder (asks permission if the browser needs it again). */
export async function writeAllBackups(sessions: VaultSession[]): Promise<number> {
  const dir = await savedHandle();
  if (!dir) return 0;
  try {
    if ((await dir.requestPermission({ mode: "readwrite" })) !== "granted") return 0;
  } catch {
    return 0;
  }
  let written = 0;
  for (const s of sessions) if (await writeSessionBackup(s)) written += 1;
  return written;
}
