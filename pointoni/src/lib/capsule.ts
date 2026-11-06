// ===================================================================
// DEVICE CAPSULE — the user's own encrypted vault file.
//
// The capsule is sealed in the BROWSER with AES-256-GCM (PBKDF2 250k) and a
// passphrase only the user knows. The downloaded file is readable only with
// that passphrase; however the SOURCE data is the signed-in account archive
// (already stored by the deployment), and restoring uploads decrypted messages
// into the signed-in account's readable database. Deployment logs, backups and
// retention policies still apply.
// ===================================================================

export type CapsuleSession = {
  title: string;
  modelId?: string;
  createdAt?: string;
  messages: { role: string; content: string; modelId?: string; createdAt?: string }[];
};

export type CapsulePayload = {
  kind: "sg16-capsule";
  version: 1;
  sealedAtUtc: string;
  owner: string | null;
  sessions: CapsuleSession[];
};

type SealedCapsule = {
  kind: "sg16-capsule-sealed";
  version: 1;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string };
  data: string; // base64 ciphertext
};

const b64encode = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};
const b64decode = (s: string): Uint8Array => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", iterations, salt: salt as BufferSource },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealCapsule(payload: CapsulePayload, passphrase: string): Promise<string> {
  if (passphrase.length < 12) throw new Error("Passphrase must be at least 12 characters.");
  const iterations = 250_000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const clear = new TextEncoder().encode(JSON.stringify(payload));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, clear);
  const sealed: SealedCapsule = {
    kind: "sg16-capsule-sealed",
    version: 1,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: b64encode(salt) },
    cipher: { name: "AES-GCM", iv: b64encode(iv) },
    data: b64encode(cipher),
  };
  return JSON.stringify(sealed, null, 2);
}

export async function openCapsule(sealedText: string, passphrase: string): Promise<CapsulePayload> {
  const sealed = JSON.parse(sealedText) as SealedCapsule;
  if (sealed.kind !== "sg16-capsule-sealed" || sealed.version !== 1) {
    throw new Error("Not an SG16 capsule file.");
  }
  const key = await deriveKey(passphrase, b64decode(sealed.kdf.salt), sealed.kdf.iterations);
  try {
    const clear = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64decode(sealed.cipher.iv) as BufferSource },
      key,
      b64decode(sealed.data) as BufferSource,
    );
    const payload = JSON.parse(new TextDecoder().decode(clear)) as CapsulePayload;
    if (payload.kind !== "sg16-capsule") throw new Error("bad payload");
    return payload;
  } catch {
    throw new Error("Wrong passphrase or corrupted capsule.");
  }
}

export function downloadCapsule(name: string, sealedJson: string): void {
  const blob = new Blob([sealedJson], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sovereign";
  a.href = url;
  a.download = `${slug}-capsule.sg16.json`;
  a.click();
  URL.revokeObjectURL(url);
}
