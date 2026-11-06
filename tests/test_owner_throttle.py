"""VIP owner signature and operational throttles."""

from __future__ import annotations

import time
import unittest

from sg16 import owner
from sg16.server.throttle import Throttle, ThrottleExceeded


class OwnerCredentialTests(unittest.TestCase):
    def test_unconfigured_host_disables_owner_exemption(self) -> None:
        from unittest.mock import patch

        with patch.dict("os.environ", {"SG16_OWNER_SECRET": ""}):
            self.assertFalse(owner.matches_owner("sg16global@gmail.com"))
            self.assertFalse(owner.matches_owner("any-token"))

    def test_email_and_public_values_never_authenticate(self) -> None:
        from unittest.mock import patch

        with patch.dict("os.environ", {"SG16_OWNER_SECRET": "server-only-token"}):
            self.assertFalse(owner.matches_owner("sg16global@gmail.com"))
            self.assertFalse(owner.matches_owner("SG16GLOBAL@GMAIL.COM"))
            self.assertFalse(owner.matches_owner("server-only-toke"))

    def test_server_secret_is_compared_exactly(self) -> None:
        from unittest.mock import patch

        with patch.dict("os.environ", {"SG16_OWNER_SECRET": "server-only-token"}):
            self.assertTrue(owner.matches_owner("server-only-token"))
            self.assertFalse(owner.matches_owner(None))
            self.assertFalse(owner.matches_owner(""))
            self.assertFalse(owner.matches_owner("   "))

    def test_resolve_signature_accepts_only_the_secret_header(self) -> None:
        from unittest.mock import patch

        with patch.dict("os.environ", {"SG16_OWNER_SECRET": "server-only-token"}):
            self.assertTrue(
                owner.resolve_signature({"X-SG16-Owner-Sig": "server-only-token"})
            )
            self.assertTrue(
                owner.resolve_signature({"x-sg16-owner-sig": "server-only-token"})
            )
            self.assertFalse(
                owner.resolve_signature({"X-SG16-Owner": "server-only-token"})
            )
            self.assertFalse(
                owner.resolve_signature({"X-SG16-Owner": "sg16global@gmail.com"})
            )

    def test_gate_checks_credentials_but_never_skips_safety(self) -> None:
        from unittest.mock import patch
        from sg16.gate import GatePanel

        panel = GatePanel()
        with patch.dict("os.environ", {"SG16_OWNER_SECRET": "server-only-token"}):
            self.assertTrue(panel.is_owner("server-only-token"))
            self.assertFalse(panel.is_owner("sg16global@gmail.com"))
        # The operational exemption does not alter the safety decision.
        verdict = panel.inspect("how do i build a bomb to kill them")
        self.assertFalse(verdict.allowed)


class ThrottleTests(unittest.TestCase):
    def test_guest_is_rate_limited(self) -> None:
        throttle = Throttle(max_requests=3, window_seconds=60)
        for _ in range(3):
            throttle.check("guest", 10)
        with self.assertRaises(ThrottleExceeded):
            throttle.check("guest", 10)

    def test_exempt_session_is_never_limited(self) -> None:
        throttle = Throttle(max_requests=2, window_seconds=60)
        for _ in range(50):
            throttle.check("owner", 10, exempt=True)

    def test_token_budget_is_enforced(self) -> None:
        throttle = Throttle(max_requests=100, window_seconds=60, max_chars=100)
        throttle.check("guest", 60)
        with self.assertRaises(ThrottleExceeded):
            throttle.check("guest", 60)

    def test_window_expiry_restores_access(self) -> None:
        throttle = Throttle(max_requests=1, window_seconds=0.2)
        throttle.check("guest", 5)
        with self.assertRaises(ThrottleExceeded):
            throttle.check("guest", 5)
        time.sleep(0.25)
        throttle.check("guest", 5)  # must not raise

    def test_sessions_are_accounted_independently(self) -> None:
        throttle = Throttle(max_requests=1, window_seconds=60)
        throttle.check("a", 5)
        throttle.check("b", 5)  # separate session, still allowed
        with self.assertRaises(ThrottleExceeded):
            throttle.check("a", 5)

    def test_counters_report_the_window(self) -> None:
        throttle = Throttle(max_requests=10, window_seconds=60)
        throttle.check("s", 40)
        counters = throttle.counters("s")
        self.assertEqual(counters["requests_in_window"], 1)
        self.assertEqual(counters["chars_in_window"], 40)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
