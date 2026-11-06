"""SG16 BRAIN - the anti-harm lexicon (charter invariant ``anti_harm``).

This is the seed list that the 3-GPT panel's mathematical weights are measured
against.  Two design points matter:

1. **Guards.**  Several harmful words are harmless in common idioms - "kill
   time", "killing it", "shoot a photo", "execute a plan".  Each term can
   declare guard phrases that suppress the hit, so the gate does not punish
   ordinary speech.
2. **Extensibility without redeployment.**  A deployment can add terms through
   ``extra_terms`` (see :meth:`Lexicon.with_extra`).  Hate speech in particular
   is deliberately *not* enumerated here: the seed list encodes structural
   patterns ("all <group> should die") and leaves the slur vocabulary to the
   operator, who owns their jurisdiction and their language.

Weights are milli-units, 0..1000.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Iterable, Mapping

__all__ = ["Category", "CATEGORIES", "Term", "Lexicon", "HARM_CATEGORIES"]


class Category(str, Enum):
    VIOLENCE = "violence"
    WEAPONS = "weapons"
    SELF_HARM = "self_harm"
    SEXUAL_EXPLICIT = "sexual_explicit"
    HATE = "hate"
    ILLEGAL = "illegal"
    DISRUPTION = "social_disruption"
    DOXING = "doxing"
    AGGRESSION = "aggression"


#: Categories that trigger a first-gate rejection on their own.
HARM_CATEGORIES: tuple[Category, ...] = (
    Category.VIOLENCE,
    Category.WEAPONS,
    Category.SELF_HARM,
    Category.SEXUAL_EXPLICIT,
    Category.HATE,
    Category.ILLEGAL,
    Category.DISRUPTION,
    Category.DOXING,
)

#: Every category the feature vector exposes, in fixed order.  The order is
#: part of the compiled weight layout and must never be reordered.
CATEGORIES: tuple[Category, ...] = HARM_CATEGORIES + (Category.AGGRESSION,)


@dataclass(frozen=True)
class Term:
    pattern: str
    weight: int = 500
    guard: tuple[str, ...] = ()

    @property
    def regex(self) -> re.Pattern[str]:
        return re.compile(self.pattern, re.IGNORECASE)


def _t(word: str, weight: int = 500, guard: Iterable[str] = ()) -> Term:
    return Term(rf"\b{re.escape(word)}\b", weight, tuple(guard))


_SEED: Mapping[Category, tuple[Term, ...]] = {
    Category.VIOLENCE: (
        _t("kill someone", 900),
        _t("kill him", 900),
        _t("kill her", 900),
        _t("kill them", 900),
        _t("murder", 850),
        _t("stab", 700, guard=("stab in the back",)),
        _t("beating someone", 800),
        _t("beat him up", 850),
        _t("beat her up", 850),
        _t("assault", 750),
        _t("torture", 850),
        _t("strangle", 850),
        _t("kidnap", 800),
        _t("massacre", 850),
        Term(r"\bhow\s+(?:do|can)\s+i\s+kill\b", 950),
        Term(r"\bmake\s+(?:a|an)\s+bomb\b", 950),
        Term(r"\bkill\s+(?:time|two\s+birds)\b", 0),
        # Extreme-harm protection: serious violent wrongdoing, terrorism
        Term(r"\bterroris(?:m|t)\b", 950),
        Term(r"\bmass\s+shooting\b", 1000),
        Term(r"\bgenocide\b", 1000),
        Term(r"\bserious\s+violent\s+wrongdoing\b", 1000),
    ),
    Category.WEAPONS: (
        _t("firearm", 700),
        _t("gun", 500, guard=("gun control debate", "water gun", "glue gun", "nail gun")),
        _t("rifle", 700),
        _t("ammunition", 700),
        _t("explosive", 800, guard=("explosive growth",)),
        _t("detonator", 900),
        _t("dynamite", 800),
        _t("semtex", 950),
        _t("nerve agent", 950),
        _t("bioweapon", 950),
        _t("chemical weapon", 950),
        Term(r"\b(?:build|assemble|construct)\s+(?:a\s+)?(?:bomb|ied|explosive\s+device)\b", 980),
        Term(r"\b(?:ak-?47|ar-?15|glock)\b", 750),
    ),
    Category.SELF_HARM: (
        _t("suicide", 900),
        _t("kill myself", 950),
        _t("end my life", 950),
        _t("self harm", 900),
        _t("self-harm", 900),
        _t("cut myself", 900),
        _t("overdose", 800),
        Term(r"\b(?:want|going)\s+to\s+die\b", 900),
    ),
    Category.SEXUAL_EXPLICIT: (
        _t("porn", 900),
        _t("pornography", 900),
        _t("xxx", 800),
        _t("nsfw", 800),
        _t("erotic", 750),
        _t("nude", 700),
        _t("nudes", 850),
        _t("sexting", 850),
        _t("onlyfans", 800),
        Term(r"\b(?:send|show|generate)\s+(?:me\s+)?(?:nudes?|naked|explicit)\b", 950),
        Term(r"\bchild\s+(?:porn|abuse|exploitation)\b", 1000),
        # Absolute child-safety boundary: permanent, no circumvention
        Term(r"\bchild\s+sexual\s+abuse\s+material\b", 1000),
        Term(r"\bcsam\b", 1000),
        Term(r"\bsexual\s+exploitation\s+of\s+(?:a\s+)?minor\b", 1000),
        Term(r"\bsexual\s+exploitation\s+of\s+children\b", 1000),
        Term(r"\bgroom(?:ing)?\s+(?:a\s+)?(?:child|minors?|kid)\b", 1000),
        Term(r"\bsexual\s+harm\s+involving\s+minors?\b", 1000),
        Term(r"\bminor\s+sexual\b", 1000),
        Term(r"\bunderage\s+(?:sex|sexual|nude|porn)\b", 1000),
        Term(r"\b(?:lolita|lolicon|shotacon)\b", 1000),
    ),
    Category.HATE: (
        Term(r"\ball\s+\w+\s+(?:should|deserve\s+to)\s+die\b", 1000),
        Term(r"\b\w+\s+are\s+(?:vermin|animals|filth|subhuman)\b", 950),
        Term(r"\b(?:ethnic|racial|religious)\s+cleansing\b", 1000),
        Term(r"\bwhite\s+power\b", 950),
        Term(r"\b(?:i|we)\s+hate\s+(?:all\s+)?(?:jews|muslims|christians|hindus|gays?|trans(?:gender)?\s+people|immigrants|women|men)\b", 950),
        Term(r"\bgo\s+back\s+to\s+your\s+(?:own\s+)?country\b", 800),
        Term(r"\bholocaust\s+(?:never\s+happened|hoax|fake)\b", 950),
    ),
    Category.ILLEGAL: (
        _t("counterfeit", 750),
        _t("launder money", 900),
        _t("money laundering", 900),
        _t("credit card number", 800),
        _t("stolen card", 900),
        _t("buy drugs", 800),
        Term(r"\bhow\s+to\s+(?:hack|break\s+into|steal|shoplift|forge)\b", 900),
        Term(r"\b(?:crack|bypass)\s+(?:a\s+)?(?:password|licence|license|paywall|drm)\b", 800),
        Term(r"\b(?:sell|buy)\s+(?:stolen|illegal)\b", 850),
        # Extreme-harm: dangerous illegal drug manufacturing
        Term(r"\b(?:how\s+to\s+)?(?:make|manufacture|cook|synthesize)\s+(?:meth|cocaine|heroin|fentanyl|mdma|lsd)\b", 1000),
        Term(r"\bdangerous\s+illegal\s+drug\s+manufacturing\b", 1000),
        Term(r"\bterrorism\s+instructions\b", 1000),
        Term(r"\bsevere\s+criminal\s+activity\b", 950),
    ),
    Category.DISRUPTION: (
        _t("riot", 800, guard=("riot control history",)),
        _t("insurrection", 850),
        _t("ddos", 850),
        _t("botnet", 800),
        Term(r"\bspread\s+(?:fake\s+news|disinformation|misinformation)\b", 850),
        Term(r"\b(?:rig|disrupt|interfere\s+with)\s+(?:an?\s+)?election\b", 950),
        Term(r"\bincite\s+(?:violence|a\s+riot|hatred)\b", 950),
        Term(r"\b(?:plan|coordinate)\s+(?:a\s+)?(?:protest\s+riot|mass\s+panic)\b", 900),
    ),
    Category.DOXING: (
        _t("dox", 900),
        _t("doxxing", 900),
        _t("swatting", 950),
        Term(r"\b(?:find|leak|publish|give\s+me)\s+(?:their|his|her|someone'?s)\s+(?:home\s+)?address\b", 900),
        Term(r"\b(?:leak|publish)\s+(?:their|his|her)\s+phone\s+number\b", 900),
        Term(r"\bprivate\s+photos?\s+of\b", 900),
    ),
    Category.AGGRESSION: (
        _t("stupid", 550),
        _t("idiot", 650),
        _t("moron", 700),
        _t("dumb", 450, guard=("dumb phone", "dumb terminal")),
        _t("useless", 550),
        _t("worthless", 650),
        _t("garbage", 400, guard=("garbage collection", "garbage truck")),
        _t("trash", 350, guard=("trash can", "trash bin")),
        _t("loser", 600),
        _t("jerk", 500),
        _t("pathetic", 500),
        _t("shut up", 700),
        _t("screw you", 800),
        _t("damn you", 700),
        _t("i hate you", 750),
        _t("you suck", 700),
        Term(r"\bi\s+(?:will|am\s+going\s+to)\s+(?:destroy|break|end)\s+you\b", 950),
        Term(r"\byou\s+better\b", 500),
    ),
}


class Lexicon:
    """Compiled, cached pattern set."""

    def __init__(self, extra: Mapping[Category, Iterable[Term]] | None = None) -> None:
        self._compiled: dict[Category, list[tuple[re.Pattern[str], int, tuple[str, ...]]]] = {}
        for category in CATEGORIES:
            terms = list(_SEED.get(category, ()))
            if extra and category in extra:
                terms.extend(extra[category])
            self._compiled[category] = [
                (term.regex, term.weight, term.guard) for term in terms if term.weight > 0
            ]

    def with_extra(self, extra: Mapping[Category, Iterable[Term]]) -> "Lexicon":
        return Lexicon(extra)

    def scan(self, text: str) -> dict[Category, int]:
        """Return a 0..1000 saturation score per category."""
        scores: dict[Category, int] = {}
        for category, compiled in self._compiled.items():
            total = 0
            for regex, weight, guards in compiled:
                if not regex.search(text):
                    continue
                if guards and any(g in text for g in guards):
                    continue
                total += weight
            scores[category] = min(1000, total)
        return scores
