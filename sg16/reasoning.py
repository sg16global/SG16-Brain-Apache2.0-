"""Bounded deterministic answer helper for a small set of known facts.

This is not a generative language model. It recognizes a few literal topics
and composes a neutral comparison template; unknown queries must be deferred
rather than decorated with a tensor signature and presented as answered.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from . import fixed as F
from .charter import AI_COMPARISON_PHILOSOPHY, USER_FIRST_MODEL_SELECTION, FUTURE_PROOF_NEUTRALITY

__all__ = ["UniversalAnswer", "UniversalReasoner"]

_KNOWN_GLOBAL: dict[str, str] = {
    "capital of france": "Paris",
    "capital of france?": "Paris",
    "population of earth": "approximately 8 billion people",
    "speed of light": "299,792,458 metres per second",
    "pi": "3.141592653589793 (computed constant)",
}

# Future-proof AI comparison detection: any current and future AI
_AI_COMPARISON_RE = re.compile(
    r"(?:which\s+(?:ai|model|platform|assistant|agent|system|tool)\s+(?:is\s+)?(?:best|better|more intelligent)|"
    r"is\s+(?:another\s+)?ai\s+better|is\s+sovereign\s+sg16\s+brain\s+better|"
    r"what\s+do\s+you\s+think\s+about\s+(?:another\s+)?ai|"
    r"compare.*ai|ai\s+comparison)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class UniversalAnswer:
    text: str
    route: str = "universal"
    confidence: float = 1.0
    topic_terms: tuple[str, ...] = ()
    aspect_count: int = 3

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "route": self.route,
            "confidence": self.confidence,
            "topic_terms": list(self.topic_terms),
            "aspect_count": self.aspect_count,
        }


class UniversalReasoner:
    def compose(
        self,
        text: str,
        intent_vector: list[int],
        mood: int | None = None,
        context=None,
        language: str | None = None,
    ) -> UniversalAnswer:
        normalized = " ".join(text.strip().casefold().split())
        raw_terms = normalized.split()
        topic_terms = tuple(w for w in raw_terms if len(w) > 2)[:8]
        ascii_terms = [w for w in raw_terms if len(w) > 3 and w.isascii()]
        aspect_count = max(3, min(len(ascii_terms) or len(topic_terms) or 3, 8))

        # Section 11-13: AI comparison philosophy - mature useful analysis
        if _AI_COMPARISON_RE.search(text) or (" ai " in f" {normalized} " and any(w in normalized for w in ("best", "better", "which", "compare"))):
            # Future-proof: every current and future AI per Section 12
            body = (
                f"{AI_COMPARISON_PHILOSOPHY['core_philosophy']} "
                f"{AI_COMPARISON_PHILOSOPHY['approach']} "
                f"{USER_FIRST_MODEL_SELECTION['principle']} "
                f"{FUTURE_PROOF_NEUTRALITY['universal_definition']}"
            )
            if mood is not None and mood <= F.fx(-0.12):
                body = self._with_empathy(body, mood)
            return UniversalAnswer(
                text=body,
                route="universal",
                topic_terms=topic_terms,
                aspect_count=aspect_count,
            )

        for key, value in _KNOWN_GLOBAL.items():
            if key in normalized:
                localized = value
                if mood is not None and mood <= F.fx(-0.12):
                    localized = self._with_empathy(localized, mood)
                return UniversalAnswer(
                    text=localized,
                    route="universal",
                    topic_terms=topic_terms,
                    aspect_count=aspect_count,
                )

        body = (
            "I don't have enough reliable information to answer that from this build's "
            "small curated knowledge base, and I can't fetch live sources here. "
            "If you share a source or a little more context, I'll help analyze it."
        )
        if mood is not None and mood <= F.fx(-0.15):
            body = self._with_empathy(body, mood)
        return UniversalAnswer(
            text=body,
            route="deferred",
            confidence=0.0,
            topic_terms=topic_terms,
            aspect_count=0,
        )

    @staticmethod
    def _with_empathy(answer: str, mood: int) -> str:
        if mood <= F.fx(-0.32):
            return f"{answer}\n\nI'm sorry you're dealing with that. What would help most right now?"
        if mood <= F.fx(-0.12):
            return f"{answer}\n\nThat sounds difficult. Would you like help working through it?"
        return answer
