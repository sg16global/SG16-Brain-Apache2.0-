"""Block 3, rule 1-2: the arithmetic kernel is integer-only and exact."""

from __future__ import annotations

import math
import unittest

from sg16 import fixed as F


class ConversionTests(unittest.TestCase):
    def test_round_trip(self) -> None:
        for value in (0, 1, -1, 0.5, -0.5, 2.25, -13.75):
            self.assertAlmostEqual(F.unfx(F.fx(value)), value, places=5)

    def test_fx_int(self) -> None:
        self.assertEqual(F.fx_int(3), 3 * F.SCALE)

    def test_rounding_is_half_away_from_zero(self) -> None:
        self.assertEqual(F.fx(0.5 / F.SCALE), 1)
        self.assertEqual(F.fx(-0.5 / F.SCALE), -1)


class FieldTests(unittest.TestCase):
    def test_mul(self) -> None:
        self.assertAlmostEqual(F.unfx(F.mul(F.fx(1.5), F.fx(2.25))), 3.375, places=4)

    def test_div(self) -> None:
        self.assertAlmostEqual(F.unfx(F.div(F.fx(1), F.fx(3))), 1 / 3, places=4)

    def test_div_negative_is_symmetric(self) -> None:
        self.assertEqual(F.div(F.fx(-1), F.fx(3)), -F.div(F.fx(1), F.fx(3)))

    def test_div_by_zero_raises(self) -> None:
        with self.assertRaises(ZeroDivisionError):
            F.div(F.FX_ONE, 0)

    def test_mul_is_commutative(self) -> None:
        for a, b in ((1.5, -2.25), (0.125, 8.0), (-0.75, -0.25)):
            self.assertEqual(F.mul(F.fx(a), F.fx(b)), F.mul(F.fx(b), F.fx(a)))


class TranscendentalTests(unittest.TestCase):
    def test_sqrt_matches_float_reference(self) -> None:
        for value in (0.25, 1, 2, 3.5, 17, 1000):
            self.assertAlmostEqual(F.unfx(F.sqrt(F.fx(value))), math.sqrt(value), places=3)

    def test_sqrt_of_negative_is_zero(self) -> None:
        self.assertEqual(F.sqrt(F.fx(-4)), 0)

    def test_exp_matches_float_reference(self) -> None:
        for value in (-5, -1, -0.5, 0, 0.5, 1, 2, 3):
            self.assertAlmostEqual(F.unfx(F.exp(F.fx(value))), math.exp(value), delta=2e-3)

    def test_ln_matches_float_reference(self) -> None:
        for value in (0.5, 1, 2, 3, 10, 100):
            self.assertAlmostEqual(F.unfx(F.ln(F.fx(value))), math.log(value), delta=5e-3)

    def test_ln_domain_error(self) -> None:
        with self.assertRaises(ValueError):
            F.ln(0)

    def test_exp_and_ln_are_inverses(self) -> None:
        for value in (0.5, 1, 2, 5):
            self.assertAlmostEqual(F.unfx(F.ln(F.exp(F.fx(value)))), value, delta=5e-3)

    def test_tanh_matches_float_reference(self) -> None:
        for value in (-3, -1, 0, 1, 3):
            self.assertAlmostEqual(F.unfx(F.tanh(F.fx(value))), math.tanh(value), delta=2e-3)

    def test_tanh_saturates(self) -> None:
        self.assertEqual(F.tanh(F.fx_int(50)), F.FX_ONE)
        self.assertEqual(F.tanh(F.fx_int(-50)), -F.FX_ONE)

    def test_sigmoid_matches_float_reference(self) -> None:
        for value in (-4, -1, 0, 1, 4):
            expected = 1 / (1 + math.exp(-value))
            self.assertAlmostEqual(F.unfx(F.sigmoid(F.fx(value))), expected, delta=2e-3)

    def test_sigmoid_at_zero_is_one_half(self) -> None:
        self.assertEqual(F.sigmoid(0), F.FX_ONE // 2)

    def test_trig_matches_float_reference(self) -> None:
        for value in (0, math.pi / 4, math.pi / 2, math.pi, 3 * math.pi / 2, 2 * math.pi, -1.0472):
            self.assertAlmostEqual(F.unfx(F.cos(F.fx(value))), math.cos(value), delta=3e-3)
            self.assertAlmostEqual(F.unfx(F.sin(F.fx(value))), math.sin(value), delta=3e-3)

    def test_pythagorean_identity_holds_within_envelope(self) -> None:
        worst = 0
        for angle in range(0, 2 * F.PI, 997):
            residual = abs(F.mul(F.cos(angle), F.cos(angle)) + F.mul(F.sin(angle), F.sin(angle)) - F.FX_ONE)
            worst = max(worst, residual)
        self.assertLessEqual(worst, 8, "cos^2+sin^2 drifted outside the Q16.16 envelope")


class QuantisationEnvelopeTests(unittest.TestCase):
    """Pinned residuals: the kernel is deterministic, not perfectly exact.

    These bounds are measured, not aspirational.  If a future change to the
    Taylor series makes them worse, the parity guarantee may still hold but the
    numerics have silently regressed, and this test says so.
    """

    def test_tanh_asymmetry_is_bounded(self) -> None:
        worst = 0
        for hundredths in range(-400, 401):
            x = F.fx(hundredths / 100)
            worst = max(worst, abs(F.tanh(x) + F.tanh(-x)))
        self.assertLessEqual(worst, 2)

    def test_exp_reciprocal_product_is_bounded(self) -> None:
        for hundredths in range(-700, 701):
            x = F.fx(hundredths / 100)
            product = F.mul(F.exp(x), F.exp(-x))
            self.assertLessEqual(abs(product - F.FX_ONE), 2048)


class SoftmaxTests(unittest.TestCase):
    def test_output_sums_exactly_to_one(self) -> None:
        for values in ([1, 2, 3], [0, 0, 0], [-5, 5], [10, -10, 0, 3]):
            out = F.softmax([F.fx(v) for v in values])
            self.assertEqual(sum(out), F.FX_ONE)

    def test_empty_input(self) -> None:
        self.assertEqual(F.softmax([]), [])

    def test_monotonic(self) -> None:
        out = F.softmax([F.fx(1), F.fx(2), F.fx(3)])
        self.assertLess(out[0], out[1])
        self.assertLess(out[1], out[2])

    def test_deterministic(self) -> None:
        a = F.softmax([F.fx(1), F.fx(2), F.fx(3)])
        b = F.softmax([F.fx(1), F.fx(2), F.fx(3)])
        self.assertEqual(a, b)


class DeterminismTests(unittest.TestCase):
    def test_identical_inputs_give_identical_integers(self) -> None:
        samples = [F.fx(v / 97) for v in range(-200, 201)]
        first = [F.tanh(F.mul(x, x)) for x in samples]
        second = [F.tanh(F.mul(x, x)) for x in samples]
        self.assertEqual(first, second)

    def test_no_floating_point_in_results(self) -> None:
        for value in (F.exp(F.fx(1.234)), F.tanh(F.fx(-2.5)), F.cos(F.fx(0.7)), F.sqrt(F.fx(7))):
            self.assertIsInstance(value, int)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
