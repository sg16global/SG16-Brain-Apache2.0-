"""The platform must not share one throttle bucket with every visitor."""

from __future__ import annotations

import http.client
import json
import threading
import unittest
from unittest.mock import patch

from sg16.config import BrainConfig
from sg16.server.app import build_server

SECRET = "proxy-test-secret"


class IntrospectThrottleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        raw = json.loads(json.dumps(BrainConfig.default().raw))
        raw["throttle"] = {"max_requests": 2, "window_seconds": 60, "max_chars": 200000}
        cls.server = build_server(BrainConfig(raw=raw), host="127.0.0.1", port=0)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()

    def _introspect(self, headers: dict | None = None) -> int:
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=10)
        conn.request(
            "POST", "/api/introspect", json.dumps({"text": "hello there"}),
            {"Content-Type": "application/json", **(headers or {})},
        )
        status = conn.getresponse().status
        conn.close()
        return status

    def test_proxy_authenticated_platform_is_not_throttled_per_client(self) -> None:
        with patch.dict("os.environ", {"SG16_PROXY_AUTH_SECRET": SECRET}):
            statuses = [self._introspect({"X-SG16-Proxy-Auth": SECRET}) for _ in range(6)]
        self.assertEqual(statuses, [200] * 6)

    def test_anonymous_callers_are_still_throttled(self) -> None:
        with patch.dict("os.environ", {"SG16_PROXY_AUTH_SECRET": SECRET}):
            statuses = [self._introspect({"X-SG16-Proxy-Auth": "wrong"}) for _ in range(4)]
        self.assertEqual(statuses[:2], [200, 200])
        self.assertIn(429, statuses[2:])


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
