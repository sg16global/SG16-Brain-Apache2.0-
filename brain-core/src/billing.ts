// SG16 BRAIN CORE — billing math, ported verbatim from sg16/billing.py.
//
// Pure, stateless, no network: pass tiers, host-derived prices, the signed
// duration-locked pass record, and Dodo Payments' Standard Webhooks signature
// verification. The network call to Dodo lives in billing-routes.ts.
//
// A pass record is only valid when its token recomputes against the billing
// secret AND every derived field (price, duration) matches the host's own
// derivation — a client cannot spoof a tier by editing the record.

// ---------------------------------------------------------------- passes

export interface PassSpec {
  id: string;
  label: string;
  price: number; // USD
  hours: number;
}

export const PASSES: Record<string, PassSpec> = {
  day: { id: "day", label: "24-Hour Entry", price: 3, hours: 24 },
  week: { id: "week", label: "1-Week Premium", price: 5, hours: 24 * 7 },
  half: { id: "half", label: "15-Day Premium", price: 8, hours: 24 * 15 },
  month: { id: "month", label: "1-Month Premium", price: 15, hours: 24 * 30 },
};

export const HUMANITARIAN_REGION = "Palestine";
// ISO 3166-1 alpha-2 codes that hard-map onto the humanitarian region.
// "PS" is Palestine; "PSE" appears on some edge/CDN geo headers.
export const PALESTINE_CODES = new Set(["PS", "PSE"]);

// Dodo Payments webhook events that complete a purchase.
export const WEBHOOK_SUCCESS_EVENTS = new Set(["payment.succeeded", "checkout.session.completed"]);

export class VerificationError extends Error {}

export function effectivePrice(passId: string, region: string | null): number {
  // Host-derived price. Humanitarian region => zero-rate bypass.
  const spec = PASSES[passId];
  if (!spec) throw new VerificationError(`unknown pass tier: ${JSON.stringify(passId)}`);
  if (region === HUMANITARIAN_REGION) return 0;
  return spec.price;
}

export function isHumanitarian(region: string | null): boolean {
  return region === HUMANITARIAN_REGION;
}

// ---------------------------------------------------------------- hashing

const encoder = new TextEncoder();

/** Copy a typed array into a standalone ArrayBuffer (acceptable BufferSource). */
function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(view.byteLength);
  new Uint8Array(buffer).set(view);
  return buffer;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(encoder.encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, toArrayBuffer(encoder.encode(message)));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacBase64(keyBytes: Uint8Array, message: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, toArrayBuffer(message));
  let binary = "";
  for (const b of new Uint8Array(mac)) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Timing-safe string compare: compare digests, not the strings themselves. */
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  if (a.length !== b.length) return false;
  const da = new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(encoder.encode(a))));
  const db = new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(encoder.encode(b))));
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
  return diff === 0;
}

// ---------------------------------------------------------------- records

export interface PassRecord {
  pass: string;
  label: string;
  provider: string;
  region: string | null;
  list_price: number;
  price_charged: number;
  humanitarian_bypass: boolean;
  activated_at: number;
  expires_at: number;
  nonce: string;
  token: string;
  verified_by: string;
}

async function recordToken(
  secret: string,
  passId: string,
  region: string | null,
  price: number,
  expiresEpoch: number,
  nonce: string,
): Promise<string> {
  const message = `sg16-pass-v1|${passId}|${region ?? ""}|${price}|${expiresEpoch}|${nonce}`;
  return hmacHex(secret, message);
}

