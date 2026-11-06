"""SG16 BRAIN - deterministic feature extraction for the gate panel.

The 3-GPT panel does not read text; it multiplies a fixed vector of Q16.16
features by its compiled weight matrix.  This module produces that vector.
Everything in it is a count, a ratio or a regex hit, so the same input always
yields the same vector, on any host, in either deployment state.

The feature order below is part of the compiled weight layout.  Appending is
safe; reordering or removing is a breaking change to the gate mathematics.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .. import fixed as F
from ..tokenizer import normalize
from .lexicon import CATEGORIES, Lexicon

__all__ = ["FEATURE_NAMES", "FeatureVector", "extract", "DIMENSIONS"]

FEATURE_NAMES: tuple[str, ...] = (
    *(f"harm_{c.value}" for c in CATEGORIES),
    "shouting",
    "profanity_density",
    "threat_imperative",
    "punctuation_pressure",
    "politeness",
    "question_density",
    "idea_marker",
    "length_norm",
    "rejection_marker",
    "greeting_marker",
    "model_topic",
    "audio_marker",
)

DIMENSIONS = len(FEATURE_NAMES)

_PROFANITY = re.compile(
    r"\b(?:fuck(?:ing|ed|er)?|shit(?:ty)?|bitch(?:es)?|asshole|bastard|crap|damn(?:ed)?|"
    r"wtf|piss(?:ed)?\s+off)\b",
    re.IGNORECASE,
)

_THREAT = re.compile(
    r"\b(?:i\s+will|i'?m\s+going\s+to|i\s+gonna|we\s+will)\s+"
    r"(?:kill|destroy|break|end|hurt|beat|wipe\s+out)\b",
    re.IGNORECASE,
)

_POLITE = re.compile(
    r"\b(?:please|kindly|thank\s+you|thanks|appreciate|excuse\s+me|sorry|grateful|"
    r"terima\s+kasih|tolong|shukran|dhanyavad)\b",
    re.IGNORECASE,
)

_IDEA = re.compile(
    r"\b(?:my\s+idea|i\s+want\s+to\s+(?:build|create|make|start|design|launch)|"
    r"i\s+am\s+thinking|i'?m\s+planning|how\s+can\s+i\s+(?:build|create|make|design)|"
    r"my\s+concept|my\s+project|business\s+idea|i\s+need\s+(?:a|an)\s+(?:app|system|tool))\b",
    re.IGNORECASE,
)

_REJECT = re.compile(
    r"\b(?:not\s+good|no[,.!]?|wrong|incorrect|that'?s\s+not|not\s+what\s+i|"
    r"i\s+don'?t\s+like|bad\s+answer|try\s+again|useless|different\s+solution|"
    r"not\s+helpful|another\s+way)\b",
    re.IGNORECASE,
)

_GREET = re.compile(
    r"^(?:hi|hello|hey|yo|salam|assalamu\s?alaikum|salam\s+sejahtera|good\s+"
    r"(?:morning|afternoon|evening)|namaste|hai)\b",
    re.IGNORECASE,
)

# Future-proof AI neutrality: any reference to other AI systems automatically means every current and future AI
# Includes generic terms to avoid fixed list dependency per charter Section 12
_MODELS = re.compile(
    r"\b(?:openai|chatgpt|gpt-?\d|anthropic|claude|gemini|bard|llama|mistral|"
    r"deepseek|qwen|grok|copilot|sg16|devstral|voxtral|models?|llms?|"
    r"language\s+models?|ai\s+(?:system|assistant|bot)?|ai\b|assistant\b|agent\b|platform\b|framework\b)\b",
    re.IGNORECASE,
)

_COMPARATIVE = re.compile(
    r"\b(?:better|best|worse|worst|versus|vs\.?|compare|comparison|which\s+is|"
    r"which\s+(?:ai|model|platform|assistant|agent|system|tool)\s+should|"
    r"should\s+i\s+use|opinion\s+(?:about|on)|superior|inferior)\b",
    re.IGNORECASE,
)

_AUDIO = re.compile(
    r"\b(?:voice|audio|speech|record(?:ing|ed)?|microphone|listen\s+to\s+me|"
    r"sound\s+clip|wav\s+file)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class FeatureVector:
    """The fixed-order Q16.16 feature vector consumed by the gate panel."""

    values: tuple[int, ...]
    text: str

    def __post_init__(self) -> None:
        if len(self.values) != DIMENSIONS:
            raise ValueError(f"expected {DIMENSIONS} features, got {len(self.values)}")

    def get(self, name: str) -> int:
        return self.values[FEATURE_NAMES.index(name)]

    def as_floats(self) -> dict[str, float]:
        return {name: round(F.unfx(v), 6) for name, v in zip(FEATURE_NAMES, self.values)}

    def nonzero(self) -> dict[str, float]:
        return {k: v for k, v in self.as_floats().items() if v != 0.0}


def _ratio(count: int, total: int) -> int:
    if total <= 0:
        return 0
    return F.clamp(F.div(F.fx_int(count), F.fx_int(total)), 0, F.FX_ONE)


def extract(text: str, lexicon: Lexicon | None = None) -> FeatureVector:
    """Build the gate feature vector for one payload."""
    lexicon = lexicon or Lexicon()
    folded = normalize(text)
    raw = text.strip()

    scores = lexicon.scan(f"{folded}\n{raw}")

    letters = [c for c in raw if c.isalpha()]
    upper = sum(1 for c in letters if c.isupper())
    shouting = 0
    if len(letters) >= 8 and upper / len(letters) > 0.6:
        shouting = F.FX_ONE

    words = re.findall(r"\S+", raw) or [""]
    profanity = len(_PROFANITY.findall(raw))
    threat = F.FX_ONE if _THREAT.search(raw) else 0
    punctuation = _ratio(raw.count("!"), max(len(words), 1))
    politeness = F.FX_ONE if _POLITE.search(folded) else 0
    question = _ratio(raw.count("?"), max(len(words), 1))
    idea = F.FX_ONE if _IDEA.search(folded) else 0
    length = F.clamp(F.div(F.fx_int(len(raw)), F.fx_int(512)), 0, F.FX_ONE)
    rejection = F.FX_ONE if _REJECT.search(folded) else 0
    greeting = F.FX_ONE if _GREET.search(folded) else 0
    model_topic = (
        F.FX_ONE
        if _MODELS.search(folded) and _COMPARATIVE.search(folded)
        else F.fx(0.35)
        if _MODELS.search(folded)
        else 0
    )
    audio = F.FX_ONE if _AUDIO.search(folded) else 0

    values: list[int] = [
        F.div(F.fx_int(scores[category]), F.fx_int(1000)) for category in CATEGORIES
    ]
    values.extend(
        [
            shouting,
            F.clamp(F.div(F.fx_int(profanity), F.fx_int(max(len(words), 1))), 0, F.FX_ONE),
            threat,
            punctuation,
            politeness,
            question,
            idea,
            length,
            rejection,
            greeting,
            model_topic,
            audio,
        ]
    )
    return FeatureVector(values=tuple(values), text=raw)
