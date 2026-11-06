"""Deterministic seeded matrices for SG16's structural encoder.

Each matrix is generated from a named seed using SHA-256 and represented in
Q16.16. This provides reproducible initial values; it does not make them
trained or meaningful model weights. :func:`from_rows` is a low-level tensor
conversion helper and does not implement model loading or inference.
"""

from __future__ import annotations

import hashlib
from typing import Iterable, Sequence

from . import fixed as F
from .tensor import Tensor

__all__ = ["draw", "build", "vector", "from_rows", "fingerprint", "SEED_ROOT"]

SEED_ROOT = "sg16.brain.v1"
_MASK = (1 << 32) - 1


def draw(seed: str, index: int) -> int:
    """One deterministic Q16.16 sample in [-1, 1) from ``seed`` and ``index``.

    SHA-256(seed|index) -> 256-bit int -> low 32 bits -> signed 16.16.
    """
    digest = hashlib.sha256(f"{SEED_ROOT}|{seed}|{index}".encode("utf-8")).digest()
    bits = int.from_bytes(digest[:4], "big") & _MASK
    # map 0..2^32-1 onto [-65536, 65536)
    return (bits >> 15) - F.FX_ONE


def build(seed: str, rows: int, cols: int, magnitude: int = F.FX_ONE) -> Tensor:
    """Synthesise a ``rows`` x ``cols`` matrix scaled by ``magnitude``."""
    if rows <= 0 or cols <= 0:
        raise ValueError("matrix dimensions must be positive")
    data = [F.mul(draw(seed, r * cols + c), magnitude) for r in range(rows) for c in range(cols)]
    return Tensor(rows, cols, data)


def vector(seed: str, length: int, magnitude: int = F.FX_ONE) -> list[int]:
    """Synthesise a deterministic vector, scaled by ``magnitude``."""
    return [F.mul(draw(seed, i), magnitude) for i in range(length)]


def from_rows(rows: Iterable[Sequence[int]]) -> Tensor:
    """Adopt externally supplied weights (e.g. a Devstral tensor shard).

    Values must already be Q16.16 integers.  This is the single seam through
    which real model weights can enter the sealed boundary.
    """
    return Tensor.from_rows(rows)


def fingerprint(*matrices: Tensor) -> str:
    """Stable digest of an ordered collection of matrices."""
    hasher = hashlib.sha256()
    for matrix in matrices:
        hasher.update(matrix.canonical_bytes())
        hasher.update(b"\x1e")
    return hasher.hexdigest()
