"""Block 3, rule 2: byte-for-byte identical reasoning across online and offline.

This is the executable form of the parity claim.  The engine is asked to run the
same payloads under both transport labels, and the digests must match.
"""

from __future__ import annotations

import os
import unittest

from sg16.brain import PARITY_PAYLOADS, SG16Brain
from sg16.engine.core import DevstralCore, EngineConfig
from sg16.transport import (
    ENV_VAR,
    Transport,
    current,
    plan_fingerprint,
    verify_online_offline_parity,
)

MIXED_PAYLOADS = (
    *PARITY_PAYLOADS,
    "",
    "a" * 5000,
    "mixed 123 !@# — emoji 🚀 and عربية",
)


class ParityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.core = DevstralCore()

    def test_plans_are_identical_across_transports(self) -> None:
        for text in MIXED_PAYLOADS:
            online = self.core.plan(text, transport="online")
            offline = self.core.plan(text, transport="offline")
            self.assertEqual(
                plan_fingerprint(online),
                plan_fingerprint(offline),
                f"parity broken for {text[:40]!r}",
            )

    def test_batch_report_is_clean(self) -> None:
        report = verify_online_offline_parity(self.core, MIXED_PAYLOADS)
        self.assertTrue(report.identical, report.to_dict())
        self.assertEqual(report.online_digest, report.offline_digest)
        self.assertEqual(report.mismatches, ())
        self.assertEqual(report.payloads, len(MIXED_PAYLOADS))

    def test_a_different_engine_geometry_changes_the_digest(self) -> None:
        other = DevstralCore(EngineConfig(dim=24))
        self.assertNotEqual(
            plan_fingerprint(self.core.plan("geometry")),
            plan_fingerprint(other.plan("geometry")),
        )

    def test_intent_vectors_match_exactly_not_just_approximately(self) -> None:
        online = self.core.plan("exactness", transport="online").intent
        offline = self.core.plan("exactness", transport="offline").intent
        self.assertEqual(online, offline)

    def test_traces_match_stage_by_stage(self) -> None:
        online = self.core.plan("trace parity", transport="online").trace
        offline = self.core.plan("trace parity", transport="offline").trace
        self.assertEqual(online, offline)


class TransportDeclarationTests(unittest.TestCase):
    def tearDown(self) -> None:
        os.environ.pop(ENV_VAR, None)

    def test_default_is_offline(self) -> None:
        os.environ.pop(ENV_VAR, None)
        self.assertIs(current(), Transport.OFFLINE)

    def test_env_var_selects_online(self) -> None:
        os.environ[ENV_VAR] = "online"
        self.assertIs(current(), Transport.ONLINE)

    def test_unknown_value_falls_back_to_offline(self) -> None:
        os.environ[ENV_VAR] = "carrier-pigeon"
        self.assertIs(current(), Transport.OFFLINE)

    def test_air_gapped_flag(self) -> None:
        self.assertTrue(Transport.OFFLINE.air_gapped)
        self.assertFalse(Transport.ONLINE.air_gapped)

    def test_brain_reports_its_declared_transport(self) -> None:
        brain = SG16Brain()
        tx = brain.submit("hello", session_id="parity-session")
        self.assertIn(tx.request.transport, ("online", "offline"))
        self.assertEqual(tx.request.transport, brain.config.transport.value)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
