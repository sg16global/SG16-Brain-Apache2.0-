"""SG16 BRAIN - deterministic signed feature hashing for retrieval.

Why this module exists
----------------------
The core engine's intent vector is a *reasoning-plan signature*: it is what
gets hashed, audited and compared for online/offline parity.  It is produced by
an untrained structural matrix, so it is a random projection of a bag of bytes.
Random projections preserve similarity only loosely, and measurements confirmed
it: an unrelated sentence could score higher than a related one.

Retrieval therefore uses a real lexical signal instead - signed feature hashing
(the "hashing trick"), which is exact, needs no vocabulary file and no network:

    normalise -> word unigrams + bigrams -> SHA-256 -> (bucket, sign)
              -> accumulate -> L2 normalise -> cosine

Deterministic on every host, in both deployment states.
"""

from __future__ import annotations

import hashlib
import math
import unicodedata

from . import fixed as F

__all__ = [
    "HashVectorizer",
    "vectorize",
    "lexical_cosine",
    "overlap_coefficient",
    "stem",
    "cosine",
    "STOPWORDS",
    "DEFAULT_DIMS",
]

#: Function words carry no retrieval signal but inflate every overlap count,
#: so they are excluded from the set-based signal (not from the hashed vector).
STOPWORDS = frozenset(
    """a an the and or but if then so of to in on for with from by at as is are was were be been
    being i you he she it we they my your his her its our their me him them this that these those
    do does did doing have has had having will would can could should may might must shall want
    need like think about into over under again more most other some such no nor not only own same
    than too very just also new there here when where why all any both each few up out off down
    s t don now please tell explain what which who how is's""".split()
)

DEFAULT_DIMS = 512


def stem(word: str) -> str:
    """Conservative deterministic suffix stemmer.

    Retrieval needs "deploy" to meet "deployed" and "host" to meet "hosting".
    A short ordered rule set is enough, and unlike a statistical stemmer it
    behaves identically on every host.
    """
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 5 and word.endswith("ing"):
        return word[:-3]
    if len(word) > 4 and word.endswith("ed"):
        return word[:-2]
    if len(word) > 4 and word.endswith("es"):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


class HashVectorizer:
    """Signed feature hashing over stemmed word unigrams and bigrams."""

    def __init__(self, dims: int = DEFAULT_DIMS) -> None:
        if dims <= 0:
            raise ValueError("dims must be positive")
        self.dims = dims

    # ------------------------------------------------------------------
    @staticmethod
    def tokenize(text: str) -> list[str]:
        folded = unicodedata.normalize("NFKC", text).casefold()
        words: list[str] = []
        buf: list[str] = []
        for ch in folded:
            if ch.isalnum():
                buf.append(ch)
            elif buf:
                words.append(stem("".join(buf)))
                buf = []
        if buf:
            words.append(stem("".join(buf)))
        return words

    def content_tokens(self, text: str) -> set[str]:
        """Stemmed content words, stopwords removed - the set-based signal."""
        return {w for w in self.tokenize(text) if len(w) > 2 and w not in STOPWORDS}

    def features(self, text: str) -> list[str]:
        words = self.tokenize(text)
        out = list(words)
        out.extend(f"{a}_{b}" for a, b in zip(words, words[1:]))
        return out

    def _bucket(self, feature: str) -> tuple[int, int]:
        digest = hashlib.sha256(feature.encode("utf-8")).digest()
        index = int.from_bytes(digest[:4], "big") % self.dims
        sign = 1 if digest[4] & 1 else -1
        return index, sign

    def vector(self, text: str) -> list[int]:
        """Return the L2-normalised Q16.16 vector for ``text``."""
        acc = [0] * self.dims
        for feature in self.features(text):
            index, sign = self._bucket(feature)
            acc[index] += sign * F.FX_ONE
        # ``acc`` holds Q16.16 values, so ``sum(v*v)`` is in Q32.32 units.
        # isqrt of that is already the norm expressed in Q16.16 - applying
        # F.sqrt here would shift by another 16 bits and shrink every vector
        # 256x, which silently rounds every cosine similarity to zero.
        norm = math.isqrt(sum(v * v for v in acc))
        if norm == 0:
            return acc
        return [F.div(v, norm) for v in acc]

    def similarity(self, a: str, b: str) -> int:
        return cosine(self.vector(a), self.vector(b))


def cosine(a: list[int], b: list[int]) -> int:
    """Cosine similarity of two L2-normalised Q16.16 vectors."""
    if len(a) != len(b):
        raise ValueError("vector length mismatch")
    acc = 0
    for x, y in zip(a, b):
        acc += x * y
    return F.clamp(F.shr_round(acc), -F.FX_ONE, F.FX_ONE)


def overlap_coefficient(a: set[str], b: set[str]) -> int:
    """|A & B| / min(|A|, |B|) in Q16.16.

    Cosine alone punishes a five-word question asked of a seventeen-word entry
    even when every content word matches.  The overlap coefficient is the
    scale-invariant companion signal, and it is what separates a real match
    from an incidental one once stopwords are removed.
    """
    if not a or not b:
        return 0
    shared = len(a & b)
    if shared == 0:
        return 0
    smaller = min(len(a), len(b))
    return F.clamp(F.div(F.fx_int(shared), F.fx_int(smaller)), 0, F.FX_ONE)


_DEFAULT = HashVectorizer()


def vectorize(text: str) -> list[int]:
    return _DEFAULT.vector(text)


def lexical_cosine(a: str, b: str) -> int:
    return _DEFAULT.similarity(a, b)