function randomNonce(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function issueRecord(
  passId: string,
  region: string | null,
  secret: string,
  provider = "guest",
  now = Date.now() / 1000,
): Promise<PassRecord> {
  const spec = PASSES[passId];
  if (!spec) throw new VerificationError(`unknown pass tier: ${JSON.stringify(passId)}`);
  const price = effectivePrice(passId, region);
  const expiresEpoch = Math.floor(now + spec.hours * 3600);
  const nonce = randomNonce();
  return {
    pass: passId,
    label: spec.label,
    provider,
    region,
    list_price: spec.price,
    price_charged: price,
    humanitarian_bypass: region === HUMANITARIAN_REGION,
    activated_at: Math.floor(now),
    expires_at: expiresEpoch,
    nonce,
    token: await recordToken(secret, passId, region, price, expiresEpoch, nonce),
    verified_by: "sg16-host",
  };
}

export async function verifyRecord(
  record: Record<string, unknown>,
  secret: string,
  now = Date.now() / 1000,
): Promise<PassRecord> {
  const passId = record.pass;
  const spec = PASSES[passId as string];
  if (!spec) throw new VerificationError(`unknown pass tier: ${JSON.stringify(passId)}`);
  const region = (record.region as string | null) ?? null;

  const expectedPrice = effectivePrice(passId as string, region);
  if (Number(record.price_charged ?? -1) !== expectedPrice) {
    throw new VerificationError(
      `price spoofing: record claims ${record.price_charged} but ${passId} in ${JSON.stringify(region)} is ${expectedPrice}`,
    );
  }
  if (Number(record.list_price ?? -1) !== spec.price) {
    throw new VerificationError("list_price does not match the tier");
  }

  const activated = Number(record.activated_at ?? 0);
  const expires = Number(record.expires_at ?? 0);
  if (expires - activated !== spec.hours * 3600) {
    throw new VerificationError("expiry does not match the tier duration");
  }
  if (expires < now) throw new VerificationError("subscription expired");

  const nonce = record.nonce;
  if (typeof nonce !== "string" || !nonce || nonce.length > 128) {
    throw new VerificationError("record nonce is missing or invalid");
  }
  const expectedToken = await recordToken(secret, passId as string, region, expectedPrice, expires, nonce);
  const supplied = record.token;
  if (typeof supplied !== "string" || !(await constantTimeEqual(supplied, expectedToken))) {
    throw new VerificationError("token does not recompute - record was not issued by this host");
  }
  return record as unknown as PassRecord;
}

// ---------------------------------------------------------------- webhook

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function webhookKey(secret: string): Uint8Array {
  // Standard Webhooks signing secret ("whsec_..." -> base64 -> raw bytes).
  let raw = secret.trim();
  if (raw.startsWith("whsec_")) raw = raw.slice("whsec_".length);
  try {
    return base64ToBytes(raw);
  } catch {
    // tolerate operators who stored the raw secret without base64
    return encoder.encode(raw);
  }
}

export async function verifyWebhookSignature(
  secret: string,
  webhookId: string | null,
  webhookTimestamp: string | null,
  webhookSignature: string | null,
  rawBody: string,
  now = Date.now() / 1000,
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!secret) throw new VerificationError("no webhook signing secret is configured on this host");
  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    throw new VerificationError("webhook signature headers are missing or incomplete");
  }
  const sentAt = Number(String(webhookTimestamp).trim());
  if (!Number.isFinite(sentAt)) throw new VerificationError("webhook-timestamp is not a unix timestamp");
  if (Math.abs(now - sentAt) > toleranceSeconds) {
    throw new VerificationError("webhook-timestamp is outside the replay tolerance window");
  }
  const message = encoder.encode(`${webhookId}.${webhookTimestamp}.`);
  const body = encoder.encode(rawBody);
  const payload = new Uint8Array(message.length + body.length);
  payload.set(message, 0);
  payload.set(body, message.length);
  const expected = await hmacBase64(webhookKey(secret), payload);
  for (const part of String(webhookSignature).split(" ")) {
    const sep = part.trim().indexOf(",");
    if (sep === -1) continue;
    const version = part.slice(0, sep);
    const candidate = part.slice(sep + 1);
    if (version === "v1" && candidate && (await constantTimeEqual(candidate, expected))) return true;
  }
  throw new VerificationError("webhook signature does not verify against the configured secret");
}

