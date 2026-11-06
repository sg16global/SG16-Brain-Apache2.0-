"use client";

const IDENTITY_KEY = "sg16/identity";

export function identityHeaders(extra: Record<string, string> = {}): Record<string, string> {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    const session = raw ? JSON.parse(raw) as { token?: unknown } : null;
    if (typeof session?.token === "string" && session.token.length <= 4096) {
      return { ...extra, authorization: `Bearer ${session.token}` };
    }
  } catch {
    // Browser storage may be disabled; protected APIs then return 401.
  }
  return extra;
}
