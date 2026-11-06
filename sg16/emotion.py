"""Small, English-only affect cues and bounded in-process context.

These rules are not emotion understanding. They recognize a narrow set of
explicit English distress phrases; unrecognized or non-English text is treated
as neutral. Structural encoder values are not interpreted as sentiment.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field

from . import fixed as F

__all__ = [
    "ContextEntry",
    "ContextStack",
    "EmotionalFilter",
    "pain_score",
    "joy_score",
    "mood_from_text",
    "combine_mood",
    "empathy_text",
    "mood_from_intent",
]

def _word_list(text: str) -> list[str]:
    import unicodedata
    folded = unicodedata.normalize("NFKC", text).casefold()
    words = re.findall(r"[^\W\d_]+", folded, flags=re.UNICODE)
    return words

def mood_from_intent(intent_vector: list[int]) -> int:
    """Return neutral: the structural intent vector is not sentiment-trained."""
    return 0

_DISTRESS_PATTERNS = (
    re.compile(r"\b(?:i feel|i'm feeling|i am feeling|i've been feeling)\s+(?:really\s+)?(?:sad|scared|afraid|anxious|worried|lonely|overwhelmed|hopeless|hurt|upset|depressed)\b", re.I),
    re.compile(r"\b(?:i'm|i am)\s+(?:having a hard time|struggling|not okay|not ok|overwhelmed)\b", re.I),
    re.compile(r"\b(?:i lost someone|someone close to me died|i'm grieving|i am grieving)\b", re.I),
)

_POSITIVE_PATTERNS = (
    re.compile(r"\b(?:i feel|i'm feeling|i am feeling)\s+(?:really\s+)?(?:happy|glad|excited|hopeful|relieved|proud)\b", re.I),
    re.compile(r"\b(?:that's great|that is great|i'm doing well|i am doing well|i'm okay|i am okay)\b", re.I),
)

def pain_score(text: str, intent_vector: list[int] | None = None) -> int:
    """Score a few explicit English distress phrases; otherwise return zero."""
    if not text:
        return 0
    hits = sum(bool(pattern.search(text)) for pattern in _DISTRESS_PATTERNS)
    return F.clamp(F.fx(min(hits, 3) * 0.25), 0, F.FX_ONE)

def joy_score(text: str, intent_vector: list[int] | None = None) -> int:
    """Score a few explicit English positive-affect phrases; not a mood model."""
    if not text:
        return 0
    hits = sum(bool(pattern.search(text)) for pattern in _POSITIVE_PATTERNS)
    return F.clamp(F.fx(min(hits, 3) * 0.25), 0, F.FX_ONE)

def mood_from_text(text: str, intent_vector: list[int] | None = None) -> int:
    """Return a bounded heuristic from a small English phrase list."""
    return F.clamp(F.sub(joy_score(text), pain_score(text)), -F.FX_ONE, F.FX_ONE)

def combine_mood(prev_mood: int, curr_mood: int, alpha: int = F.fx(0.55)) -> int:
    if prev_mood == 0:
        return F.clamp(curr_mood, -F.FX_ONE, F.FX_ONE)
    one_minus = F.sub(F.FX_ONE, alpha)
    return F.clamp(F.add(F.mul(alpha, prev_mood), F.mul(one_minus, curr_mood)), -F.FX_ONE, F.FX_ONE)

def empathy_text(mood: int, language: str | None = None) -> str | None:
    """Offer a restrained acknowledgement only for explicit distress cues."""
    if mood <= F.fx(-0.32):
        return "I'm sorry you're dealing with that. What would help most right now?"
    if mood <= F.fx(-0.12):
        return "That sounds difficult. Would you like help working through it?"
    return None

@dataclass(frozen=True)
class ContextEntry:
    text: str
    intent: tuple[int, ...]
    mood: int
    turn: int
    pain: int
    joy: int

    def to_dict(self) -> dict:
        return {
            "text": self.text[:200],
            "mood": round(F.unfx(self.mood), 4),
            "turn": self.turn,
            "pain": round(F.unfx(self.pain), 4),
            "joy": round(F.unfx(self.joy), 4),
            "intent_sig": hashlib.sha256(
                ",".join(map(str, self.intent)).encode("ascii")
            ).hexdigest()[:12],
        }

@dataclass
class ContextStack:
    max_entries: int = 8
    entries: list[ContextEntry] = field(default_factory=list)

    def push(self, text: str, intent: list[int], mood: int, turn: int, language: str | None = None) -> None:
        p = pain_score(text, intent)
        j = joy_score(text, intent)
        entry = ContextEntry(
            text=text.strip()[:2000],
            intent=tuple(intent),
            mood=mood,
            turn=turn,
            pain=p,
            joy=j,
        )
        self.entries.append(entry)
        while len(self.entries) > self.max_entries:
            self.entries.pop(0)

    @property
    def depth(self) -> int:
        return len(self.entries)

    def average_mood(self) -> int:
        if not self.entries:
            return 0
        total = sum(e.mood for e in self.entries)
        return F.div_round(total, len(self.entries))

    def summary(self) -> dict:
        return {
            "depth": self.depth,
            "avg_mood": round(F.unfx(self.average_mood()), 4),
            "entries": [e.to_dict() for e in self.entries[-3:]],
        }

    def to_dict(self) -> dict:
        return self.summary()

@dataclass
class EmotionalFilter:
    context: ContextStack = field(default_factory=ContextStack)

    def analyse(
        self, text: str, intent: list[int], prev_mood: int, turn: int, language: str | None = None
    ) -> dict:
        text_mood = mood_from_text(text, intent)
        combined = combine_mood(prev_mood, text_mood)
        self.context.push(text, intent, combined, turn, language)
        avg = self.context.average_mood()
        final_mood = F.add(F.mul(F.fx(0.60), combined), F.mul(F.fx(0.40), avg))
        return {
            "mood": final_mood,
            "text_mood": text_mood,
            "combined": combined,
            "average_mood": avg,
            "final_mood": final_mood,
            "pain": pain_score(text, intent),
            "joy": joy_score(text, intent),
            "empathy": empathy_text(final_mood),
            "context_depth": self.context.depth,
        }
