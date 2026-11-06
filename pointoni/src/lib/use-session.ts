"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { identityHeaders } from "@/lib/browser-identity";

const IDENTITY_KEY = "sg16/identity";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener("sg16-identity", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("sg16-identity", onChange);
  };
}

function hasIdentity(): boolean {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    return Boolean(raw && (JSON.parse(raw) as { token?: unknown }).token);
  } catch {
    return false;
  }
}

/** True only when this device really holds a sign-in token (never for a plain visitor). */
export function useSignedIn(): boolean {
  return useSyncExternalStore(subscribe, hasIdentity, () => false);
}

/** Call after changing the stored identity so every listener re-reads it. */
export function announceIdentityChange() {
  window.dispatchEvent(new Event("sg16-identity"));
}

/**
 * Whether the signed-in account is an operator. null = still checking / not signed in.
 * The server decides (SG16_ADMIN_EMAILS); this only mirrors its answer to show or hide links.
 */
export function useAdmin(): boolean | null {
  const signedIn = useSignedIn();
  const [admin, setAdmin] = useState<boolean | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    fetch("/api/identity", {
      method: "POST",
      headers: identityHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ action: "me" }),
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { admin?: boolean } | null) => {
        if (alive) setAdmin(Boolean(d?.admin));
      })
      .catch(() => {
        if (alive) setAdmin(false);
      });
    return () => {
      alive = false;
    };
  }, [signedIn]);
  return signedIn ? admin : null;
}
