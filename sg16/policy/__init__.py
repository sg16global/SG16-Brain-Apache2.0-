"""SG16 BRAIN - policy package.

The anti-harm guardrails and the character state machine.  Pure computation:
no I/O, no network, no clock.
"""

from __future__ import annotations

from .features import DIMENSIONS, FEATURE_NAMES, FeatureVector, extract
from .lexicon import CATEGORIES, HARM_CATEGORIES, Category, Lexicon, Term

__all__ = [
    "CATEGORIES",
    "HARM_CATEGORIES",
    "Category",
    "Lexicon",
    "Term",
    "FeatureVector",
    "FEATURE_NAMES",
    "DIMENSIONS",
    "extract",
]