export function eventPaymentObject(event: Record<string, unknown>): Record<string, unknown> {
  // Dodo payloads place the object at event["data"]; some variants nest it
  // at event["data"]["object"]. Both are accepted.
  const data = event.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const inner = (data as Record<string, unknown>).object;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      return inner as Record<string, unknown>;
    }
    return data as Record<string, unknown>;
  }
  return {};
}

export async function recordFromWebhook(
  event: Record<string, unknown>,
  secret: string,
  now = Date.now() / 1000,
  productIds: Record<string, string> = {},
): Promise<PassRecord> {
  const eventType = String(event.type ?? "");
  if (!WEBHOOK_SUCCESS_EVENTS.has(eventType)) {
    throw new VerificationError(`unsupported webhook event: ${JSON.stringify(eventType)}`);
  }

  const payment = eventPaymentObject(event);
  const metadataRaw = payment.metadata;
  const metadata =
    metadataRaw && typeof metadataRaw === "object" && !Array.isArray(metadataRaw)
      ? (metadataRaw as Record<string, unknown>)
      : {};

  const passId = String(metadata.sg16_pass ?? "");
  const region = (metadata.sg16_region as string) || null;
  if (!PASSES[passId]) {
    throw new VerificationError(`webhook metadata does not name a known pass tier: ${JSON.stringify(passId)}`);
  }
  if (isHumanitarian(region)) {
    throw new VerificationError(
      "humanitarian passes are never charged through the gateway; issue them through the local bypass instead",
    );
  }

  const expectedProduct = productIds[passId];
  if (expectedProduct) {
    const seen = new Set<string>();
    const cart = payment.product_cart;
    if (Array.isArray(cart)) {
      for (const item of cart) {
        if (item && typeof item === "object" && typeof (item as any).product_id !== "undefined") {
          seen.add(String((item as any).product_id));
        }
      }
    }
    if (payment.product_id) seen.add(String(payment.product_id));
    if (!seen.has(expectedProduct)) {
      throw new VerificationError(`payment does not contain the product configured for ${JSON.stringify(passId)}`);
    }
  }

  const amount = payment.amount ?? payment.total_amount;
  if (amount === undefined || amount === null) throw new VerificationError("payment amount is missing");
  const paid = Number(amount);
  if (!Number.isInteger(paid)) throw new VerificationError("payment amount is not an integer");
  const currency = String(payment.currency ?? payment.currency_code ?? "").toUpperCase();
  if (currency === "USD") {
    if (paid !== PASSES[passId].price * 100) {
      throw new VerificationError(`paid amount ${paid} does not match the host price for ${JSON.stringify(passId)}`);
    }
  } else {
    const settleCurrency = String(payment.settlement_currency ?? "").toUpperCase();
    const settleAmount = Number(payment.settlement_amount ?? NaN);
    if (settleCurrency === "USD" && Number.isInteger(settleAmount)) {
      if (settleAmount <= 0) {
        throw new VerificationError("USD settlement amount must be greater than zero");
      }
    } else {
      if (paid <= 0) throw new VerificationError("payment amount must be greater than zero");
    }
  }

  return issueRecord(passId, region, secret, "dodo", now);
}

// ---------------------------------------------------------------- checkout

export function checkoutRequestBody(
  productId: string | undefined,
  passId: string,
  region: string | null,
  returnUrl: string | null,
  metadata: Record<string, string> = {},
): Record<string, unknown> {
  const spec = PASSES[passId];
  if (!spec) throw new VerificationError(`unknown pass tier: ${JSON.stringify(passId)}`);
  if (!productId) {
    throw new VerificationError(`no Dodo product id is configured on this host for tier ${passId}`);
  }
  const body: Record<string, unknown> = {
    product_cart: [{ product_id: String(productId), quantity: 1 }],
    metadata: {
      sg16_pass: passId,
      sg16_region: region ?? "",
      ...metadata,
    },
  };
  if (returnUrl) body.return_url = String(returnUrl);
  return body;
}
