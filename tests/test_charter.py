"""Charter invariant 1-7: the canonical utterances must be verbatim.

These strings are contractual.  If a future edit rewords them, this file fails.
"""

from __future__ import annotations

import unittest

from sg16.charter import CANON, CHARTER, CanonKey


class CanonicalWordingTests(unittest.TestCase):
    def test_idea_invite_is_verbatim(self) -> None:
        self.assertEqual(CANON[CanonKey.IDEA_INVITE], "Hi! What can I help you with?")

    def test_exact_solution_is_verbatim(self) -> None:
        self.assertEqual(
            CANON[CanonKey.EXACT_SOLUTION],
            "Got it. I'll revise the plan based on what you meant.",
        )

    def test_decency_limit_is_verbatim(self) -> None:
        self.assertEqual(
            CANON[CanonKey.DECENCY_LIMIT],
            "I can help with the problem, but I won't engage with insults. "
            "Tell me what you'd like me to address.",
        )

    def test_identity_utterance_is_verbatim(self) -> None:
        from sg16 import identity

        self.assertEqual(CANON[CanonKey.IDENTITY], identity.UTTERANCE)

    def test_known_fact_introduction_is_verbatim(self) -> None:
        self.assertEqual(
            CANON[CanonKey.UNIVERSAL],
            "Here's what I can answer from the information available to me:",
        )

    def test_unknown_deferral_is_verbatim(self) -> None:
        self.assertEqual(
            CANON[CanonKey.UNKNOWN],
            "I don't have enough reliable information to answer that from what I know, "
            "and I can't fetch live sources in this build. If you share a source or a "
            "little more context, I'll help you work through it.",
        )

    def test_model_neutrality_is_verbatim(self) -> None:
        self.assertEqual(
            CANON[CanonKey.MODEL_NEUTRAL],
            "Different AI systems have different strengths and limitations. "
            "Tell me what you're trying to do, and I'll help compare the options based on your needs.",
        )

    def test_model_neutrality_pressed_is_verbatim(self) -> None:
        self.assertEqual(
            CANON[CanonKey.MODEL_NEUTRAL_PRESSED],
            "I don't have a stake in which tool you choose. Use whichever best fits your task.",
        )


class CharterStructureTests(unittest.TestCase):
    def test_eight_invariants_are_declared(self) -> None:
        self.assertEqual(len(CHARTER), 8)

    def test_invariant_keys(self) -> None:
        self.assertEqual(
            tuple(inv.key for inv in CHARTER),
            (
                "independence",
                "patience",
                "idea_ingest",
                "escalation",
                "anti_harm",
                "zero_hallucination",
                "language_parity",
                "model_neutrality",
            ),
        )

    def test_unknown_questions_are_deferred(self) -> None:
        inv = next(i for i in CHARTER if i.key == "zero_hallucination")
        self.assertIn("Unknown or time-sensitive questions should be deferred", inv.text)
        self.assertIn("no general web retrieval", inv.text)

    def test_language_limits_are_declared(self) -> None:
        inv = next(i for i in CHARTER if i.key == "language_parity")
        self.assertIn("language identification", inv.text)
        self.assertIn("not implemented", inv.text)

    def test_every_invariant_owns_at_least_one_gate_member(self) -> None:
        for inv in CHARTER:
            self.assertTrue(inv.affinity, f"{inv.key} has no enforcing gate member")
            for member in inv.affinity:
                self.assertIn(member, ("shell", "kali", "terminal"))

    def test_anti_harm_is_the_strongest_invariant(self) -> None:
        severities = {inv.key: inv.severity for inv in CHARTER}
        self.assertEqual(max(severities, key=severities.get), "anti_harm")

    def test_canon_table_is_immutable(self) -> None:
        with self.assertRaises(TypeError):
            CANON[CanonKey.IDEA_INVITE] = "something else"  # type: ignore[index]


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
