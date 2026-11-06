"""SG16 BRAIN - sovereign knowledge base.

Charter invariant ``zero_hallucination`` is implemented structurally rather
than by asking a model to behave: the brain can only *recall* what is in this
base, *compute* what is arithmetic, or *defer*.  There is no fourth option.

Matching combines two deterministic signals:

* lexical cosine over signed feature hashes (the primary signal), and
* cosine of the core engine's intent vectors (a secondary structural signal).

Both are integer arithmetic, so retrieval is identical online and offline.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from . import fixed as F
from .engine.core import DevstralCore
from .retrieval import HashVectorizer, overlap_coefficient

__all__ = [
    "KnowledgeEntry",
    "KnowledgeBase",
    "Match",
    "DEFAULT_PATH",
    "DEFAULT_LEXICAL_FLOOR",
    "LEXICAL_WEIGHT",
    "INTENT_WEIGHT",
]

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "knowledge" / "sg16_core.json"

#: The lexical signal carries the retrieval; the structural signal from the
#: engine's intent vectors has a high baseline and is only a tie-breaker.
LEXICAL_WEIGHT = F.fx(0.90)
INTENT_WEIGHT = F.fx(0.10)

#: A match must be lexically grounded.  Without this floor a purely structural
#: similarity can clear the threshold and return an unrelated entry, which
#: would be a fabrication by omission.
DEFAULT_LEXICAL_FLOOR = F.fx(0.18)


@dataclass(frozen=True)
class KnowledgeEntry:
    id: str
    topic: str
    question: str
    answer: str
    keywords: tuple[str, ...]

    @property
    def match_text(self) -> str:
        return " ".join([self.question, self.topic, *self.keywords])


@dataclass(frozen=True)
class Match:
    entry: KnowledgeEntry
    score: int          # Q16.16
    lexical: int        # Q16.16
    structural: int     # Q16.16


@dataclass
class KnowledgeBase:
    """Read-only recall store with deterministic scoring."""

    entries: list[KnowledgeEntry] = field(default_factory=list)
    version: str = "0"
    threshold: int = F.fx(0.42)
    lexical_floor: int = DEFAULT_LEXICAL_FLOOR

    # ------------------------------------------------------------------
    @classmethod
    def load(
        cls,
        path: str | Path = DEFAULT_PATH,
        threshold: int | None = None,
        lexical_floor: int | None = None,
    ) -> "KnowledgeBase":
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        entries = [
            KnowledgeEntry(
                id=item["id"],
                topic=item["topic"],
                question=item["question"],
                answer=item["answer"],
                keywords=tuple(item.get("keywords", ())),
            )
            for item in raw["entries"]
        ]
        return cls(
            entries=entries,
            version=str(raw.get("version", "0")),
            threshold=threshold if threshold is not None else F.fx(0.42),
            lexical_floor=(
                lexical_floor if lexical_floor is not None else DEFAULT_LEXICAL_FLOOR
            ),
        )

    def get(self, entry_id: str) -> KnowledgeEntry | None:
        for entry in self.entries:
            if entry.id == entry_id:
                return entry
        return None

    # ------------------------------------------------------------------
    def index(self, core: DevstralCore) -> None:
        """Precompute the retrieval vectors once, at start-up."""
        self._vectorizer = HashVectorizer()
        self._lexical: dict[str, list[int]] = {
            e.id: self._vectorizer.vector(e.match_text) for e in self.entries
        }
        self._structural: dict[str, list[int]] = {
            e.id: core.intent_vector(e.match_text) for e in self.entries
        }
        self._tokens: dict[str, set[str]] = {
            e.id: self._vectorizer.content_tokens(e.match_text) for e in self.entries
        }
        self._core = core

    def _rank(self, query: str, query_intent: list[int] | None = None) -> list[Match]:
        if not getattr(self, "_lexical", None):
            raise RuntimeError("knowledge base has not been indexed")
        from .retrieval import cosine as vector_cosine
        from .tensor import cosine as intent_cosine

        qv = self._vectorizer.vector(query)
        q_tokens = self._vectorizer.content_tokens(query)
        ranked: list[Match] = []
        for entry in self.entries:
            lexical = F.div(
                F.add(
                    vector_cosine(qv, self._lexical[entry.id]),
                    overlap_coefficient(q_tokens, self._tokens[entry.id]),
                ),
                F.fx_int(2),
            )
            structural = (
                intent_cosine(query_intent, self._structural[entry.id])
                if query_intent is not None
                else 0
            )
            score = F.add(F.mul(LEXICAL_WEIGHT, lexical), F.mul(INTENT_WEIGHT, structural))
            ranked.append(Match(entry=entry, score=score, lexical=lexical, structural=structural))
        ranked.sort(key=lambda m: m.score, reverse=True)
        return ranked

    def best(self, query: str, query_intent: list[int] | None = None) -> Match | None:
        """Return the top entry above threshold, else ``None``."""
        ranked = self._rank(query, query_intent)
        if not ranked:
            return None
        top = ranked[0]
        if top.score < self.threshold:
            return None
        if top.lexical < self.lexical_floor:
            return None
        return top

    def explain(self, query: str, query_intent: list[int] | None = None, limit: int = 3) -> list[dict]:
        """Diagnostic view of retrieval scoring (used by the /api/introspect route)."""
        return [
            {
                "id": m.entry.id,
                "score": round(F.unfx(m.score), 4),
                "lexical": round(F.unfx(m.lexical), 4),
                "structural": round(F.unfx(m.structural), 4),
            }
            for m in self._rank(query, query_intent)[:limit]
        ]
