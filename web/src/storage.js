// Localized device storage directory.
//
// The interface's chat history and profile labels are stored locally under
// "sg16/". Requests still go to the configured host, which keeps bounded
// in-memory session context; proxy/platform logging and retention depend on
// deployment. Browser localStorage is not encrypted storage. Users can export
// the local folder, but an export may contain sensitive conversation text.

const NS = "sg16";

export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(`${NS}/${key}`);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`${NS}/${key}`, JSON.stringify(value));
    } catch {
      /* storage may be unavailable (private mode); the app still works */
    }
  },
  del(key) {
    try {
      localStorage.removeItem(`${NS}/${key}`);
    } catch {}
  },
};

export function sessionId() {
  let id = store.get("session");
  if (!id) {
    if (!globalThis.crypto?.randomUUID) {
      throw new Error("A secure browser context is required to create a session.");
    }
    id = `guest-${globalThis.crypto.randomUUID()}`;
    store.set("session", id);
  }
  return id;
}

export function appendHistory(session, entry) {
  const history = store.get(`history/${session}`, []);
  history.push(entry);
  store.set(`history/${session}`, history);
  return history;
}

export function loadHistory(session) {
  return store.get(`history/${session}`, []);
}

// Export the local folder as a single JSON file - the user's own copy.
export function exportLocalFolder(session) {
  const folder = {
    generated: new Date().toISOString(),
    device: "local-only",
    session,
    history: loadHistory(session),
    pass: store.get("pass"),
    identity: store.get("identity"),
    region: store.get("region"),
  };
  const blob = new Blob([JSON.stringify(folder, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sg16-brain-${session}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
