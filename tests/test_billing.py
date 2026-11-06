"""Server-backed subscription hardening: tiers, humanitarian bypass, spoofing."""

from __future__ import annotations

import unittest

from sg16 import billing

SECRET = "unit-test-secret"


class TierMirrorTests(unittest.TestCase):
    def test_the_four_tiers_and_prices_are_exact(self) -> None:
        self.assertEqual(billing.PASSES["day"].price, 3)
        self.assertEqual(billing.PASSES["week"].price, 5)
        self.assertEqual(billing.PASSES["half"].price, 8)
        self.assertEqual(billing.PASSES["month"].price, 15)

    def test_tier_durations(self) -> None:
        self.assertEqual(billing.PASSES["day"].hours, 24)
        self.assertEqual(billing.PASSES["week"].hours, 24 * 7)
        self.assertEqual(billing.PASSES["half"].hours, 24 * 15)
        self.assertEqual(billing.PASSES["month"].hours, 24 * 30)

    def test_labels(self) -> None:
        self.assertEqual(billing.PASSES["day"].label, "24-Hour Entry")
        self.assertEqual(billing.PASSES["month"].label, "1-Month Premium")


class HumanitarianBypassTests(unittest.TestCase):
    def test_palestine_is_zero_rate_for_every_tier(self) -> None:
        for pass_id in billing.PASSES:
            self.assertEqual(billing.effective_price(pass_id, "Palestine"), 0)

    def test_other_regions_pay_list_price(self) -> None:
        self.assertEqual(billing.effective_price("day", "Malaysia"), 3)
        self.assertEqual(billing.effective_price("month", None), 15)

    def test_unknown_tier_raises(self) -> None:
        with self.assertRaises(billing.VerificationError):
            billing.effective_price("lifetime", None)


class IssueAndVerifyTests(unittest.TestCase):
    def test_round_trip_verifies(self) -> None:
        record = billing.issue_record("week", "Malaysia", SECRET, now=1000.0)
        self.assertEqual(record["price_charged"], 5)
        verified = billing.verify_record(record, SECRET, now=1000.0)
        self.assertEqual(verified["pass"], "week")

    def test_same_tier_records_are_unique_even_in_same_second(self) -> None:
        first = billing.issue_record("week", "Malaysia", SECRET, now=1000.0)
        second = billing.issue_record("week", "Malaysia", SECRET, now=1000.0)
        self.assertNotEqual(first["nonce"], second["nonce"])
        self.assertNotEqual(first["token"], second["token"])
        billing.verify_record(first, SECRET, now=1000.0)
        billing.verify_record(second, SECRET, now=1000.0)

    def test_tampered_nonce_is_rejected(self) -> None:
        record = billing.issue_record("week", "Malaysia", SECRET, now=1000.0)
        tampered = dict(record, nonce="attacker-controlled")
        with self.assertRaises(billing.VerificationError):
            billing.verify_record(tampered, SECRET, now=1000.0)

    def test_humanitarian_record_is_zero_and_flagged(self) -> None:
        record = billing.issue_record("month", "Palestine", SECRET, now=1000.0)
        self.assertEqual(record["price_charged"], 0)
        self.assertTrue(record["humanitarian_bypass"])
        billing.verify_record(record, SECRET, now=1000.0)

    def test_spoofed_price_is_rejected(self) -> None:
        record = billing.issue_record("month", "Malaysia", SECRET, now=1000.0)
        tampered = dict(record, price_charged=0)
        with self.assertRaises(billing.VerificationError):
            billing.verify_record(tampered, SECRET, now=1000.0)

    def test_spoofed_region_price_mismatch_is_rejected(self) -> None:
        record = billing.issue_record("day", None, SECRET, now=1000.0)
        tampered = dict(record, region="Palestine", price_charged=0)
        # region changed but token was signed for the old region
        with self.assertRaises(billing.VerificationError):
            billing.verify_record(tampered, SECRET, now=1000.0)

    def test_forged_token_is_rejected(self) -> None:
        record = billing.issue_record("day", None, SECRET, now=1000.0)
        tampered = dict(record, token="f" * 64)
        with self.assertRaises(billing.VerificationError):
            billing.verify_record(tampered, SECRET, now=1000.0)

    def test_wrong_secret_is_rejected(self) -> None:
        record = billing.issue_record("day", None, SECRET, now=1000.0)
        with self.assertRaises(billing.VerificationError):
            billing.verify_record(record, "another-secret", now=1000.0)

    def test_tampered_expiry_is_rejected(self) -> None:
        record = billing.issue_record("day", None, SECRET, now=1000.0)
        tampered = dict(record, expires_at=record["expires_at"] + 999999)
        with self.assertRaises(billing.VerificationError):
            billing.verify_record(tampered, SECRET, now=1000.0)

    def test_expired_record_is_rejected(self) -> None:
        record = billing.issue_record("day", None, SECRET, now=1000.0)
        with self.assertRaises(billing.VerificationError):
            billing.verify_record(record, SECRET, now=1000.0 + 25 * 3600)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
