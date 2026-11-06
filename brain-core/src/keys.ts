// API keys. Format: sg16_<32 hex>. Only the SHA-256 of a key is stored in KV,
// never the key itself. Every consumer — owner, projects, users — uses the
// same key system; the owner is user #1, with no separate authority path.
import type { KeyRecord } from "./types.ts";

export function newKey(): { key: string } {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return { key: "sg16_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("") };
}

export async function keyHash(key: string): Promise<string> {
  return sha256(key);
}

export async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function isKeyShape(key: string): boolean {
  return /^sg16_[0-9a-f]{32}$/.test(key);
}

export function keyRecord(id: string, user: number, project: string): KeyRecord {
  return { id, user, project, created: Date.now(), revoked: false };
}

export function bearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(sg16_[0-9a-f]{32})$/.exec(header.trim());
  return m ? m[1] : null;
}
