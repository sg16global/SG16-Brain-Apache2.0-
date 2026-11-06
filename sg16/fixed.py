"""SG16 BRAIN - fixed-point arithmetic kernel (Q16.16).

Block 3, rule 2 of the SG16 charter demands that the tensor operations run
*identically* in the online and air-gapped offline states, byte for byte.
IEEE-754 floats cannot promise that: libm implementations, FMA contraction and
vectorised BLAS kernels differ between hosts, so a float pipeline is not
transport-blind.

Everything below is therefore **pure integer arithmetic**.  A real value is
stored as ``value * 2**16`` in a Python ``int``.  Python integers are exact and
unbounded on every CPython build, so every function here returns the same
integer on every machine, in every deployment state, forever.  This module is
the mathematical invariant the whole brain is bound to.

Contract
--------
* ``fx`` / ``unfx``        real <-> Q16.16
* ``mul`` / ``div``        round-half-away-from-zero, symmetric
* ``sqrt``                 exact integer square root
* ``exp`` ``ln`` ``tanh`` ``sigmoid`` ``cos`` ``sin`` ``softmax``
                           integer Taylor series, no libm calls anywhere
"""

from __future__ import annotations

import math

__all__ = [
    "BITS",
    "SCALE",
    "FX_ZERO",
    "FX_ONE",
    "LN2",
    "PI",
    "fx",
    "unfx",
    "fx_int",
    "add",
    "sub",
    "neg",
    "mul",
    "div",
    "sqrt",
    "exp",
    "ln",
    "tanh",
    "sigmoid",
    "cos",
    "sin",
    "softmax",
    "clamp",
    "div_round",
    "shr_round",
]

BITS = 16
SCALE = 1 << BITS          # 65536
_HALF = SCALE >> 1         # rounding bias, 32768

FX_ZERO = 0
FX_ONE = SCALE

LN2 = 45426                # ln(2) * 2**16, rounded
PI = 205887                # pi    * 2**16, rounded


# --------------------------------------------------------------------------
# conversion
# --------------------------------------------------------------------------
def fx(value: float | int) -> int:
    """Encode a real number as Q16.16, rounding half away from zero."""
    scaled = value * SCALE
    if scaled >= 0:
        return int(scaled + 0.5)
    return -int(-scaled + 0.5)


def unfx(value: int) -> float:
    """Decode Q16.16 to float.  Display and logging only, never computation."""
    return value / SCALE


def fx_int(value: int) -> int:
    """Encode a Python int as Q16.16."""
    return value << BITS


# --------------------------------------------------------------------------
# rounding primitive
# --------------------------------------------------------------------------
def _div_round(numerator: int, denominator: int) -> int:
    """Exact ``numerator / denominator`` with round-half-away-from-zero.

    Python's ``//`` floors, which biases every negative intermediate downward
    and silently breaks the symmetry of tanh/exp.  This is the single rounding
    rule used across the kernel.
    """
    if denominator == 0:
        raise ZeroDivisionError("sg16.fixed: division by zero")
    negative = (numerator < 0) != (denominator < 0)
    quotient, remainder = divmod(abs(numerator), abs(denominator))
    if (remainder << 1) >= abs(denominator):
        quotient += 1
    return -quotient if negative else quotient


def _shr_round(value: int) -> int:
    """Divide by SCALE with round-half-away-from-zero."""
    if value >= 0:
        return (value + _HALF) >> BITS
    return -((-value + _HALF) >> BITS)


# Public aliases: the tensor layer needs the same rounding rule on raw
# accumulator sums, so the primitive is part of the kernel's surface.
div_round = _div_round
shr_round = _shr_round


# --------------------------------------------------------------------------
# field operations
# --------------------------------------------------------------------------
def add(a: int, b: int) -> int:
    return a + b


def sub(a: int, b: int) -> int:
    return a - b


def neg(a: int) -> int:
    return -a


