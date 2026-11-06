"""SG16 BRAIN - server-backed subscription model with Dodo Payments MoR.

This is the authoritative mirror of the client billing structure
(``web/src/billing.js``).  The host re-derives every price and every expiry, so
a client cannot spoof a tier by editing its template: a subscription record is
only valid when its token recomputes against the host secret **and** its
``price_charged`` equals the price the host derives for the claimed tier and
region.

Tiers (identical on both sides, and mapped one-to-one onto Dodo Payments
Merchant-of-Record checkout products):

    day   24-Hour Entry    $3   24 h
    week  1-Week Premium   $5   7 d
    half  15-Day Premium   $8   15 d
    month 1-Month Premium  $15  30 d

Gateway model: ``/api/dodo/checkout`` creates a Dodo checkout session for the
tier's product; Dodo confirms the payment by calling ``/api/dodo/webhook``,
which verifies the Standard Webhooks signature and then signs a duration-locked
token with :func:`record_from_webhook`. The host stores verification state in
process memory and returns the token as an untrusted bearer credential for the
client to retain. Without gateway
credentials, paid checkout is disabled. A zero-rate regional record may only
be issued after a trusted proxy assertion; browser-provided region data is not
authoritative. This module performs no external geolocation.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import logging
import secrets
import time
from dataclasses import dataclass
from typing import Mapping

log = logging.getLogger("sg16.billing")

__all__ = [
    "Pass",
    "PASSES",
    "HUMANITARIAN_REGION",
    "PALESTINE_CODES",
    "WEBHOOK_SUCCESS_EVENTS",
    "effective_price",
    "issue_record",
    "verify_record",
    "verify_webhook_signature",
    "event_payment_object",
    "record_from_webhook",
    "checkout_request_body",
    "is_humanitarian",
    "resolve_region",
    "VerificationError",
]

HUMANITARIAN_REGION = "Palestine"

#: ISO 3166-1 alpha-2 codes that hard-map onto the humanitarian region at the
#: routing layer.  "PS" is Palestine; "PSE" appears on some edge/CDN geo
#: headers.  Any of these bypasses the payment gateway entirely (item 5).
PALESTINE_CODES = frozenset({"PS", "PSE"})

#: Dodo Payments webhook events that complete a purchase.  The signed record is
#: issued on these and on nothing else.
WEBHOOK_SUCCESS_EVENTS = ("payment.succeeded", "checkout.session.completed")


@dataclass(frozen=True)
class Pass:
    id: str
    label: str
    price: int
    hours: int


PASSES: Mapping[str, Pass] = {
    "day": Pass("day", "24-Hour Entry", 3, 24),
    "week": Pass("week", "1-Week Premium", 5, 24 * 7),
    "half": Pass("half", "15-Day Premium", 8, 24 * 15),
    "month": Pass("month", "1-Month Premium", 15, 24 * 30),
}


class VerificationError(ValueError):
    """Raised when a subscription record fails structural cross-verification."""


def effective_price(pass_id: str, region: str | None) -> int:
    """Host-derived price.  Humanitarian region => zero-rate bypass."""
    if pass_id not in PASSES:
        raise VerificationError(f"unknown pass tier: {pass_id!r}")
    if region == HUMANITARIAN_REGION:
        return 0
    return PASSES[pass_id].price


def _token(
    secret: str,
    pass_id: str,
    region: str,
    price: int,
    expires_epoch: int,
    nonce: str,
) -> str:
    message = (
        f"sg16-pass-v1|{pass_id}|{region or ''}|{price}|{expires_epoch}|{nonce}"
    ).encode("utf-8")
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def issue_record(
    pass_id: str,
    region: str | None,
    secret: str,
    provider: str = "guest",
    now: float | None = None,
) -> dict:
    """Create a server-signed subscription record."""
    if pass_id not in PASSES:
        raise VerificationError(f"unknown pass tier: {pass_id!r}")
    now = time.time() if now is None else now
    spec = PASSES[pass_id]
    price = effective_price(pass_id, region)
    expires_epoch = int(now + spec.hours * 3600)
    nonce = secrets.token_urlsafe(18)
    return {
        "pass": pass_id,
        "label": spec.label,
        "provider": provider,
        "region": region,
        "list_price": spec.price,
        "price_charged": price,
        "humanitarian_bypass": region == HUMANITARIAN_REGION,
        "activated_at": int(now),
        "expires_at": expires_epoch,
        "nonce": nonce,
        "token": _token(secret, pass_id, region, price, expires_epoch, nonce),
        "verified_by": "sg16-host",
    }


def verify_record(record: Mapping, secret: str, now: float | None = None) -> dict:
    """Cross-verify a subscription record against the host's own derivation.

    Raises :class:`VerificationError` on any inconsistency: unknown tier,
    price mismatch (spoofed tier/region), forged token, or expiry that does not
    match the tier's duration.
    """
    now = time.time() if now is None else now
    pass_id = record.get("pass")
    if pass_id not in PASSES:
        raise VerificationError(f"unknown pass tier: {pass_id!r}")
    spec = PASSES[pass_id]
    region = record.get("region")

    expected_price = effective_price(pass_id, region)
    if int(record.get("price_charged", -1)) != expected_price:
        raise VerificationError(
            f"price spoofing: record claims {record.get('price_charged')} but "
            f"{pass_id} in {region!r} is {expected_price}"
        )
    if int(record.get("list_price", -1)) != spec.price:
        raise VerificationError("list_price does not match the tier")

    activated = int(record.get("activated_at", 0))
    expires = int(record.get("expires_at", 0))
    if expires - activated != spec.hours * 3600:
        raise VerificationError("expiry does not match the tier duration")
    if expires < now:
        raise VerificationError("subscription expired")

    nonce = record.get("nonce")
    if not isinstance(nonce, str) or not nonce or len(nonce) > 128:
        raise VerificationError("record nonce is missing or invalid")
    expected_token = _token(secret, pass_id, region, expected_price, expires, nonce)
    supplied_token = record.get("token")
    if not isinstance(supplied_token, str) or not hmac.compare_digest(
        supplied_token, expected_token
    ):
        raise VerificationError("token does not recompute - record was not issued by this host")

    return dict(record)


# --------------------------------------------------------------------------
# Geographic interceptor (Palestine humanitarian bypass)
# --------------------------------------------------------------------------
def is_humanitarian(region: str | None) -> bool:
    """True when *region* is the humanitarian zero-rate region."""
    return region == HUMANITARIAN_REGION


def resolve_region(
    payload_region: object = None,
    header_region: str | None = None,
    geo_country: str | None = None,
    *,
    proxy_authenticated: bool = False,
) -> str | None:
    """Resolve only a country code asserted by an authenticated proxy.

    ``payload_region`` and ``header_region`` are retained for source
    compatibility but deliberately ignored: both are user-controlled. The
    caller must first authenticate its trusted proxy, then pass the proxy's
    country code with ``proxy_authenticated=True``.
    """
    del payload_region, header_region
    if (
        proxy_authenticated
        and isinstance(geo_country, str)
        and geo_country.strip().upper() in PALESTINE_CODES
    ):
        return HUMANITARIAN_REGION
    return None


# --------------------------------------------------------------------------
# Dodo Payments MoR webhook pipeline (pure: signing and verification only;
# the network call itself lives in sg16/server/dodo.py, the one package
# member allowed to touch the network)
# --------------------------------------------------------------------------
def _webhook_key(secret: str) -> bytes:
    """Decode a Standard Webhooks signing secret ("whsec_..." -> raw bytes)."""
    raw = secret.strip()
    if raw.startswith("whsec_"):
        raw = raw[len("whsec_"):]
    try:
        return base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        # tolerate operators who stored the raw secret without base64
        return raw.encode("utf-8")


def verify_webhook_signature(
    secret: str,
    webhook_id: str | None,
    webhook_timestamp: str | None,
    webhook_signature: str | None,
    raw_body: bytes,
    now: float | None = None,
    tolerance_seconds: int = 300,
) -> bool:
    """Verify a Dodo Payments webhook exactly as Dodo signs them.

    Dodo uses the Standard Webhooks scheme: ``webhook-id``,
    ``webhook-timestamp`` and ``webhook-signature`` headers; the signed
    content is ``"{webhook-id}.{webhook-timestamp}.{raw body}"``; the key is
    the base64-decoded secret with its ``whsec_`` prefix stripped; signatures
    are ``v1,`` + base64(HMAC-SHA256), space-separated when re-signed.

    Raises :class:`VerificationError` on missing headers, a timestamp outside
    the replay-tolerance window, or a signature that does not recompute.
    Compares in constant time.
    """
    now = time.time() if now is None else now
    if not secret:
        raise VerificationError("no webhook signing secret is configured on this host")
    if not webhook_id or not webhook_timestamp or not webhook_signature:
        raise VerificationError("webhook signature headers are missing or incomplete")
    try:
        sent_at = int(str(webhook_timestamp).strip())
    except ValueError as exc:
        raise VerificationError("webhook-timestamp is not a unix timestamp") from exc
    if abs(now - sent_at) > tolerance_seconds:
        raise VerificationError("webhook-timestamp is outside the replay tolerance window")

    message = f"{webhook_id}.{webhook_timestamp}.".encode("utf-8") + raw_body
    expected = base64.b64encode(
        hmac.new(_webhook_key(secret), message, hashlib.sha256).digest()
    ).decode("ascii")
    for part in str(webhook_signature).split(" "):
        version, _, candidate = part.strip().partition(",")
        if version == "v1" and candidate and hmac.compare_digest(candidate, expected):
            return True
    raise VerificationError("webhook signature does not verify against the configured secret")


def event_payment_object(event: Mapping) -> dict:
    """Extract the payment object from a webhook event body.

    Dodo payloads place the object at ``event["data"]``; some documented
    variants nest it at ``event["data"]["object"]``.  Both are accepted.
    """
    data = event.get("data")
    if isinstance(data, Mapping):
        inner = data.get("object")
        if isinstance(inner, Mapping):
            return dict(inner)
        return dict(data)
    return {}


def record_from_webhook(
    event: Mapping,
    secret: str,
    now: float | None = None,
    provider: str = "dodo",
    product_ids: Mapping[str, str] | None = None,
) -> dict:
    """Turn a *verified* success event into a signed, duration-locked record.

    The pass tier and region travel in the checkout metadata (``sg16_pass``,
    ``sg16_region``).  Checks, in order of authority:

    1. **Product** (primary): when ``product_ids`` maps the tier to a Dodo
       product id, the payment's ``product_cart`` must contain it.
    2. **Amount**: a USD payment must equal the host price exactly (smallest
       unit, 300 == $3.00).  Dodo may charge in the customer's local currency
       (adaptive pricing), so for any other currency the payment's
       ``settlement_amount`` is used when ``settlement_currency`` is USD (it is
       net of conversion and fees, so only ``> 0`` is required); with no USD
       settlement field the charged amount must be ``> 0`` and a warning is
       logged.

    Humanitarian tiers are structurally impossible through the gateway and
    are rejected outright - the bypass never charges.
    """
    event_type = str(event.get("type", ""))
    if event_type not in WEBHOOK_SUCCESS_EVENTS:
        raise VerificationError(f"unsupported webhook event: {event_type!r}")

    payment = event_payment_object(event)
    metadata = payment.get("metadata") or {}
    if not isinstance(metadata, Mapping):
        metadata = {}

    pass_id = str(metadata.get("sg16_pass") or "")
    region = metadata.get("sg16_region") or None
    if pass_id not in PASSES:
        raise VerificationError(
            f"webhook metadata does not name a known pass tier: {pass_id!r}"
        )
    if is_humanitarian(region):
        raise VerificationError(
            "humanitarian passes are never charged through the gateway; "
            "issue them through the local bypass instead"
        )

    expected_product = (product_ids or {}).get(pass_id)
    if expected_product:
        cart = payment.get("product_cart")
        seen = {
            str(item.get("product_id"))
            for item in (cart if isinstance(cart, list) else [])
            if isinstance(item, Mapping)
        }
        if payment.get("product_id"):
            seen.add(str(payment["product_id"]))
        if expected_product not in seen:
            raise VerificationError(
                f"payment does not contain the product configured for {pass_id!r}"
            )

    amount = payment.get("amount", payment.get("total_amount"))
    if amount is None:
        raise VerificationError("payment amount is missing")
    try:
        paid = int(amount)
    except (TypeError, ValueError) as exc:
        raise VerificationError("payment amount is not an integer") from exc
    currency = str(payment.get("currency") or payment.get("currency_code") or "").upper()
    if currency == "USD":
        if paid != PASSES[pass_id].price * 100:
            raise VerificationError(
                f"paid amount {paid} does not match the host price for {pass_id!r}"
            )
    else:
        settle_currency = str(payment.get("settlement_currency") or "").upper()
        settle_amount = payment.get("settlement_amount")
        if (
            settle_currency == "USD"
            and isinstance(settle_amount, int)
            and not isinstance(settle_amount, bool)
        ):
            if settle_amount <= 0:
                raise VerificationError("USD settlement amount must be greater than zero")
            log.info(
                "accepted %s payment for %r via USD settlement %s (charged %s %s)",
                currency or "unknown-currency", pass_id, settle_amount, paid, currency,
            )
        else:
            if paid <= 0:
                raise VerificationError("payment amount must be greater than zero")
            log.warning(
                "payment for %r charged in %r with no USD settlement field; "
                "accepted on product match and amount > 0 only",
                pass_id, currency or "unknown",
            )

    return issue_record(pass_id, region, secret, provider=provider, now=now)


def checkout_request_body(
    product_id: str | None,
    pass_id: str,
    region: str | None,
    return_url: str | None = None,
    metadata: Mapping | None = None,
) -> dict:
    """Build the Dodo Payments create-checkout-session request body.

    One pass = one product, quantity 1, with the SG16 metadata that the
    webhook verification later consumes.
    """
    if pass_id not in PASSES:
        raise VerificationError(f"unknown pass tier: {pass_id!r}")
    if not product_id:
        raise VerificationError(
            f"no Dodo product id is configured on this host for tier {pass_id!r}"
        )
    body = {
        "product_cart": [{"product_id": str(product_id), "quantity": 1}],
        "metadata": {
            "sg16_pass": pass_id,
            "sg16_region": region or "",
            **dict(metadata or {}),
        },
    }
    if return_url:
        body["return_url"] = str(return_url)
    return body
