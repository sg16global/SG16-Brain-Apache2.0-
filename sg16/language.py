"""Small Unicode utilities; this module does not implement language AI.

The functions count coarse Unicode blocks, calculate byte entropy, or look for
common question marks. They do not identify natural languages, translate text,
or make the deterministic response system multilingual.
"""

from __future__ import annotations

import unicodedata

__all__ = [
    "detect",
    "has_question_marker",
    "universal_script_vector",
    "byte_entropy",
    "script_counts",
]

QUESTION_ENDS: tuple[str, ...] = ("?", "؟", "¿", "？", "՞", "﹖")


def _script_counts_raw(text: str) -> dict[str, int]:
    """Count selected Unicode blocks; block counts are not language IDs."""
    counts: dict[str, int] = {}
    for ch in text:
        if ch.isspace():
            continue
        cat = unicodedata.category(ch)
        if cat.startswith("P"):
            continue
        code = ord(ch)
        if 0x0000 <= code <= 0x007F:
            key = "U0000-007F"
        elif 0x0080 <= code <= 0x00FF:
            key = "U0080-00FF"
        elif 0x0100 <= code <= 0x017F:
            key = "U0100-017F"
        elif 0x0400 <= code <= 0x04FF:
            key = "U0400-04FF"
        elif 0x0500 <= code <= 0x05FF:
            key = "U0500-05FF"
        elif 0x0600 <= code <= 0x06FF:
            key = "U0600-06FF"
        elif 0x0900 <= code <= 0x097F:
            key = "U0900-097F"
        elif 0x0980 <= code <= 0x09FF:
            key = "U0980-09FF"
        elif 0x0E00 <= code <= 0x0E7F:
            key = "U0E00-0E7F"
        elif 0x3040 <= code <= 0x30FF:
            key = "U3040-30FF"
        elif 0x4E00 <= code <= 0x9FFF:
            key = "U4E00-9FFF"
        elif 0xAC00 <= code <= 0xD7AF:
            key = "UAC00-D7AF"
        elif 0xFB50 <= code <= 0xFDFF:
            key = "UFB50-FDFF"
        else:
            key = f"U{code:04X}"
        counts[key] = counts.get(key, 0) + 1
    return counts


def script_counts(text: str) -> dict[str, int]:
    """Return coarse counts of Unicode blocks, not language identification."""
    return _script_counts_raw(text)


def universal_script_vector(text: str) -> dict[str, float]:
    """Return proportions of the selected Unicode blocks in *text*."""
    counts = _script_counts_raw(text)
    total = sum(counts.values()) or 1
    return {k: round(v / total, 4) for k, v in counts.items()}


def byte_entropy(text: str) -> float:
    """Shannon entropy of the UTF-8 bytes; it says nothing about meaning."""
    b = text.encode("utf-8")
    if not b:
        return 0.0
    freq: dict[int, int] = {}
    for byte in b:
        freq[byte] = freq.get(byte, 0) + 1
    import math

    entropy = 0.0
    total = len(b)
    for count in freq.values():
        p = count / total
        entropy -= p * math.log2(p)
    return round(entropy, 4)


def detect(text: str) -> str:
    """Return ``und`` (undetermined); no natural-language detector is present."""
    return "und"


def has_question_marker(text: str) -> bool:
    """Check for a small set of common question marks, not question meaning."""
    if not text:
        return False
    return any(marker in text for marker in QUESTION_ENDS)
