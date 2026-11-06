// ===================================================================
// DEVICE VAULT - the visitor's conversation history lives on THEIR device.
//
// The server keeps no chat history, no files of yours, no profile of you. Each
// finished turn is written here, in the browser's own database (IndexedDB), with
// no sign-in needed. Optionally (device-folder.ts) the same sessions can be
// mirrored into a folder the visitor picks, as plain JSON files they own.
//
// The logic below works against a tiny `VaultStore` interface so it runs the same
// on IndexedDB (the browser) and in memory (the unit tests).
// ===================================================================

export type VaultMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  /** which engine answered (assistant messages only) */
  engine?: string;
};

export type VaultSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: VaultMessage[];
};

export interface VaultStore {
  all(): Promise<VaultSession[]>;
  get(id: string): Promise<VaultSession | undefined>;
  put(session: VaultSession): Promise<void>;
  remove(id: string): Promise<void>;
}

export const MAX_SESSIONS = 500;
export const MAX_MESSAGES_PER_SESSION = 2000;
export const MAX_CONTENT_CHARS = 20_000;
const MAX_ID_CHARS = 80;
const ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 56 ? clean.slice(0, 56) + "…" : clean || "Conversation";
}

/** In-memory store: used by the tests, and as the fallback when the browser blocks IndexedDB. */
export function memoryStore(): VaultStore {
  const map = new Map<string, VaultSession>();
  return {
    async all() {
      return [...map.values()].map((s) => structuredClone(s));
    },
    async get(id) {
      const s = map.get(id);
      return s ? structuredClone(s) : undefined;
    },
    async put(session) {
      map.set(session.id, structuredClone(session));
    },
    async remove(id) {
      map.delete(id);
    },
  };
}

