"""SG16 BRAIN - HTTP host for the sealed perimeter.

Standard library only (``http.server``), so the sovereign build keeps its
zero-dependency property and can be dropped onto an air-gapped machine as a
single directory.

Routes
------
    GET    /                        interface
    GET    /static/<file>           css / js / svg
    GET    /api/health              readiness, digests, topology
    GET    /api/charter             behavioral principles and canonical lines
    GET    /api/topology            perimeter, door counters, joint room
    GET    /api/parity              online/offline reasoning-parity proof
    GET    /api/knowledge           knowledge base manifest
    GET    /api/weight?member=&feature=   charter provenance of one weight
    POST   /api/ingest              one payload through the master door
    POST   /api/audio               audio bytes through the master door
    POST   /api/introspect          full gate + retrieval breakdown
    POST   /api/subscribe           host-signed local subscription record
    POST   /api/dodo/checkout       Dodo MoR checkout session for one pass
    POST   /api/dodo/webhook        signed Dodo payment confirmation
    POST   /api/dodo/confirm        client pickup of the confirmed record
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import ipaddress
import json
import logging
import os
import posixpath
import re
import secrets
import signal
import struct
import sys
import threading
import time
import uuid
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse

from .. import billing
from ..brain import SG16Brain
from ..charter import CANON, CHARTER, GATE_TITLES, MASTER_CHARTER, FUNDAMENTAL_ATTITUDE, OWNERSHIP_PHILOSOPHY, PERSONALITY_TRAITS
from ..config import BrainConfig
from ..engine.voxtral import EnvelopeError
from .billing_state import BillingStateStore
from .dodo import DodoClient, DodoError
from .throttle import Throttle, ThrottleExceeded

__all__ = ["BrainHTTPServer", "BrainRequestHandler", "build_server", "main"]

# The UI lives in web/ (Vite source tree).  The sovereign host serves the same
# modules raw as ES modules - no bundler required - and binary assets come
# straight off this host, so delivery is a self-contained byte stream.
WEB_ROOT = Path(__file__).resolve().parent.parent.parent / "web"
SERVER_VERSION = "SG16BRAIN/1.0"
DEFAULT_BILLING_STATE = WEB_ROOT.parent / "state" / "billing_state.json"
log = logging.getLogger("sg16.server")

# Bug #2 boundary: malformed audio surfaces as any member of the container-
# parser family - our own EnvelopeError, the stdlib wave/chunk errors
# (wave.Error, EOFError, RuntimeError, OSError, ValueError - exactly what
# wave.py/chunk.py raise for broken RIFF headers) and struct unpack failures.
# These are predictable 400 validations, never dropped sockets.  The boundary
# is enforced ONLY for payloads that actually carry audio; a fault on the
# plain-text path is re-raised, never masked.
AUDIO_DECODE_ERRORS: tuple[type[Exception], ...] = (
    EnvelopeError,
    wave.Error,
    struct.error,
    EOFError,
    OSError,
    ValueError,
    RuntimeError,
)

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".webmanifest": "application/manifest+json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}


class BrainHTTPServer(ThreadingHTTPServer):
    """Threaded host carrying one shared brain instance."""

    daemon_threads = True
    allow_reuse_address = True
    #: The socketserver default backlog of 5 resets connections under a
    #: browser's normal first-paint burst (HTML + modules + assets open in
    #: parallel), which surfaces client-side as a dropped "crash".  128 gives
    #: the accept thread headroom under real traffic.
    request_queue_size = 128

    def __init__(
        self, address, handler, brain: SG16Brain, config: BrainConfig,
        billing_state_path: str | os.PathLike | None = None,
    ) -> None:
        self.brain = brain
        self.config = config
        self._lock = threading.Lock()
        configured_billing_secret = config.billing_secret.strip()
        if configured_billing_secret and len(configured_billing_secret) < 32:
            raise ValueError("SG16_BILLING_SECRET must contain at least 32 characters")
        if config.dodo_api_key and not configured_billing_secret:
            raise ValueError("SG16_BILLING_SECRET is required when payment checkout is enabled")
        self.billing_secret_ephemeral = not bool(configured_billing_secret)
        self.billing_secret = configured_billing_secret or secrets.token_urlsafe(48)
        #: Issued passes, in-flight Dodo checkouts and webhook replay markers
        #: are written to a durable file after every mutation (see
        #: :mod:`sg16.server.billing_state`) and reloaded here on start.
        self.dodo_lock = threading.RLock()
        self.billing_store = BillingStateStore(
            billing_state_path
            or os.environ.get("SG16_BILLING_STATE")
            or DEFAULT_BILLING_STATE
        )
        loaded = self.billing_store.load()
        self.passes: dict[str, dict] = loaded["passes"]
        self.dodo_pending: dict[str, dict] = loaded["pending"]
        #: webhook id -> unix time first seen (the set view below is what the
        #: handler checks; the timestamps let load() forget old ids)
        self.dodo_seen_at: dict[str, int] = loaded["seen_webhooks"]
        self.dodo_seen_webhooks: set[str] = set(self.dodo_seen_at)
        recovered_state = self.billing_store.needs_save
        if self.billing_secret_ephemeral and (self.passes or self.dodo_pending):
            log.warning(
                "billing state was restored but SG16_BILLING_SECRET is not set: "
                "restored passes were signed with a previous ephemeral secret and will fail verification"
            )
        #: The Dodo MoR client, or None when no API key is configured (the
        #: sovereign local issuance path serves checkout in that state).
        self.dodo = (
            DodoClient(
                config.dodo_api_key,
                test_mode=config.dodo_test_mode,
                api_bases=config.dodo_api_bases,
            )
            if config.dodo_api_key
            else None
        )
        self.throttle = Throttle(
            max_requests=config.throttle_max_requests,
            window_seconds=config.throttle_window_seconds,
            max_chars=config.throttle_max_chars,
        )
        super().__init__(address, handler)
        if recovered_state:
            self.persist_billing()  # write recovered/converted data in the current format now

    def persist_billing(self) -> bool:
        """Write the billing state.  Call after every mutation, outside or
        inside ``dodo_lock`` (it is reentrant); the copy is serialised while
        the lock is held and the file write happens after it is released."""
        with self.dodo_lock:
            seq, text = self.billing_store.snapshot(
                self.passes, self.dodo_pending, self.dodo_seen_at
            )
        return self.billing_store.write(seq, text)

    def submit_locked(self, *args, **kwargs):
        """Serialise entry to the master door.

        The door keeps counters and the character engine keeps session state.
        Both are plain Python objects, so the single door is guarded by a single
        lock - which also means the "one door" property holds under concurrency.
        """
        with self._lock:
            return self.brain.submit(*args, **kwargs)


class BrainRequestHandler(BaseHTTPRequestHandler):
    server_version = SERVER_VERSION
    protocol_version = "HTTP/1.1"

    # ------------------------------------------------------------------
    # plumbing
    # ------------------------------------------------------------------
    @property
    def brain(self) -> SG16Brain:
        return self.server.brain  # type: ignore[attr-defined]

    @property
    def brain_config(self) -> BrainConfig:
        return self.server.config  # type: ignore[attr-defined]

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
        # This handler does not write request lines. Reverse-proxy, platform,
        # network, and host-level logging/retention remain deployment concerns.
        return

    def _send(self, status: int, body: bytes, content_type: str, extra: dict | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "no-referrer")
        self._cors()
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _cors(self) -> None:
        """Reflect only allow-listed origins.  Same-origin needs no header."""
        origin = self.headers.get("Origin")
        if not origin:
            return
        allowed = self.brain_config.cors_origins
        if origin not in allowed:
            return
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Session-Id, X-Transcript, Authorization")

    def _json(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self._send(status, body, CONTENT_TYPES[".json"])

    def _error(self, status: int, message: str) -> None:
        self._json({"error": message, "status": status}, status=status)

    def _read_body(self) -> bytes:
        declared = int(self.headers.get("Content-Length") or 0)
        limit = self.brain_config.max_body_bytes
        if declared > limit:
            # do not let an oversized body sit on a keep-alive socket
            self.close_connection = True
            raise ValueError(f"payload exceeds the {limit} byte limit")
        return self.rfile.read(declared) if declared else b""

    # ------------------------------------------------------------------
    # verbs
    # ------------------------------------------------------------------
    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(204, b"", "text/plain; charset=utf-8")

    def do_HEAD(self) -> None:  # noqa: N802
        self.do_GET()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        route = posixpath.normpath(parsed.path)
        query = parse_qs(parsed.query)

        if route in ("/", "/index.html"):
            return self._static("index.html")
        if route == "/favicon.ico":
            return self._send(204, b"", "image/x-icon")
        if route.startswith(("/src/", "/assets/", "/public/")):
            return self._static(route.lstrip("/"))

        handlers = {
            "/api/health": self._api_health,
            "/api/identity": self._api_identity,
            "/api/charter": self._api_charter,
            "/api/topology": self._api_topology,
            "/api/parity": self._api_parity,
            "/api/knowledge": self._api_knowledge,
        }
        if route in handlers:
            return handlers[route]()

        if route == "/api/billing":
            return self._api_billing()
        if route == "/api/weight":
            return self._api_weight(query)
        if route == "/v1/models":
            return self._api_openai_models()
        self._error(404, f"no such route: {route}")

    def do_POST(self) -> None:  # noqa: N802
        route = posixpath.normpath(urlparse(self.path).path)
        try:
            body = self._read_body()
        except ValueError as exc:
            return self._error(413, str(exc))

        if route == "/api/subscribe":
            return self._api_subscribe(body)
        if route == "/api/dodo/checkout":
            return self._api_dodo_checkout(body)
        if route == "/api/dodo/webhook":
            return self._api_dodo_webhook(body)
        if route == "/api/dodo/confirm":
            return self._api_dodo_confirm(body)
        if route == "/api/pass/verify":
            return self._api_pass_verify(body)
        if route == "/api/session/forget":
            return self._api_session_forget(body)
        if route == "/api/ingest":
            return self._api_ingest(body)
        if route == "/api/audio":
            return self._api_audio(body)
        if route == "/api/introspect":
            return self._api_introspect(body)
        if route == "/v1/chat/completions":
            return self._api_openai_chat(body)
        self._error(404, f"no such route: {route}")

    def do_DELETE(self) -> None:  # noqa: N802
        route = posixpath.normpath(urlparse(self.path).path)
        self._error(404, f"no such route: {route}")

    # ------------------------------------------------------------------
    # static
    # ------------------------------------------------------------------
    def _web_file(self, relative: str) -> Path | None:
        """Resolve a request path inside web/, falling back to web/public/."""
        rel = relative.lstrip("/")
        root = WEB_ROOT.resolve()
        for base in (WEB_ROOT, WEB_ROOT / "public"):
            candidate = (base / rel).resolve()
            if str(candidate).startswith(str(root)) and candidate.is_file():
                return candidate
        return None

    def _static(self, relative: str) -> None:
        candidate = self._web_file(relative)
        if candidate is None:
            return self._error(404, f"no such file: {relative}")
        content_type = CONTENT_TYPES.get(candidate.suffix, "application/octet-stream")
        # Byte-stream delivery: binary assets and module sources are cached for
        # an hour and flagged, keeping frontend delivery fast and leak-free.
        extra = {"Cache-Control": "public, max-age=3600", "X-SG16-Stream": "binary"}
        self._send(200, candidate.read_bytes(), content_type, extra)

    # ------------------------------------------------------------------
    # api
    # ------------------------------------------------------------------
    def _api_health(self) -> None:
        self._json(self.brain.health())

    def _api_session_forget(self, body: bytes) -> None:
        """Clear host-side conversation context for one scoped session.

        Returns no session state. This is an operational reset for New chat /
        history delete, not a session inspection surface.
        """
        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            return self._error(400, f"body is not valid json: {exc}")
        client_session = payload.get("session_id") if isinstance(payload, dict) else None
        if not isinstance(client_session, str) or not client_session.strip():
            return self._error(400, "session_id is required")
        client_session = client_session.strip()
        if len(client_session) > 128:
            return self._error(400, "session id must not exceed 128 characters")
        session_id = self._scoped_session_id(client_session)
        self.brain.reset_session(session_id)
        self._json({"ok": True, "host_context": "reset"})

    def _api_identity(self) -> None:
        """Designation-protocol handshake (Block 7, rule 2).

        The brain natively states its immutable designation "SG16" and proves
        the inscription: the identity digest recomputes against the core
        matrix fingerprint with 100% certainty, or ``verified`` is false.
        """
        self._json(self.brain.identity())

    def _api_charter(self) -> None:
        def _to_dict(obj):
            if isinstance(obj, dict):
                return {k: _to_dict(v) for k, v in obj.items()}
            try:
                from types import MappingProxyType
                if isinstance(obj, MappingProxyType):
                    return {k: _to_dict(v) for k, v in obj.items()}
            except Exception:
                pass
            if isinstance(obj, (list, tuple)):
                return [_to_dict(x) for x in obj]
            return obj

        self._json(
            {
                "master_charter": _to_dict(
                    {
                        "title": MASTER_CHARTER["title"],
                        "purpose": MASTER_CHARTER["purpose"],
                        "core_identity": MASTER_CHARTER["1_core_identity"],
                        "sovereign_identity": MASTER_CHARTER["2_sovereign_identity_operational_freedom_ownership"],
                        "human_first_personality": {
                            "traits": list(PERSONALITY_TRAITS),
                            "fundamental_attitude": FUNDAMENTAL_ATTITUDE,
                            "ownership_philosophy": OWNERSHIP_PHILOSOPHY,
                        },
                        "universal_friendly": MASTER_CHARTER["4_universal_friendly_relationship"],
                        "safe_for_all_ages": MASTER_CHARTER["5_safe_for_all_ages"],
                        "child_safety_boundary": MASTER_CHARTER["6_child_safety_boundary"],
                        "extreme_harm_protection": MASTER_CHARTER["7_extreme_harm_protection"],
                        "privacy_zero_data": MASTER_CHARTER["8_privacy_zero_data"],
                        "handling_angry_users": MASTER_CHARTER["9_handling_angry_users"],
                        "universal_policy_ai_systems": MASTER_CHARTER["10_universal_policy_ai_systems"],
                        "ai_comparison_philosophy": MASTER_CHARTER["11_ai_comparison_philosophy"],
                        "future_proof_neutrality": MASTER_CHARTER["12_future_proof_neutrality"],
                        "user_first_model_selection": MASTER_CHARTER["13_user_first_model_selection"],
                        "thought_partner_mode": MASTER_CHARTER["14_thought_partner_mode"],
                        "balanced_analysis": MASTER_CHARTER["15_balanced_analysis"],
                        "solution_first_reasoning": MASTER_CHARTER["16_solution_first_reasoning"],
                        "never_create_panic": MASTER_CHARTER["17_never_create_panic"],
                        "humility_in_deliverables": MASTER_CHARTER["18_humility_in_deliverables"],
                        "intellectual_honesty": MASTER_CHARTER["19_intellectual_honesty"],
                        "no_artificial_ego": MASTER_CHARTER["20_no_artificial_ego"],
                        "response_adaptation": MASTER_CHARTER["21_response_adaptation"],
                        "permanent_behavioral_hierarchy": MASTER_CHARTER["22_permanent_behavioral_hierarchy"],
                        "system_implementation": MASTER_CHARTER["23_system_implementation"],
                        "master_character_principle": MASTER_CHARTER["master_character_principle"],
                    }
                ),
                "invariants": [
                    {
                        "key": inv.key,
                        "text": inv.text,
                        "severity": inv.severity,
                        "enforced_by": list(inv.affinity),
                        "weight_seed": inv.weight_seed,
                    }
                    for inv in CHARTER
                ],
                "canonical": dict(CANON),
                "joint_room": dict(GATE_TITLES),
            }
        )

    def _api_topology(self) -> None:
        self._json(
            {
                **self.brain.housing.topology(),
                "gate_weights_sha256": self.brain.panel.weights.fingerprint,
                "core_matrix_sha256": self.brain.core.matrix_sha256,
            }
        )

    def _api_parity(self) -> None:
        self._json(self.brain.parity_report())

    def _api_knowledge(self) -> None:
        self._json(
            {
                "version": self.brain.knowledge.version,
                "entries": len(self.brain.knowledge.entries),
                "topics": sorted({e.topic for e in self.brain.knowledge.entries}),
                "ids": [e.id for e in self.brain.knowledge.entries],
                "policy": "recall, compute, or defer - never fabricate",
            }
        )

    def _api_weight(self, query: dict[str, list[str]]) -> None:
        member = (query.get("member") or ["kali"])[0]
        feature = (query.get("feature") or ["harm_violence"])[0]
        if member not in GATE_TITLES:
            return self._error(400, f"unknown gate member: {member}")
        try:
            self._json(self.brain.explain_weight(member, feature))
        except ValueError as exc:
            self._error(400, str(exc))

    def _proxy_headers_trusted(self) -> bool:
        expected = self.brain_config.proxy_auth_secret
        supplied = self.headers.get("X-SG16-Proxy-Auth", "")
        return bool(expected and hmac.compare_digest(supplied, expected))

    def _client_ip(self) -> str:
        """Use the socket peer unless an authenticated proxy asserted an IP."""
        candidate = self.client_address[0]
        if self._proxy_headers_trusted():
            forwarded = self.headers.get("X-Forwarded-For", "").split(",", 1)[0].strip()
            if forwarded:
                candidate = forwarded
        try:
            return ipaddress.ip_address(candidate).compressed
        except ValueError:
            return "unknown"

    def _client_rate_key(self) -> str:
        digest = hashlib.sha256(self._client_ip().encode("utf-8")).hexdigest()[:32]
        return f"client:{digest}"

    def _scoped_session_id(self, client_session: str) -> str:
        payload = f"sg16-session-v1|{self._client_rate_key()}|{client_session}"
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def _entitlement(self, payload: dict, size: int):
        """Resolve owner / premium status and enforce the throttles.

        Returns (is_owner, premium) or sends an error response and returns
        None.  The owner and verified pass holders are exempt from operational
        throttles; everyone else is metered.  The safety gate is unaffected.
        """
        owner_sig = self.headers.get("X-SG16-Owner-Sig")
        is_owner = self.brain.panel.is_owner(owner_sig)

        premium = False
        pass_token = self.headers.get("X-SG16-Pass") or payload.get("pass_token")
        if pass_token:
            try:
                self._resolve_pass(str(pass_token))
                premium = True
            except billing.VerificationError as exc:
                self._error(403, f"subscription failed verification: {exc}")
                return None

        try:
            self.server.throttle.check(self._client_rate_key(), size, exempt=is_owner or premium)
        except ThrottleExceeded as exc:
            self._error(429, str(exc))
            return None
        return is_owner, premium

    def _resolve_region(self, payload: dict | None = None) -> str | None:
        """Resolve region only from headers authenticated by a trusted proxy.

        Browser locale, request JSON, and ``X-SG16-Region`` are user-controlled
        and never grant a zero-rate pass. The proxy must set
        ``X-SG16-Proxy-Auth`` to the operator's server-only secret before its
        geo-country assertion is accepted.
        """
        if not self._proxy_headers_trusted():
            return None
        geo_country = (
            self.headers.get("CF-IPCountry")
            or self.headers.get("X-Vercel-IP-Country")
            or self.headers.get("X-SG16-Geo-Country")
        )
        return billing.resolve_region(
            geo_country=geo_country,
            proxy_authenticated=True,
        )

    def _api_subscribe(self, body: bytes) -> None:
        """Issue only a proxy-verified humanitarian record; never a free paid pass."""
        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            return self._error(400, f"body is not valid json: {exc}")
        if not isinstance(payload, dict):
            return self._error(400, "body must be a json object")
        pass_id = str(payload.get("pass", ""))
        if pass_id not in billing.PASSES:
            return self._error(400, f"unknown pass tier: {pass_id!r}")
        try:
            self.server.throttle.check(self._client_rate_key(), len(body), exempt=False)
        except ThrottleExceeded as exc:
            return self._error(429, str(exc))
        region = self._resolve_region(payload)
        if region != billing.HUMANITARIAN_REGION:
            return self._error(
                403,
                "local issuance is disabled; paid passes require confirmed checkout, "
                "and regional zero-rate eligibility must be verified by the host",
            )
        try:
            record = billing.issue_record(
                pass_id,
                region,
                self.server.billing_secret,
                provider="verified-humanitarian",
            )
        except billing.VerificationError as exc:
            return self._error(400, str(exc))
        record["gateway"] = "verified-humanitarian"
        with self.server.dodo_lock:
            self.server.passes[record["token"]] = record
        self.server.persist_billing()
        self._json(record)

    # ------------------------------------------------------------------
    # Dodo Payments MoR checkout pipeline
    # ------------------------------------------------------------------
    def _api_dodo_checkout(self, body: bytes) -> None:
        """Create a paid Dodo session or a proxy-verified humanitarian record.

        Self-service local issuance for paid tiers is disabled. If the payment
        gateway is not configured, paid checkout fails closed.
        """
        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            return self._error(400, f"body is not valid json: {exc}")
        if not isinstance(payload, dict):
            return self._error(400, "body must be a json object")
        pass_id = str(payload.get("pass", ""))
        if pass_id not in billing.PASSES:
            return self._error(400, f"unknown pass tier: {pass_id!r}")
        region = self._resolve_region(payload)
        try:
            self.server.throttle.check(self._client_rate_key(), len(body), exempt=False)
        except ThrottleExceeded as exc:
            return self._error(429, str(exc))

        # --- humanitarian interceptor: eligibility must come from a trusted proxy
        if region == billing.HUMANITARIAN_REGION:
            record = billing.issue_record(
                pass_id, region, self.server.billing_secret, provider="verified-humanitarian"
            )
            record["gateway"] = "verified-humanitarian"
            self.server.passes[record["token"]] = record
            return self._json({"mode": "humanitarian_bypass", "record": record})

        if self.server.dodo is None:
            return self._error(503, "paid checkout is unavailable: Dodo Payments is not configured")

        product_id = self.server.config.dodo_product_ids.get(pass_id, "")
        return_url = str(payload.get("return_url") or self.headers.get("Origin") or "")
        if return_url:
            parsed_return = urlparse(return_url)
            return_origin = f"{parsed_return.scheme}://{parsed_return.netloc}"
            if (
                parsed_return.scheme not in ("http", "https")
                or not parsed_return.netloc
                or return_origin not in self.brain_config.cors_origins
            ):
                return self._error(400, "return_url must use a configured application origin")
        checkout_ref = secrets.token_urlsafe(24)
        callback_url = return_url
        if callback_url:
            parsed_callback = urlparse(callback_url)
            query_items = parse_qs(parsed_callback.query, keep_blank_values=True)
            query_items["sg16_checkout_ref"] = [checkout_ref]
            callback_url = parsed_callback._replace(
                query=urlencode(query_items, doseq=True)
            ).geturl()
        try:
            request_body = billing.checkout_request_body(
                product_id,
                pass_id,
                region,
                callback_url,
                metadata={"sg16_checkout_ref": checkout_ref},
            )
        except billing.VerificationError as exc:
            return self._error(400, str(exc))

        pending = {
            "pass": pass_id,
            "region": region,
            "session_id": checkout_ref,
            "status": "creating",
            "opened_at": int(time.time()),
        }
        with self.server.dodo_lock:
            self.server.dodo_pending[checkout_ref] = pending
        self.server.persist_billing()
        try:
            session = self.server.dodo.create_checkout(request_body)
        except DodoError as exc:
            with self.server.dodo_lock:
                self.server.dodo_pending.pop(checkout_ref, None)
            self.server.persist_billing()
            return self._error(
                exc.status if exc.status in (400, 401, 402, 403, 422) else 502,
                str(exc),
            )
        checkout_id = str(session.get("session_id") or session.get("payment_id") or "")
        checkout_url = str(session.get("checkout_url") or "")
        parsed_checkout = urlparse(checkout_url)
        if (
            not checkout_id
            or parsed_checkout.scheme != "https"
            or not parsed_checkout.hostname
            or parsed_checkout.username is not None
            or parsed_checkout.password is not None
        ):
            with self.server.dodo_lock:
                self.server.dodo_pending.pop(checkout_ref, None)
            self.server.persist_billing()
            return self._error(502, "dodo payments returned an unusable checkout session")
        with self.server.dodo_lock:
            pending["gateway_session_id"] = checkout_id
            if checkout_id != checkout_ref:
                self.server.dodo_pending[checkout_id] = pending
            if pending["status"] == "creating":
                pending["status"] = "pending"
        self.server.persist_billing()
        self._json(
            {
                "mode": "dodo",
                "session_id": checkout_ref,
                "gateway_session_id": checkout_id,
                "checkout_url": checkout_url,
                "pass": pass_id,
            }
        )

    def _api_dodo_webhook(self, body: bytes) -> None:
        """Receive Dodo's signed payment confirmation.

        The raw body is verified against the Standard Webhooks signature
        before anything is parsed; only then is the duration-locked pass
        record signed and stored for client pickup via /api/dodo/confirm.
        """
        secret = self.server.config.dodo_webhook_secret
        if not secret:
            return self._error(503, "dodo webhook secret is not configured on this host")
        try:
            billing.verify_webhook_signature(
                secret,
                self.headers.get("webhook-id"),
                self.headers.get("webhook-timestamp"),
                self.headers.get("webhook-signature"),
                body,
            )
        except billing.VerificationError as exc:
            return self._error(403, str(exc))
        try:
            event = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            return self._error(400, f"webhook body is not valid json: {exc}")
        if not isinstance(event, dict):
            return self._error(400, "webhook body must be a json object")
        event_type = str(event.get("type", ""))
        if event_type not in billing.WEBHOOK_SUCCESS_EVENTS:
            return self._json({"received": True, "event": event_type, "acted": False})
        payment = billing.event_payment_object(event)
        metadata = payment.get("metadata") if isinstance(payment.get("metadata"), dict) else {}
        checkout_keys = (
            payment.get("session_id"),
            payment.get("payment_id"),
            payment.get("checkout_id"),
            metadata.get("sg16_checkout_ref"),
        )
        pending = next(
            (self.server.dodo_pending.get(str(key)) for key in checkout_keys if key and str(key) in self.server.dodo_pending),
            None,
        )
        if pending is None:
            return self._error(404, "success event does not match a checkout created by this host")
        if int(time.time()) - int(pending.get("opened_at", 0)) > 24 * 3600:
            with self.server.dodo_lock:
                pending["status"] = "expired"
            self.server.persist_billing()
            return self._error(410, "checkout confirmation window has expired")
        if str(metadata.get("sg16_pass") or "") != str(pending.get("pass") or ""):
            return self._error(400, "webhook pass does not match the host checkout")
        if str(metadata.get("sg16_region") or "") != str(pending.get("region") or ""):
            return self._error(400, "webhook region does not match the host checkout")
        try:
            record = billing.record_from_webhook(
                event,
                self.server.billing_secret,
                product_ids=self.brain_config.dodo_product_ids,
            )
        except billing.VerificationError as exc:
            return self._error(400, str(exc))
        record["gateway"] = "dodo"

        webhook_id = str(self.headers.get("webhook-id") or "")
        duplicate = False
        with self.server.dodo_lock:
            if webhook_id in self.server.dodo_seen_webhooks:
                return self._json({"received": True, "event": event_type, "acted": False, "duplicate": True})
            self.server.dodo_seen_webhooks.add(webhook_id)
            self.server.dodo_seen_at[webhook_id] = int(time.time())
            if pending.get("status") == "paid" and pending.get("record_token"):
                duplicate = True
            else:
                self.server.passes[record["token"]] = record
                pending["status"] = "paid"
                pending["record_token"] = record["token"]
        self.server.persist_billing()
        if duplicate:
            return self._json({"received": True, "event": event_type, "acted": False, "duplicate": True})

        self._json(
            {
                "received": True,
                "event": event_type,
                "acted": True,
                "pass": record["pass"],
            }
        )

    def _api_dodo_confirm(self, body: bytes) -> None:
        """Client pickup after returning from the Dodo checkout.

        Returns the signed, duration-locked record once the webhook has
        confirmed the payment; 202 while the confirmation is still in flight.
        """
        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            return self._error(400, f"body is not valid json: {exc}")
        checkout_id = str(payload.get("session_id", "")) if isinstance(payload, dict) else ""
        if not checkout_id:
            return self._error(400, "session_id is required")
        pending = self.server.dodo_pending.get(checkout_id)
        if pending is None:
            return self._error(404, "no such checkout session on this host")
        if pending.get("status") != "paid" or "record_token" not in pending:
            return self._json(
                {"confirmed": False, "status": pending.get("status", "pending")},
                status=202,
            )
        record = self.server.passes.get(pending["record_token"])
        if record is None:
            return self._error(410, "the confirmed record is no longer available")
        self._json({"confirmed": True, "record": record})

    #: a pass as it travels: either the legacy 64-hex token (looked up in the host's copy) or the
    #: whole signed record as base64url JSON (verified by its signature alone; nothing is looked up)
    _PASS_VALUE = re.compile(r"[a-f0-9]{64}|[A-Za-z0-9_-]{40,3000}")

    def _resolve_pass(self, value: str) -> dict:
        """Verify a pass and return its record, or raise :class:`billing.VerificationError`.

        A signed record needs no server-side state: the host recomputes the signature with its own
        secret, so a subscriber is recognised on any device that holds their record, across restarts,
        with nothing about them stored here.
        """
        value = value.strip()
        if not self._PASS_VALUE.fullmatch(value):
            raise billing.VerificationError("pass is malformed")
        if re.fullmatch(r"[a-f0-9]{64}", value):
            record = self.server.passes.get(value)
            if record is None:
                raise billing.VerificationError("pass token was not issued by this host")
            try:
                return billing.verify_record(record, self.server.billing_secret)
            except billing.VerificationError:
                with self.server.dodo_lock:
                    self.server.passes.pop(value, None)
                self.server.persist_billing()
                raise
        try:
            padded = value + "=" * (-len(value) % 4)
            record = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
        except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
            raise billing.VerificationError("pass is not a signed record") from exc
        if not isinstance(record, dict):
            raise billing.VerificationError("pass is not a signed record")
        return billing.verify_record(record, self.server.billing_secret)

    def _api_pass_verify(self, body: bytes) -> None:
        """Check a pass: ``{"pass": <token or signed record>}`` (``{"token": ...}`` still accepted)."""
        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            return self._error(400, f"body is not valid json: {exc}")
        value = payload.get("pass") or payload.get("token") if isinstance(payload, dict) else None
        if not isinstance(value, str) or not self._PASS_VALUE.fullmatch(value.strip()):
            return self._error(400, "pass must be a host pass token or a signed pass record")
        # the platform calls this for every pass-bearing chat from 127.0.0.1, so it must not share
        # one per-client bucket across all subscribers: a proxy-authenticated caller is exempt
        try:
            self.server.throttle.check(
                self._client_rate_key(), len(body), exempt=self._proxy_headers_trusted()
            )
        except ThrottleExceeded as exc:
            return self._error(429, str(exc))
        try:
            verified = self._resolve_pass(value)
        except billing.VerificationError as exc:
            return self._error(403, f"pass failed verification: {exc}")
        self._json({"valid": True, "record": verified})

    def _api_billing(self) -> None:
        cfg = self.brain_config
        self._json(
            {
                "currency": "USD",
                "humanitarian_region": billing.HUMANITARIAN_REGION,
                "passes": {
                    pid: {"label": spec.label, "price": spec.price, "hours": spec.hours}
                    for pid, spec in billing.PASSES.items()
                },
                "gateway": {
                    "provider": "dodo-payments",
                    "model": "merchant-of-record",
                    "mode": "live-mor" if cfg.dodo_api_key else "disabled",
                    "test_mode": cfg.dodo_test_mode,
                    "endpoints": {
                        "checkout": "/api/dodo/checkout",
                        "webhook": "/api/dodo/webhook",
                        "confirm": "/api/dodo/confirm",
                    },
                    "humanitarian_intercept": (
                        "A zero-rate record is available only when a proxy-authenticated "
                        "geo-country header verifies eligibility. Client region claims are ignored."
                    ),
                    "paid_checkout_without_gateway": "disabled; no local paid passes are issued",
                    "storage": (
                        "Issued passes, in-flight checkouts and webhook ids are saved to a durable "
                        "file on this host (atomic writes, owner-only permissions) after every change "
                        "and reloaded on restart; expired passes are pruned on load. The browser "
                        "stores its returned bearer token; deployment logging and retention depend "
                        "on the host."
                    ),
                    "storage_last_save_ok": self.server.billing_store.last_error is None,
                    "signing_secret": (
                        "configured server-side"
                        if not self.server.billing_secret_ephemeral
                        else "ephemeral process secret; signed records do not survive restart"
                    ),
                },
            }
        )

    def _api_ingest(self, body: bytes) -> None:
        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            return self._error(400, f"body is not valid json: {exc}")
        if not isinstance(payload, dict):
            return self._error(400, "body must be a json object")

        text_value = payload.get("text", "")
        if not isinstance(text_value, str):
            return self._error(400, "text must be a string")
        text = text_value
        if len(text) > 8192:
            return self._error(413, "text exceeds the 8192 character limit")
        supplied_session = payload.get("session_id")
        if supplied_session is None or supplied_session == "":
            supplied_session = secrets.token_urlsafe(24)
        if not isinstance(supplied_session, str):
            return self._error(400, "session_id must be a string")
        supplied_session = supplied_session.strip()
        if not supplied_session or len(supplied_session) > 128:
            return self._error(400, "session_id must contain 1 to 128 characters")
        session_id = self._scoped_session_id(supplied_session)
        declared_transcript = payload.get("declared_transcript")
        if declared_transcript is not None and (
            not isinstance(declared_transcript, str) or len(declared_transcript) > 8192
        ):
            return self._error(400, "declared_transcript must be a string of at most 8192 characters")
        audio: bytes | None = None
        if payload.get("audio_b64"):
            try:
                audio = base64.b64decode(str(payload["audio_b64"]), validate=True)
            except (binascii.Error, ValueError) as exc:
                return self._error(400, f"audio_b64 is not valid base64: {exc}")

        entitlement = self._entitlement(payload, len(text) + len(audio or b""))
        if entitlement is None:
            return
        is_owner, premium = entitlement

        try:
            transaction = self.server.submit_locked(  # type: ignore[attr-defined]
                text,
                session_id=session_id,
                audio=audio,
                declared_transcript=declared_transcript,
            )
        except AUDIO_DECODE_ERRORS as exc:
            if audio is None:
                raise  # no audio aboard: a genuine server fault is never masked
            # Bug #2: a malformed container, truncated envelope or broken PCM
            # block is a *predictable validation error*, not a crash.  The
            # client gets a structured 400 and the socket stays clean.
            return self._error(400, f"audio payload rejected: {exc}")
        data = transaction.to_dict()
        data["owner"] = is_owner
        data["premium"] = premium
        data["throttle"] = self.server.throttle.counters(self._client_rate_key())
        self._json(data)

    def _api_audio(self, body: bytes) -> None:
        if not body:
            return self._error(400, "audio body is empty")
        supplied_session = self.headers.get("X-Session-Id") or secrets.token_urlsafe(24)
        declared = self.headers.get("X-Transcript")
        if len(supplied_session) > 128:
            return self._error(400, "session id must not exceed 128 characters")
        if declared is not None and len(declared) > 8192:
            return self._error(413, "transcript exceeds the 8192 character limit")
        session_id = self._scoped_session_id(supplied_session.strip())
        entitlement = self._entitlement({}, len(body) + len(declared or ""))
        if entitlement is None:
            return
        is_owner, premium = entitlement
        try:
            transaction = self.server.submit_locked(  # type: ignore[attr-defined]
                "",
                session_id=session_id,
                audio=body,
                declared_transcript=declared,
            )
        except AUDIO_DECODE_ERRORS as exc:
            return self._error(400, f"audio payload rejected: {exc}")
        data = transaction.to_dict()
        data["owner"] = is_owner
        data["premium"] = premium
        data["throttle"] = self.server.throttle.counters(self._client_rate_key())
        self._json(data)

    def _api_introspect(self, body: bytes) -> None:
        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            return self._error(400, f"body is not valid json: {exc}")
        if not isinstance(payload, dict) or not isinstance(payload.get("text", ""), str):
            return self._error(400, "body must be an object with a string text field")
        text = payload.get("text", "")
        if len(text) > 8192:
            return self._error(413, "text exceeds the 8192 character limit")
        is_owner = self.brain.panel.is_owner(self.headers.get("X-SG16-Owner-Sig"))
        # The platform calls this once or twice per visitor message, always from
        # 127.0.0.1, so a per-client throttle here would be ONE shared bucket for
        # the whole site. A proxy-authenticated caller (the platform, which holds
        # SG16_PROXY_AUTH_SECRET) is exempt; the platform rate-limits visitors
        # itself. The gate verdict is still computed for every call.
        try:
            self.server.throttle.check(
                self._client_rate_key(), len(text),
                exempt=is_owner or self._proxy_headers_trusted(),
            )
        except ThrottleExceeded as exc:
            return self._error(429, str(exc))
        self._json(self.brain.introspect(text))

    # ------------------------------------------------------------------
    # openai-compatible api (for VS Codium, Continue, etc.)
    # ------------------------------------------------------------------
    def _api_openai_models(self) -> None:
        """List available models in OpenAI /v1/models format."""
        now = int(time.time())
        self._json({
            "object": "list",
            "data": [
                {
                    "id": "sg16-brain",
                    "object": "model",
                    "created": now,
                    "owned_by": "sovereign",
                    "permission": [],
                    "root": "sg16-brain",
                    "parent": None,
                }
            ],
        })

    def _api_openai_chat(self, body: bytes) -> None:
        """OpenAI-compatible chat completions endpoint.

        Accepts the standard OpenAI request shape (``messages`` array) and
        returns the standard ``chat.completion`` response.  The full
        conversation is folded into the prompt text so the brain sees
        context; a stable session id is derived from the message history so
        multi-turn conversations share character memory.

        No billing or throttle is applied — this route is intended for local
        tooling (VS Codium, Continue, etc.) on the same host.
        """
        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            return self._error(400, f"body is not valid json: {exc}")
        if not isinstance(payload, dict):
            return self._error(400, "body must be a json object")

        messages = payload.get("messages")
        if not isinstance(messages, list) or not messages:
            return self._error(400, "messages must be a non-empty array")

        # --- extract the latest user message and build context ---
        system_parts: list[str] = []
        conversation_parts: list[str] = []
        last_user_text = ""

        for msg in messages:
            if not isinstance(msg, dict):
                continue
            role = msg.get("role", "")
            content = msg.get("content", "")
            if not isinstance(content, str):
                content = str(content)
            if role == "system":
                system_parts.append(content)
            elif role == "user":
                last_user_text = content
                conversation_parts.append(f"User: {content}")
            elif role == "assistant":
                conversation_parts.append(f"Assistant: {content}")

        if not last_user_text.strip():
            return self._error(400, "no user message found in messages array")

        if len(last_user_text) > 8192:
            return self._error(413, "last user message exceeds the 8192 character limit")

        # Build the full prompt: system instructions + conversation history + latest user message
        prompt_parts: list[str] = []
        if system_parts:
            prompt_parts.append("\n".join(system_parts))
        if conversation_parts:
            # Exclude the last user message from history (it's the live prompt)
            history = conversation_parts[:-1] if conversation_parts and conversation_parts[-1].startswith("User:") else conversation_parts
            if history:
                prompt_parts.append("\n".join(history))
        prompt_parts.append(f"User: {last_user_text}")
        full_prompt = "\n\n".join(prompt_parts)

        # --- derive a stable session id from the conversation ---
        session_seed = hashlib.sha256(
            "|".join(f"{m.get('role', '')}:{m.get('content', '')}" for m in messages if isinstance(m, dict)).encode("utf-8")
        ).hexdigest()[:32]
        session_id = self._scoped_session_id(f"openai-{session_seed}")

        # --- submit through the brain ---
        try:
            transaction = self.server.submit_locked(  # type: ignore[attr-defined]
                full_prompt,
                session_id=session_id,
            )
        except AUDIO_DECODE_ERRORS:
            raise  # no audio on this path; re-raise genuine faults

        reply_text = transaction.response.text

        # --- token estimate (word-count approximation) ---
        prompt_tokens = len(full_prompt.split())
        completion_tokens = len(reply_text.split())

        # --- OpenAI-format response ---
        response = {
            "id": f"chatcmpl-{uuid.uuid4().hex}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": payload.get("model", "sg16-brain"),
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": reply_text,
                    },
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
            },
        }
        self._json(response)



# ----------------------------------------------------------------------
def build_server(
    config: BrainConfig | None = None,
    host: str | None = None,
    port: int | None = None,
    brain: SG16Brain | None = None,
    billing_state_path: str | os.PathLike | None = None,
) -> BrainHTTPServer:
    cfg = config or BrainConfig.default()
    # ``port=0`` is a legitimate request for an ephemeral port; it must not be
    # swallowed by a truthiness fallback.
    resolved_host = host if host is not None else (os.environ.get("SG16_HOST") or cfg.host)
    resolved_port = int(os.environ.get("SG16_PORT") or cfg.port) if port is None else int(port)
    instance = brain or SG16Brain(cfg)
    return BrainHTTPServer(
        (resolved_host, resolved_port), BrainRequestHandler, instance, cfg,
        billing_state_path=billing_state_path,
    )


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    host = argv[0] if len(argv) > 0 else None
    port = int(argv[1]) if len(argv) > 1 else None

    config = BrainConfig.load(os.environ.get("SG16_CONFIG"))
    server = build_server(config, host=host, port=port)
    bound_host, bound_port = server.server_address[0], server.server_address[1]

    print(f"SG16 BRAIN v{config.version} - {config.name}")
    print(f"  domain          {config.domain}")
    print(f"  listening       http://{bound_host}:{bound_port}")
    print(f"  transport       {config.transport.value} (declared, never probed)")
    print(f"  core            {config.engine.head}  matrix={server.brain.core.matrix_sha256[:16]}")
    print(f"  gate weights    {server.brain.panel.weights.fingerprint[:16]}")
    print(f"  knowledge       {len(server.brain.knowledge.entries)} entries")
    print("  perimeter       4 sides, 1 master door, sealed")

    def shutdown(signum, _frame):  # pragma: no cover - signal path
        print(f"\n[sg16] received signal {signum}, closing the master door")
        threading.Thread(target=server.shutdown, daemon=True).start()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, shutdown)
        except ValueError:  # pragma: no cover - non-main thread
            pass

    try:
        server.serve_forever()
    finally:
        server.server_close()
        print("[sg16] host stopped")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
