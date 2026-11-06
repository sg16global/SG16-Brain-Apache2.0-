"""SG16 BRAIN - deterministic integer tensor algebra.

Matrices are row-major ``list[int]`` of Q16.16 values.  Every operation is
integer-only, so the results are bit-identical on any host and in either the
online or the air-gapped offline state.
"""

from __future__ import annotations

import hashlib
from typing import Iterable, Sequence

from . import fixed as F

__all__ = ["Tensor", "dot", "vector_norm", "cosine", "mean_pool", "layer_norm"]


class Tensor:
    """A fixed-point matrix.  Immutable by convention; ``data`` is row-major."""

    __slots__ = ("rows", "cols", "data")

    def __init__(self, rows: int, cols: int, data: Sequence[int] | None = None) -> None:
        self.rows = rows
        self.cols = cols
        if data is None:
            self.data: list[int] = [0] * (rows * cols)
        else:
            self.data = list(data)
            if len(self.data) != rows * cols:
                raise ValueError(
                    f"tensor shape mismatch: {rows}x{cols} needs {rows * cols}, "
                    f"got {len(self.data)}"
                )

    # -- construction -----------------------------------------------------
    @classmethod
    def zeros(cls, rows: int, cols: int) -> "Tensor":
        return cls(rows, cols)

    @classmethod
    def from_rows(cls, rows: Iterable[Sequence[int]]) -> "Tensor":
        materialised = [list(r) for r in rows]
        if not materialised:
            return cls(0, 0, [])
        cols = len(materialised[0])
        for row in materialised:
            if len(row) != cols:
                raise ValueError("ragged rows are not a matrix")
        flat: list[int] = []
        for row in materialised:
            flat.extend(row)
        return cls(len(materialised), cols, flat)

    @classmethod
    def from_vector(cls, values: Sequence[int]) -> "Tensor":
        return cls(len(values), 1, list(values))

    # -- access -----------------------------------------------------------
    def get(self, r: int, c: int) -> int:
        return self.data[r * self.cols + c]

    def row(self, r: int) -> list[int]:
        base = r * self.cols
        return self.data[base : base + self.cols]

    def col(self, c: int) -> list[int]:
        return [self.data[r * self.cols + c] for r in range(self.rows)]

    def vector(self) -> list[int]:
        if self.cols != 1:
            raise ValueError("not a column vector")
        return list(self.data)

    # -- algebra ----------------------------------------------------------
    def matmul(self, other: "Tensor") -> "Tensor":
        if self.cols != other.rows:
            raise ValueError(
                f"cannot multiply {self.rows}x{self.cols} by {other.rows}x{other.cols}"
            )
        out = [0] * (self.rows * other.cols)
        b_cols = list(zip(*(other.row(r) for r in range(other.rows))))
        for i in range(self.rows):
            a_row = self.data[i * self.cols : (i + 1) * self.cols]
            base = i * other.cols
            for j, b_col in enumerate(b_cols):
                acc = 0
                for k in range(self.cols):
                    acc += a_row[k] * b_col[k]
                out[base + j] = F.shr_round(acc)
        return Tensor(self.rows, other.cols, out)

    def matvec(self, vector: Sequence[int]) -> list[int]:
        if len(vector) != self.cols:
            raise ValueError(f"matvec width {self.cols} != vector {len(vector)}")
        out = []
        for r in range(self.rows):
            row = self.data[r * self.cols : (r + 1) * self.cols]
            acc = 0
            for k in range(self.cols):
                acc += row[k] * vector[k]
            out.append(F.shr_round(acc))
        return out

    def add(self, other: "Tensor") -> "Tensor":
        if (self.rows, self.cols) != (other.rows, other.cols):
            raise ValueError("shape mismatch in add")
        return Tensor(self.rows, self.cols, [a + b for a, b in zip(self.data, other.data)])

    def add_vector(self, vector: Sequence[int]) -> "Tensor":
        if len(vector) != self.cols:
            raise ValueError("bias width mismatch")
        out: list[int] = []
        for r in range(self.rows):
            base = r * self.cols
            out.extend(self.data[base + c] + vector[c] for c in range(self.cols))
        return Tensor(self.rows, self.cols, out)

    def scale(self, factor: int) -> "Tensor":
        return Tensor(self.rows, self.cols, [F.mul(v, factor) for v in self.data])

    def transpose(self) -> "Tensor":
        out = [0] * len(self.data)
        for r in range(self.rows):
            for c in range(self.cols):
                out[c * self.rows + r] = self.data[r * self.cols + c]
        return Tensor(self.cols, self.rows, out)

    def apply(self, fn) -> "Tensor":
        return Tensor(self.rows, self.cols, [fn(v) for v in self.data])

    # -- serialisation ----------------------------------------------------
    def canonical_bytes(self) -> bytes:
        """Canonical, platform-independent byte form used for plan hashing."""
        header = f"{self.rows}x{self.cols}|".encode("ascii")
        body = ",".join(map(str, self.data)).encode("ascii")
        return header + body

    def sha256(self) -> str:
        return hashlib.sha256(self.canonical_bytes()).hexdigest()

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Tensor({self.rows}x{self.cols}, sha256={self.sha256()[:12]})"


# --------------------------------------------------------------------------
# vector helpers
# --------------------------------------------------------------------------
def dot(a: Sequence[int], b: Sequence[int]) -> int:
    if len(a) != len(b):
        raise ValueError("dot product length mismatch")
    acc = 0
    for x, y in zip(a, b):
        acc += x * y
    return F.shr_round(acc)


def vector_norm(a: Sequence[int]) -> int:
    acc = 0
    for x in a:
        acc += x * x
    return F.sqrt(F.shr_round(acc))


def cosine(a: Sequence[int], b: Sequence[int]) -> int:
    """Cosine similarity in Q16.16, clamped to [-1, 1]."""
    na = vector_norm(a)
    nb = vector_norm(b)
    if na == 0 or nb == 0:
        return 0
    return F.clamp(F.div(dot(a, b), F.mul(na, nb)), -F.FX_ONE, F.FX_ONE)


def mean_pool(matrix: Tensor) -> list[int]:
    """Average over rows -> single vector."""
    if matrix.rows == 0:
        return [0] * matrix.cols
    out = []
    for c in range(matrix.cols):
        out.append(F.div_round(sum(matrix.col(c)), matrix.rows))
    return out


def layer_norm(matrix: Tensor) -> Tensor:
    """Layer normalisation across columns, integer only."""
    cols = matrix.cols
    inv_n = F.div(F.FX_ONE, F.fx_int(cols))
    out: list[int] = []
    for r in range(matrix.rows):
        row = matrix.row(r)
        mean = F.mul(sum(row), inv_n)
        var = 0
        for v in row:
            d = v - mean
            var += F.mul(d, d)
        var = F.mul(var, inv_n)
        std = F.sqrt(var + F.fx(1e-5))
        if std == 0:
            out.extend([0] * cols)
            continue
        out.extend(F.div(v - mean, std) for v in row)
    return Tensor(matrix.rows, cols, out)