export async function listSessions(store: VaultStore): Promise<VaultSession[]> {
  return (await store.all()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Append one finished turn (the visitor's message and the answer) to its session. */
export async function recordTurn(
  store: VaultStore,
  input: { sessionId: string; user: VaultMessage; assistant: VaultMessage },
): Promise<VaultSession> {
  const existing = await store.get(input.sessionId);
  const session: VaultSession = existing ?? {
    id: input.sessionId,
    title: titleFrom(input.user.content),
    createdAt: input.user.createdAt,
    updatedAt: input.assistant.createdAt,
    messages: [],
  };
  session.messages.push(input.user, input.assistant);
  if (session.messages.length > MAX_MESSAGES_PER_SESSION) {
    session.messages = session.messages.slice(-MAX_MESSAGES_PER_SESSION);
  }
  session.updatedAt = input.assistant.createdAt;
  await store.put(session);

  // keep the vault bounded: drop the oldest conversations beyond the cap
  const all = await store.all();
  if (all.length > MAX_SESSIONS) {
    all.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    for (const old of all.slice(0, all.length - MAX_SESSIONS)) await store.remove(old.id);
  }
  return session;
}

// ---------------------------------------------------------------- export / import
export type VaultExport = { format: "sg16-vault"; version: 1; exportedAt: string; sessions: VaultSession[] };

export function buildExport(sessions: VaultSession[], now = new Date()): VaultExport {
  return { format: "sg16-vault", version: 1, exportedAt: now.toISOString(), sessions };
}

const isIso = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

/**
 * Validate an untrusted file strictly (it may come from anywhere) and return clean sessions.
 * Unknown fields are dropped, sizes are capped, anything malformed throws.
 */
export function parseExport(raw: unknown): VaultSession[] {
  const bad = (why: string) => {
    throw new Error(`Not a valid SG16 history file: ${why}`);
  };
  if (!raw || typeof raw !== "object") return bad("not an object");
  const o = raw as Record<string, unknown>;
  if (o.format !== "sg16-vault" || o.version !== 1) return bad("wrong format or version");
  if (!Array.isArray(o.sessions)) return bad("no sessions list");
  if (o.sessions.length > MAX_SESSIONS) return bad("too many sessions");
  return o.sessions.map((s, i): VaultSession => {
    if (!s || typeof s !== "object") return bad(`session ${i}`);
    const x = s as Record<string, unknown>;
    if (typeof x.id !== "string" || !x.id || x.id.length > MAX_ID_CHARS || !ID_PATTERN.test(x.id)) return bad(`session ${i} id`);
    if (typeof x.title !== "string" || x.title.length > 200) return bad(`session ${i} title`);
    if (!isIso(x.createdAt) || !isIso(x.updatedAt)) return bad(`session ${i} dates`);
    if (!Array.isArray(x.messages) || x.messages.length > MAX_MESSAGES_PER_SESSION) return bad(`session ${i} messages`);
    const messages = x.messages.map((m, j): VaultMessage => {
      if (!m || typeof m !== "object") return bad(`message ${i}.${j}`);
      const y = m as Record<string, unknown>;
      if (y.role !== "user" && y.role !== "assistant") return bad(`message ${i}.${j} role`);
      if (typeof y.content !== "string" || y.content.length > MAX_CONTENT_CHARS) return bad(`message ${i}.${j} content`);
      if (typeof y.id !== "string" || y.id.length > 80) return bad(`message ${i}.${j} id`);
      if (!isIso(y.createdAt)) return bad(`message ${i}.${j} date`);
      return {
        id: y.id,
        role: y.role,
        content: y.content,
        createdAt: y.createdAt,
        ...(typeof y.engine === "string" && y.engine.length <= 40 ? { engine: y.engine } : {}),
      };
    });
    return { id: x.id, title: x.title, createdAt: x.createdAt, updatedAt: x.updatedAt, messages };
  });
}

/** Merge sessions into the vault; for the same id the more recently updated one wins. */
export async function importSessions(
  store: VaultStore,
  sessions: VaultSession[],
): Promise<{ added: number; updated: number; kept: number }> {
  let added = 0;
  let updated = 0;
  let kept = 0;
  for (const s of sessions) {
    const mine = await store.get(s.id);
    if (!mine) {
      await store.put(s);
      added += 1;
    } else if (s.updatedAt > mine.updatedAt) {
      await store.put(s);
      updated += 1;
    } else {
      kept += 1;
    }
  }
  return { added, updated, kept };
}

// ------------------------------------------------------------------ IndexedDB (browser)
const DB_NAME = "sg16-vault";

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      // created only if missing, so a version-1 database upgrades without losing history
      if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", { keyPath: "id" });
      if (!db.objectStoreNames.contains("handles")) db.createObjectStore("handles"); // device-folder.ts
      if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "id" }); // device-files.ts
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
  });
}

export function run<T>(db: IDBDatabase, storeName: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB error"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB aborted"));
  });
}

/** The vault in this browser's own database. Throws on first use if the browser blocks storage. */
export function idbStore(): VaultStore {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const db = () => (dbPromise ??= openDb());
  return {
    async all() {
      return run<VaultSession[]>(await db(), "sessions", "readonly", (s) => s.getAll());
    },
    async get(id) {
      return run<VaultSession | undefined>(await db(), "sessions", "readonly", (s) => s.get(id));
    },
    async put(session) {
      await run(await db(), "sessions", "readwrite", (s) => s.put(session));
    },
    async remove(id) {
      await run(await db(), "sessions", "readwrite", (s) => s.delete(id));
    },
  };
}

/** Raw access to the small "handles" store (the chosen backup folder lives there). */
export async function handleStore() {
  const db = await openDb();
  return {
    get: (key: string) => run<unknown>(db, "handles", "readonly", (s) => s.get(key)),
    put: (key: string, value: unknown) => run(db, "handles", "readwrite", (s) => s.put(value, key)),
    remove: (key: string) => run(db, "handles", "readwrite", (s) => s.delete(key)),
  };
}

let shared: VaultStore | null = null;
/** The one vault the app uses. Falls back to memory (this tab only) if storage is blocked. */
export function deviceVault(): VaultStore {
  if (shared) return shared;
  shared = typeof indexedDB === "undefined" ? memoryStore() : idbStore();
  return shared;
}
