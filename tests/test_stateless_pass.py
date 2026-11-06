"""A subscriber is recognised from the signed pass they hold - the server stores nothing about them."""

from __future__ import annotations

import base64
import http.client
import json
import threading
import time
import unittest
from unittest.mock import patch

from sg16 import billing
from sg16.config import BrainConfig
from sg16.server.app import build_server

SECRET = "a-stable-test-billing-secret-that-is-long-enough"
PROXY = "proxy-test-secret"


def _b64(record: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(record).encode()).decode().rstrip("=")


class StatelessPassTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        raw = json.loads(json.dumps(BrainConfig.default().raw))
        raw.setdefault("billing", {})["secret"] = SECRET
        raw["throttle"] = {"max_requests": 2, "window_seconds": 60, "max_chars": 200000}
        cls._env = patch.dict("os.environ", {"SG16_PROXY_AUTH_SECRET": PROXY})
        cls._env.start()
        cls.server = build_server(BrainConfig(raw=raw), host="127.0.0.1", port=0)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls._env.stop()

    def post(self, path: str, body: dict, headers: dict | None = None):
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=10)
        # like the platform: it proves itself to the core, so the shared 127.0.0.1 address is not throttled
        conn.request("POST", path, json.dumps(body), {"Content-Type": "application/json", "X-SG16-Proxy-Auth": PROXY, **(headers or {})})
        response = conn.getresponse()
        raw = response.read()
        conn.close()
        return response.status, (json.loads(raw) if raw else {})

    def test_a_signed_record_verifies_with_nothing_stored_on_the_server(self) -> None:
        record = billing.issue_record("day", None, SECRET)
        self.assertNotIn(record["token"], self.server.passes)  # the server has no copy
        status, data = self.post("/api/pass/verify", {"pass": _b64(record)})
        self.assertEqual(status, 200)
        self.assertTrue(data["valid"])
        self.assertEqual(data["record"]["pass"], "day")

    def test_a_tampered_record_is_refused(self) -> None:
        record = billing.issue_record("day", None, SECRET)
        for field, value in (("pass", "month"), ("price_charged", 0), ("expires_at", record["expires_at"] + 86400 * 30), ("region", "Palestine")):
            forged = {**record, field: value}
            status, _ = self.post("/api/pass/verify", {"pass": _b64(forged)})
            self.assertEqual(status, 403, field)

    def test_a_record_signed_with_another_secret_is_refused(self) -> None:
        record = billing.issue_record("day", None, "some-other-secret-that-is-also-long-enough-ok")
        status, _ = self.post("/api/pass/verify", {"pass": _b64(record)})
        self.assertEqual(status, 403)

    def test_an_expired_record_is_refused(self) -> None:
        record = billing.issue_record("day", None, SECRET, now=time.time() - 3 * 86400)
        status, data = self.post("/api/pass/verify", {"pass": _b64(record)})
        self.assertEqual(status, 403)
        self.assertIn("expired", data["error"])

    def test_junk_is_refused(self) -> None:
        for junk in ("", "short", "!" * 80, "a" * 5000, _b64({"x": 1}), base64.urlsafe_b64encode(b"not json at all, just text here ok").decode()):
            status, _ = self.post("/api/pass/verify", {"pass": junk})
            self.assertIn(status, (400, 403), junk[:20])

    def test_the_older_hex_token_still_works_while_the_host_holds_the_record(self) -> None:
        record = billing.issue_record("week", None, SECRET)
        self.server.passes[record["token"]] = record
        status, data = self.post("/api/pass/verify", {"token": record["token"]})
        self.assertEqual(status, 200)
        self.assertTrue(data["valid"])
        status, _ = self.post("/api/pass/verify", {"token": "f" * 64})
        self.assertEqual(status, 403)

    def test_the_platform_is_not_throttled_per_client_when_it_proves_itself(self) -> None:
        record = billing.issue_record("day", None, SECRET)
        ok = [self.post("/api/pass/verify", {"pass": _b64(record)})[0] for _ in range(6)]
        anonymous = [self.post("/api/pass/verify", {"pass": _b64(record)}, {"X-SG16-Proxy-Auth": "wrong"})[0] for _ in range(4)]
        self.assertEqual(ok, [200] * 6)
        self.assertIn(429, anonymous)

    def test_chat_ingest_treats_a_signed_record_as_a_subscription(self) -> None:
        record = billing.issue_record("month", None, SECRET)
        self.assertNotIn(record["token"], self.server.passes)
        status, data = self.post("/api/ingest", {"text": "hello there", "session_id": "stateless-pass-1"}, {"X-SG16-Pass": _b64(record)})
        self.assertEqual(status, 200)
        self.assertTrue(data["premium"])
        status, _ = self.post("/api/ingest", {"text": "hello there", "session_id": "stateless-pass-2"}, {"X-SG16-Pass": _b64({**record, "price_charged": 1})})
        self.assertEqual(status, 403)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
