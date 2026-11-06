"""SG16 BRAIN - byte-level tokenizer.

Block 3, rule 1 requires the byte-tokenization pipeline to live inside the
brain as pure mathematics, with no external model service and no remote API.
A byte-level alphabet is the honest way to satisfy that: it needs no trained
vocabulary file, no download, and it maps any UTF-8 input - Latin, Arabic,
Chinese, emoji, control bytes - onto a closed, total function.

    id 0        PAD
    id 1        BOS
    id 2        EOS
    id 3        UNK   (unreachable for valid UTF-8, kept for tensor completeness)
    id 4..259   the 256 UTF-8 byte values

Every function here is deterministic and allocation-only: no RNG, no clock,
no I/O.
"""

from __future__ import annotations

import hashlib
import unicodedata

__all__ = [
    "PAD",
    "BOS",
    "EOS",
    "UNK",
    "BYTE_OFFSET",
    "VOCAB_SIZE",
    "encode",
    "decode",
    "normalize",
    "token_signature",
]

PAD = 0
BOS = 1
EOS = 2
UNK = 3
BYTE_OFFSET = 4
VOCAB_SIZE = 260


def normalize(text: str) -> str:
    """Canonical text form used for every semantic decision.

    NFKC folds compatibility characters, casefolding removes the trivial
    evasion of shouting a blocked word in capitals.  Both are standard-library
    and fully deterministic.
    """
    folded = unicodedata.normalize("NFKC", text)
    folded = folded.replace("\u0000", " ")
    return folded.casefold().strip()


def encode(text: str) -> list[int]:
    """UTF-8 bytes -> token ids, wrapped in BOS/EOS."""
    raw = unicodedata.normalize("NFKC", text).replace("\u0000", " ").encode("utf-8")
    return [BOS] + [b + BYTE_OFFSET for b in raw] + [EOS]


def decode(ids: list[int]) -> str:
    """Token ids -> text.  Special tokens are dropped; bad bytes are replaced."""
    raw = bytes(i - BYTE_OFFSET for i in ids if i >= BYTE_OFFSET and i < VOCAB_SIZE)
    return raw.decode("utf-8", errors="replace")


def token_signature(ids: list[int]) -> str:
    """Stable hex digest of a token sequence (used in the reasoning plan)."""
    body = ",".join(map(str, ids)).encode("ascii")
    return hashlib.sha256(body).hexdigest()