def mul(a: int, b: int) -> int:
    """Q16.16 multiply."""
    return _shr_round(a * b)


def div(a: int, b: int) -> int:
    """Q16.16 divide."""
    return _div_round(a << BITS, b)


def clamp(value: int, low: int, high: int) -> int:
    if value < low:
        return low
    if value > high:
        return high
    return value


# --------------------------------------------------------------------------
# transcendental functions - integer series, so they are exact everywhere
# --------------------------------------------------------------------------
def sqrt(value: int) -> int:
    """sqrt in Q16.16: isqrt(v << 16).  Exact, no libm."""
    if value <= 0:
        return FX_ZERO
    return math.isqrt(value << BITS)


def exp(value: int) -> int:
    """exp(x) by range reduction plus a 16-term Taylor series.

    Saturated at x <= 8 (e^8 ~ 2981 is near the Q16.16 ceiling) and floored to
    zero below x = -20 where the true value is under 2e-9.
    """
    if value >= fx_int(8):
        value = fx_int(8)
    if value <= fx_int(-20):
        return FX_ZERO

    # exp(x) = 2^k * exp(r) with r in [-ln2/2, ln2/2]
    k = _div_round(value, LN2)
    r = value - k * LN2

    total = FX_ONE
    term = FX_ONE
    for n in range(1, 17):
        term = _div_round(term * r, n * SCALE)
        total += term

    if k >= 0:
        return total << k
    return total >> -k


def ln(value: int) -> int:
    """ln(x) for x > 0 via ln(x) = 2*artanh((x-1)/(x+1)) plus base-2 shifts."""
    if value <= 0:
        raise ValueError("sg16.fixed.ln: domain error, x must be > 0")
    k = 0
    v = value
    while v > fx(1.5):
        v >>= 1
        k += 1
    while v < fx(0.6666667):
        v <<= 1
        k -= 1
    y = div(v - FX_ONE, v + FX_ONE)
    y2 = mul(y, y)
    term = y
    total = y
    for n in range(1, 24):
        term = mul(term, y2)
        total += _div_round(term, 2 * n + 1)
    return 2 * total + k * LN2


def tanh(value: int) -> int:
    """tanh(x) = (e^2x - 1) / (e^2x + 1), saturated at |x| >= 9."""
    if value >= fx_int(9):
        return FX_ONE
    if value <= fx_int(-9):
        return -FX_ONE
    e = exp(mul(value, fx_int(2)))
    return div(e - FX_ONE, e + FX_ONE)


def sigmoid(value: int) -> int:
    """Logistic sigmoid."""
    return div(FX_ONE, FX_ONE + exp(-value))


def _cos_reduced(value: int) -> int:
    """cos for |value| <= pi/2, 12-term Taylor series."""
    x2 = mul(value, value)
    term = FX_ONE
    total = FX_ONE
    for n in range(1, 13):
        term = -_div_round(term * x2, (2 * n - 1) * (2 * n) * SCALE)
        total += term
    return total


def cos(value: int) -> int:
    """Cosine with exact integer range reduction into [-pi/2, pi/2]."""
    two_pi = PI << 1
    value %= two_pi
    if value > PI:
        value -= two_pi
    half = PI >> 1
    negate = False
    if value > half:
        value = PI - value
        negate = True
    elif value < -half:
        value = -PI - value
        negate = True
    result = _cos_reduced(value)
    return -result if negate else result


def sin(value: int) -> int:
    return cos(value - (PI >> 1))


def softmax(values: list[int]) -> list[int]:
    """Numerically stable fixed-point softmax.  Output sums exactly to FX_ONE."""
    if not values:
        return []
    peak = max(values)
    exps = [exp(v - peak) for v in values]
    total = sum(exps)
    if total == 0:
        share = _div_round(FX_ONE, len(values))
        return [share] * len(values)
    out = [_div_round(e << BITS, total) for e in exps]
    out[0] += FX_ONE - sum(out)
    return out
