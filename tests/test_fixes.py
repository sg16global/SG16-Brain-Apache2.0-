"""Regression tests for the production-hardening deploy.

Covers:

* **Bug #1** - deep arithmetic chains are bounded to the structural
  input-error token; the brain answers with a canonical deferral instead of
  an unhandled ``RecursionError`` on the socket.
* **Bug #2** - malformed audio (broken envelope, bad WAVE container, junk
  PCM) is a predictable 400 validation on both ``/api/audio`` and
  ``/api/ingest``.
* **Dodo Payments MoR pipeline** - Standard Webhooks signature verification,
  duration-locked record signing, client pickup, and rejection of tampered,
  stale, mismatched or humanitarian-charged events.
* **Regional billing trust** - browser payloads and region headers are ignored;
  only country metadata asserted by an authenticated proxy can grant a $0
  humanitarian record. Paid checkout fails closed when Dodo is unavailable.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import http.client
import json
import threading
import time
import unittest
from unittest.mock import patch

from sg16 import billing
from sg16.brain import SG16Brain
from sg16.calc import INPUT_ERROR_TOKEN, try_evaluate
from sg16.config import BrainConfig
from sg16.server.app import build_server

SECRET = "sg16-sovereign-dev-secret"
WHSEC = "whsec_" + base64.b64encode(b"0123456789abcdef0123456789ab").decode()


def _deep_chain() -> str:
    """A 4,001-character arithmetic chain - inside the 4,096 char cap, past
    the interpreter recursion limit when walked as a BinOp tree."""
    return "1" + "+1" * 2000


# --------------------------------------------------------------------------
# Bug #1: the safe-compute bound
# --------------------------------------------------------------------------
class CalcBoundTests(unittest.TestCase):
    def test_deep_chain_returns_the_bound_token(self) -> None:
        self.assertEqual(try_evaluate(_deep_chain()), INPUT_ERROR_TOKEN)

    def test_deep_chain_as_question_returns_the_bound_token(self) -> None:
        self.assertEqual(try_evaluate(_deep_chain() + "?"), INPUT_ERROR_TOKEN)

    def test_deep_product_chain_is_also_bounded(self) -> None:
        self.assertEqual(try_evaluate("9" + "*9" * 2000), INPUT_ERROR_TOKEN)

    def test_normal_arithmetic_still_computes(self) -> None:
        self.assertEqual(try_evaluate("23*7+4"), "165")

    def test_non_arithmetic_text_is_none(self) -> None:
        self.assertIsNone(try_evaluate("what is the capital of France"))

    def test_brain_defers_instead_of_crashing(self) -> None:
        brain = SG16Brain()
        tx = brain.submit(_deep_chain() + "?", session_id="calc-bound")
        self.assertEqual(tx.response.stage, "deferred")
        self.assertIn("safe compute bound", tx.response.text)
        self.assertNotIn("1+1+1", tx.response.text)  # never echoes the payload


# --------------------------------------------------------------------------
# Dodo webhook signature + record signing (pure layer)
# --------------------------------------------------------------------------
def _sign_webhook(
    secret: str,
    event: dict,
    msg_id: str = "msg_test_0001",
    when: int | None = None,
):
    body = json.dumps(event).encode("utf-8")
    timestamp = str(int(time.time()) if when is None else when)
    key = base64.b64decode(secret.removeprefix("whsec_"))
    message = f"{msg_id}.{timestamp}.".encode("utf-8") + body
    signature = base64.b64encode(hmac.new(key, message, hashlib.sha256).digest()).decode()
    return body, {
        "webhook-id": msg_id,
        "webhook-timestamp": timestamp,
        "webhook-signature": f"v1,{signature}",
    }


def _success_event(
    pass_id: str = "week",
    region: str | None = "Malaysia",
    amount: int = 500,
    product_id: str | None = "pds_test_week",
) -> dict:
    return {
        "id": "evt_test_1",
        "type": "payment.succeeded",
        "timestamp": "2026-01-01T00:00:00Z",
        "data": {
            "payment_id": "pay_test_1",
            "session_id": "sess_test_1",
            "amount": amount,
            "currency": "usd",
            "product_cart": [{"product_id": product_id, "quantity": 1}] if product_id else [],
            "metadata": {
                "sg16_pass": pass_id,
                "sg16_region": region or "",
                "sg16_checkout_ref": "sess_test_1",
            },
        },
    }


class WebhookSignatureTests(unittest.TestCase):
    def test_valid_signature_verifies(self) -> None:
        body, headers = _sign_webhook(WHSEC, _success_event())
        self.assertTrue(
            billing.verify_webhook_signature(
                WHSEC,
                headers["webhook-id"],
                headers["webhook-timestamp"],
                headers["webhook-signature"],
                body,
            )
        )

    def test_tampered_body_is_rejected(self) -> None:
        body, headers = _sign_webhook(WHSEC, _success_event())
        with self.assertRaises(billing.VerificationError):
            billing.verify_webhook_signature(
                WHSEC,
                headers["webhook-id"],
                headers["webhook-timestamp"],
                headers["webhook-signature"],
                body + b" ",
            )

    def test_stale_timestamp_is_rejected(self) -> None:
        body, headers = _sign_webhook(WHSEC, _success_event(), when=int(time.time()) - 4000)
        with self.assertRaises(billing.VerificationError):
            billing.verify_webhook_signature(
                WHSEC,
                headers["webhook-id"],
                headers["webhook-timestamp"],
                headers["webhook-signature"],
                body,
            )

    def test_missing_headers_are_rejected(self) -> None:
        body, headers = _sign_webhook(WHSEC, _success_event())
        with self.assertRaises(billing.VerificationError):
            billing.verify_webhook_signature(
                WHSEC, None, headers["webhook-timestamp"], headers["webhook-signature"], body
            )

    def test_wrong_secret_is_rejected(self) -> None:
        body, headers = _sign_webhook(WHSEC, _success_event())
        other = "whsec_" + base64.b64encode(b"zzzzzzzzzzzzzzzzzzzzzzzzzzzz").decode()
        with self.assertRaises(billing.VerificationError):
            billing.verify_webhook_signature(
                other,
                headers["webhook-id"],
                headers["webhook-timestamp"],
                headers["webhook-signature"],
                body,
            )

    def test_record_from_webhook_is_duration_locked(self) -> None:
        record = billing.record_from_webhook(
            _success_event(pass_id="half", amount=800), SECRET
        )
        self.assertEqual(record["pass"], "half")
        self.assertEqual(record["price_charged"], 8)
        self.assertEqual(record["expires_at"] - record["activated_at"], 24 * 15 * 3600)
        billing.verify_record(record, SECRET)  # token recomputes against the host secret

    def test_record_rejects_amount_mismatch(self) -> None:
        with self.assertRaises(billing.VerificationError):
            billing.record_from_webhook(_success_event(pass_id="half", amount=500), SECRET)

    def test_record_rejects_missing_payment_amount(self) -> None:
        event = _success_event()
        event["data"].pop("amount")
        with self.assertRaisesRegex(billing.VerificationError, "amount is missing"):
            billing.record_from_webhook(event, SECRET)

    def test_non_usd_charge_uses_usd_settlement_amount(self) -> None:
        # Dodo charged MYR (RM12.71) for a USD $3 product: settlement is the USD view
        event = _success_event(pass_id="day", amount=1271, product_id="pdt_day")
        event["data"].update({"currency": "MYR", "settlement_currency": "USD", "settlement_amount": 281})
        record = billing.record_from_webhook(event, SECRET, product_ids={"day": "pdt_day"})
        self.assertEqual(record["pass"], "day")

    def test_non_usd_charge_with_zero_usd_settlement_is_rejected(self) -> None:
        event = _success_event(pass_id="day", amount=1271)
        event["data"].update({"currency": "MYR", "settlement_currency": "USD", "settlement_amount": 0})
        with self.assertRaisesRegex(billing.VerificationError, "settlement"):
            billing.record_from_webhook(event, SECRET)

    def test_non_usd_charge_without_settlement_warns_and_needs_positive_amount(self) -> None:
        event = _success_event(pass_id="day", amount=1271)
        event["data"]["currency"] = "MYR"
        with self.assertLogs("sg16.billing", level="WARNING"):
            self.assertEqual(billing.record_from_webhook(event, SECRET)["pass"], "day")
        event["data"]["amount"] = 0
        with self.assertRaisesRegex(billing.VerificationError, "greater than zero"):
            billing.record_from_webhook(event, SECRET)

    def test_non_usd_settlement_in_another_currency_falls_back_to_warning_path(self) -> None:
        event = _success_event(pass_id="day", amount=1271)
        event["data"].update({"currency": "MYR", "settlement_currency": "MYR", "settlement_amount": 1200})
        with self.assertLogs("sg16.billing", level="WARNING"):
            billing.record_from_webhook(event, SECRET)

    def test_usd_requires_exact_amount_even_with_settlement_fields(self) -> None:
        event = _success_event(pass_id="day", amount=299)
        event["data"].update({"settlement_currency": "USD", "settlement_amount": 300})
        with self.assertRaisesRegex(billing.VerificationError, "does not match"):
            billing.record_from_webhook(event, SECRET)

    def test_product_id_is_the_primary_check(self) -> None:
        ids = {"week": "pds_test_week"}
        billing.record_from_webhook(_success_event(), SECRET, product_ids=ids)
        with self.assertRaisesRegex(billing.VerificationError, "product"):
            billing.record_from_webhook(_success_event(product_id="pds_other"), SECRET, product_ids=ids)
        with self.assertRaisesRegex(billing.VerificationError, "product"):
            billing.record_from_webhook(_success_event(product_id=None), SECRET, product_ids=ids)
        # a tier with no configured product id is not product-checked
        billing.record_from_webhook(_success_event(product_id=None), SECRET, product_ids={"week": ""})

    def test_record_rejects_unknown_tier(self) -> None:
        with self.assertRaises(billing.VerificationError):
            billing.record_from_webhook(_success_event(pass_id="lifetime"), SECRET)

    def test_record_rejects_humanitarian_charge(self) -> None:
        # the bypass never charges: a paid Palestine event is structurally invalid
        with self.assertRaises(billing.VerificationError):
            billing.record_from_webhook(_success_event(region="Palestine", amount=0), SECRET)

    def test_non_success_event_is_rejected(self) -> None:
        with self.assertRaises(billing.VerificationError):
            billing.record_from_webhook({"type": "payment.failed", "data": {}}, SECRET)


# --------------------------------------------------------------------------
# Geographic interceptor (pure layer)
# --------------------------------------------------------------------------
class RegionInterceptorTests(unittest.TestCase):
    def test_client_payload_and_region_headers_are_ignored(self) -> None:
        self.assertIsNone(billing.resolve_region("Palestine", "Palestine", None))

    def test_country_code_requires_an_authenticated_proxy(self) -> None:
        self.assertIsNone(billing.resolve_region(None, None, "PS"))
        self.assertEqual(
            billing.resolve_region(None, None, "ps", proxy_authenticated=True),
            "Palestine",
        )
        self.assertEqual(
            billing.resolve_region(None, None, "PSE", proxy_authenticated=True),
            "Palestine",
        )

    def test_other_geo_codes_do_not_invent_a_region(self) -> None:
        self.assertIsNone(
            billing.resolve_region(None, None, "MY", proxy_authenticated=True)
        )

    def test_palestine_code_set(self) -> None:
        self.assertEqual(billing.PALESTINE_CODES, frozenset({"PS", "PSE"}))


# --------------------------------------------------------------------------
# HTTP integration fixtures
# --------------------------------------------------------------------------
class ServerFixture(unittest.TestCase):
    config: BrainConfig

    @classmethod
    def setUpClass(cls) -> None:
        cls.server = build_server(cls.config, host="127.0.0.1", port=0)
        cls.host, cls.port = cls.server.server_address[0], cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()

    def request(self, method: str, path: str, body=None, headers: dict | None = None):
        conn = http.client.HTTPConnection(self.host, self.port, timeout=10)
        send_headers = dict(headers or {})
        if isinstance(body, (dict, list)):
            payload = json.dumps(body).encode("utf-8")
            send_headers.setdefault("Content-Type", "application/json")
        elif isinstance(body, bytes):
            payload = body
        else:
            payload = None
        conn.request(method, path, body=payload, headers=send_headers)
        response = conn.getresponse()
        raw = response.read()
        conn.close()
        return response.status, dict(response.getheaders()), raw


class HardenedServerTests(ServerFixture):
    """Default config: no Dodo credentials; paid checkout fails closed."""

    config = BrainConfig.default()

    def test_listen_backlog_is_production_sized(self) -> None:
        """Regression: the socketserver default backlog of 5 reset connections
        under a browser's parallel first-paint fetches (HTML + modules + assets
        open at once), surfacing client-side as sudden connection "crashes".
        The host must carry a real accept backlog."""
        from sg16.server.app import BrainHTTPServer

        self.assertGreaterEqual(BrainHTTPServer.request_queue_size, 128)

    # -- Bug #1 over HTTP ---------------------------------------------------
    def test_deep_chain_ingest_is_answered_not_crashed(self) -> None:
        status, _, raw = self.request(
            "POST", "/api/ingest", {"text": _deep_chain() + "?", "session_id": "fix-deep"}
        )
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)["stage"], "deferred")

    # -- Bug #2 over HTTP ---------------------------------------------------
    def test_malformed_wave_on_audio_route_is_400(self) -> None:
        junk = b"RIFF\x24\x00\x00\x00WAVEjunkjunk"
        status, _, raw = self.request(
            "POST", "/api/audio", junk, {"X-Session-Id": "fix-wav"}
        )
        self.assertEqual(status, 400)
        self.assertIn("audio payload rejected", json.loads(raw)["error"])

    def test_envelope_without_audio_is_400(self) -> None:
        payload = b"SG16A\x01" + (2).to_bytes(4, "big") + b"{}"
        status, _, raw = self.request(
            "POST", "/api/audio", payload, {"X-Session-Id": "fix-env"}
        )
        self.assertEqual(status, 400)

    def test_malformed_wave_via_ingest_is_400(self) -> None:
        junk = b"RIFF\x10\x00\x00\x00WAVEbroken"
        status, _, raw = self.request(
            "POST",
            "/api/ingest",
            {
                "text": "",
                "session_id": "fix-b64",
                "audio_b64": base64.b64encode(junk).decode(),
            },
        )
        self.assertEqual(status, 400)
        self.assertIn("audio payload rejected", json.loads(raw)["error"])

    # -- Regional trust and fail-closed checkout over HTTP ------------------
    def test_client_region_claim_cannot_mint_a_free_pass(self) -> None:
        status, _, raw = self.request(
            "POST",
            "/api/dodo/checkout",
            {"pass": "month", "region": "Palestine", "session_id": "fix-ps-1"},
        )
        self.assertEqual(status, 503)
        self.assertIn("not configured", json.loads(raw)["error"])

    def test_geo_country_requires_authenticated_proxy(self) -> None:
        status, _, _ = self.request(
            "POST",
            "/api/dodo/checkout",
            {"pass": "week", "session_id": "fix-ps-2"},
            {"CF-IPCountry": "PS"},
        )
        self.assertEqual(status, 503)

    def test_authenticated_proxy_can_issue_humanitarian_record(self) -> None:
        with patch.dict("os.environ", {"SG16_PROXY_AUTH_SECRET": "proxy-test-secret"}):
            status, _, raw = self.request(
                "POST",
                "/api/dodo/checkout",
                {"pass": "month", "region": "Malaysia", "session_id": "fix-ps-3"},
                {"X-SG16-Proxy-Auth": "proxy-test-secret", "CF-IPCountry": "PS"},
            )
        self.assertEqual(status, 200)
        data = json.loads(raw)
        self.assertEqual(data["mode"], "humanitarian_bypass")
        record = data["record"]
        self.assertEqual(record["price_charged"], 0)
        self.assertTrue(record["humanitarian_bypass"])
        self.assertEqual(record["expires_at"] - record["activated_at"], 24 * 30 * 3600)

    def test_subscribe_rejects_client_region_claim(self) -> None:
        status, _, raw = self.request(
            "POST",
            "/api/subscribe",
            {"pass": "day", "region": "Palestine"},
            {"X-SG16-Region": "Palestine"},
        )
        self.assertEqual(status, 403)

    def test_authenticated_proxy_can_issue_regional_record(self) -> None:
        with patch.dict("os.environ", {"SG16_PROXY_AUTH_SECRET": "proxy-test-secret"}):
            status, _, raw = self.request(
                "POST",
                "/api/subscribe",
                {"pass": "day"},
                {"X-SG16-Proxy-Auth": "proxy-test-secret", "X-Vercel-IP-Country": "PSE"},
            )
        self.assertEqual(status, 200)
        record = json.loads(raw)
        self.assertEqual(record["price_charged"], 0)
        billing.verify_record(record, self.server.billing_secret)

    def test_pass_verification_requires_a_host_registered_signed_record(self) -> None:
        record = billing.issue_record("day", "Malaysia", self.server.billing_secret)
        self.server.passes[record["token"]] = record
        status, _, raw = self.request("POST", "/api/pass/verify", {"token": record["token"]})
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(raw)["valid"])

        status, _, raw = self.request("POST", "/api/pass/verify", {"token": "f" * 64})
        self.assertEqual(status, 403)

    def test_checkout_without_credentials_fails_closed(self) -> None:
        status, _, raw = self.request(
            "POST",
            "/api/dodo/checkout",
            {"pass": "week", "region": "Malaysia", "session_id": "fix-local-1"},
        )
        self.assertEqual(status, 503)
        self.assertIn("not configured", json.loads(raw)["error"])

    def test_checkout_unknown_tier_is_400(self) -> None:
        status, _, _ = self.request(
            "POST",
            "/api/dodo/checkout",
            {"pass": "lifetime", "region": None, "session_id": "fix-bad"},
        )
        self.assertEqual(status, 400)

    def test_webhook_without_secret_is_503(self) -> None:
        status, _, raw = self.request("POST", "/api/dodo/webhook", b"{}")
        self.assertEqual(status, 503)

    def test_billing_manifest_exposes_the_gateway_block(self) -> None:
        status, _, raw = self.request("GET", "/api/billing")
        self.assertEqual(status, 200)
        gateway = json.loads(raw)["gateway"]
        self.assertEqual(gateway["provider"], "dodo-payments")
        self.assertEqual(gateway["mode"], "disabled")
        self.assertEqual(gateway["paid_checkout_without_gateway"], "disabled; no local paid passes are issued")
        self.assertEqual(gateway["endpoints"]["webhook"], "/api/dodo/webhook")


class DodoPipelineServerTests(ServerFixture):
    """Gateway credentials configured (webhook secret + key + product map).
    These tests never open a network connection to Dodo: the checkout-path
    validation fails before any request is made, and the webhook is signed
    locally."""

    @classmethod
    def setUpClass(cls) -> None:
        raw = json.loads(json.dumps(BrainConfig.default().raw))
        raw.setdefault("billing", {})["secret"] = "a-stable-test-billing-secret-that-is-long-enough"
        raw.setdefault("billing", {})["dodo"] = {
            "test_mode": True,
            "webhook_secret": WHSEC,
            "api_key": "ddo_key_configured",
            "product_ids": {"week": "pds_test_week", "half": "pds_test_half"},
        }
        cls.config = BrainConfig(raw=raw)
        super().setUpClass()

    def test_checkout_with_missing_product_id_is_400_before_network(self) -> None:
        status, _, raw = self.request(
            "POST",
            "/api/dodo/checkout",
            {"pass": "day", "region": "Malaysia", "session_id": "dodo-noproduct"},
        )
        self.assertEqual(status, 400)
        self.assertIn("no Dodo product id", json.loads(raw)["error"])

    def test_full_webhook_confirms_signs_and_hands_over(self) -> None:
        self.server.dodo_pending["sess_test_1"] = {
            "pass": "week",
            "region": "Malaysia",
            "session_id": "sess_test_1",
            "status": "pending",
            "opened_at": int(time.time()),
        }
        body, headers = _sign_webhook(WHSEC, _success_event())
        status, _, raw = self.request("POST", "/api/dodo/webhook", body, headers)
        self.assertEqual(status, 200)
        payload = json.loads(raw)
        self.assertTrue(payload["acted"])
        self.assertEqual(payload["pass"], "week")
        status, _, raw = self.request("POST", "/api/dodo/webhook", body, headers)
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(raw)["duplicate"])

        # client pickup: the signed, duration-locked record
        status, _, raw = self.request(
            "POST", "/api/dodo/confirm", {"session_id": "sess_test_1"}
        )
        self.assertEqual(status, 200)
        record = json.loads(raw)["record"]
        self.assertEqual(record["pass"], "week")
        self.assertEqual(record["gateway"], "dodo")
        self.assertEqual(record["expires_at"] - record["activated_at"], 24 * 7 * 3600)
        billing.verify_record(record, self.server.billing_secret)

        # and it is a live premium pass on the ingest path
        status, _, raw = self.request(
            "POST",
            "/api/ingest",
            {"text": "hello", "session_id": "dodo-live-use"},
            {"X-SG16-Pass": record["token"]},
        )
        self.assertTrue(json.loads(raw)["premium"])

    def test_signed_success_webhook_without_host_checkout_is_rejected(self) -> None:
        orphan_event = _success_event()
        orphan_event["id"] = "evt_orphan_1"
        orphan_event["data"]["session_id"] = "sess_orphan_1"
        orphan_event["data"]["payment_id"] = "pay_orphan_1"
        orphan_event["data"]["metadata"]["sg16_checkout_ref"] = "sess_orphan_1"
        body, headers = _sign_webhook(WHSEC, orphan_event, msg_id="msg_orphan_0001")
        status, _, raw = self.request("POST", "/api/dodo/webhook", body, headers)
        self.assertEqual(status, 404)
        self.assertIn("does not match a checkout", json.loads(raw)["error"])

    def test_webhook_bad_signature_is_403(self) -> None:
        body, headers = _sign_webhook(WHSEC, _success_event())
        headers["webhook-signature"] = "v1," + base64.b64encode(b"\x00" * 32).decode()
        status, _, raw = self.request("POST", "/api/dodo/webhook", body, headers)
        self.assertEqual(status, 403)
        self.assertIn("signature", json.loads(raw)["error"])

    def test_webhook_non_success_event_is_acked_without_action(self) -> None:
        body, headers = _sign_webhook(WHSEC, {"type": "refund.succeeded", "data": {}})
        status, _, raw = self.request("POST", "/api/dodo/webhook", body, headers)
        self.assertEqual(status, 200)
        self.assertFalse(json.loads(raw)["acted"])

    def test_confirm_pending_session_is_202(self) -> None:
        self.server.dodo_pending["sess_pending"] = {
            "pass": "half",
            "region": None,
            "session_id": "sess_pending",
            "status": "pending",
            "opened_at": int(time.time()),
        }
        status, _, raw = self.request(
            "POST", "/api/dodo/confirm", {"session_id": "sess_pending"}
        )
        self.assertEqual(status, 202)
        self.assertFalse(json.loads(raw)["confirmed"])

    def test_confirm_unknown_session_is_404(self) -> None:
        status, _, _ = self.request(
            "POST", "/api/dodo/confirm", {"session_id": "sess_never"}
        )
        self.assertEqual(status, 404)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
