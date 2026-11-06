// Browser-side display and checkout handoff only. This code cannot verify
// payment, issue entitlements, authenticate a location, or grant a server-side
// throttle exemption. Only host-signed records from a confirmed payment or a
// host-verified regional policy are accepted by the server. Browser storage is
// editable and should not be treated as secure.

import { store } from "./storage.js";
import { postJson } from "./api.js";

export const PASSES = {
  day: { label: "24-Hour Entry", price: 3, unit: "/day", hours: 24 },
  week: { label: "1-Week Premium", price: 5, unit: "/week", hours: 24 * 7 },
  half: { label: "15-Day Premium", price: 8, unit: "/15 days", hours: 24 * 15 },
  month: { label: "1-Month Premium", price: 15, unit: "/month", hours: 24 * 30 },
};

export function resolveBilling() {
  // Client locale/timezone and localStorage are not trusted for entitlement.
  return { region: null, humanitarian: false, region_verified: false };
}

export function effectivePrice(pass) {
  return PASSES[pass].price;
}

// Browser identity is never an owner credential. Any server-side owner
// exemption requires the server-only SG16_OWNER_SECRET and is not exposed to
// this client, so the interface never claims a VIP bypass.
export function hasFullSpeedBypass() {
  return false;
}

// ----------------------------------------------------------------------
// Checkout request/confirmation handoff. No local entitlement fallbacks.
// ----------------------------------------------------------------------

function returnUrlFor(pass) {
  const url = new URL(window.location.href);
  url.searchParams.set("dodo_pass", pass);
  url.searchParams.set("dodo_status", "return");
  url.hash = "";
  return url.toString();
}

export function persistPricingStatus(billing) {
  // Pricing status lives exclusively in the on-device sg16/ directory.
  store.set("pricing_status", {
    region: billing.region || "auto",
    humanitarian: !!billing.humanitarian,
    updated_at: new Date().toISOString(),
  });
}

export async function startCheckout(pass) {
  if (!PASSES[pass]) throw new Error("Unknown pass tier.");
  const session = await postJson("/api/dodo/checkout", {
    pass,
    return_url: returnUrlFor(pass),
  });

  if (session.mode === "dodo" && session.checkout_url && session.session_id) {
    store.set("dodo_pending", {
      session_id: session.session_id,
      pass,
      started_at: new Date().toISOString(),
    });
    return { mode: "dodo", checkout_url: session.checkout_url, pass };
  }

  if (
    session.mode === "humanitarian_bypass" && session.record?.token
  ) {
    // Only a host-returned signed record is stored. The server currently
    // issues free regional records only after a trusted proxy assertion.
    store.set("pass", session.record);
    return { mode: session.mode, record: session.record };
  }

  throw new Error("The host did not return a verified checkout or pass record.");
}

export async function confirmDodoReturn() {
  // Called on boot: when the user returns from a Dodo checkout, pick up the
  // signed record and commit it to the local folder.  If the webhook has not
  // landed yet the pending session stays for the next visit.
  const pending = store.get("dodo_pending");
  if (!pending) return null;
  try {
    const result = await postJson("/api/dodo/confirm", {
      session_id: pending.session_id,
    });
    if (result.confirmed && result.record) {
      store.set("pass", result.record);
      store.del("dodo_pending");
      const url = new URL(window.location.href);
      url.searchParams.delete("dodo_status");
      url.searchParams.delete("dodo_pass");
      window.history.replaceState({}, "", url.toString());
      return result.record;
    }
    return null;
  } catch {
    return null;
  }
}

export async function subscribe(pass, identity) {
  const result = await startCheckout(pass, identity);
  return result.record ?? result;
}

export function currentPass() {
  const record = store.get("pass");
  if (!record || typeof record.token !== "string" || !/^[a-f0-9]{64}$/i.test(record.token)) {
    return null;
  }
  const expires = record.expires_at;
  const expiryMs =
    typeof expires === "number" ? expires * 1000 : new Date(expires).getTime();
  if (!Number.isFinite(expiryMs) || expiryMs <= Date.now()) return null;
  return record;
}

// ----------------------------------------------------------------------
// on-device identity attestation (Google / Apple)
// ----------------------------------------------------------------------
async function sha256(message) {
  try {
    if (globalThis.crypto && crypto.subtle) {
      const data = new TextEncoder().encode(message);
      const digest = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch {}
  let h = 5381;
  for (const ch of message) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

export async function saveLocalProfile() {
  const label = window.prompt(
    "Optional label for this browser only. This is not a Google/Apple sign-in, is not verified, and grants no server access."
  );
  if (!label || !label.trim()) return null;
  const normalized = label.trim().slice(0, 80);
  const identity = {
    provider: "local-profile",
    label: normalized,
    hash: await sha256(`sg16-local-profile:${normalized}`),
    created_at: new Date().toISOString(),
  };
  store.set("identity", identity);
  return identity;
}

export function currentIdentity() {
  return store.get("identity");
}

// ----------------------------------------------------------------------
// local API key (client-side entitlement token)
// ----------------------------------------------------------------------
export async function generateApiKey() {
  const identity = currentIdentity() || { hash: "guest" };
  const pass = currentPass() || { pass: "open" };
  const salt = Math.random().toString(36).slice(2, 10);
  const digest = await sha256(`sg16-api:${identity.hash}:${pass.pass}:${salt}`);
  // This is only a local label, not a credential recognized by the server.
  const key = `sg16_local_${digest.slice(0, 32)}`;
  store.set("api_key", key);
  return key;
}

export function currentApiKey() {
  return store.get("api_key");
}
