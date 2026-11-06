"""Product identity inscription and a small set of curated identity lines.

The designation is hashed with the structural matrix fingerprint at
construction time. This verifies that metadata pair; it does not authenticate
a person or provide general language detection or translation.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from .charter import (
    CORE_IDENTITY,
    FUNDAMENTAL_ATTITUDE,
    OWNERSHIP_PHILOSOPHY,
    PERSONALITY_TRAITS,
    HUMAN_DIGNITY_PRINCIPLE,
    MASTER_CHARTER,
)

__all__ = [
    "OFFICIAL_NAME",
    "DESIGNATION",
    "UTTERANCE",
    "NATIVE_UTTERANCES",
    "IdentityInscription",
    "inscribe",
    "verify",
    "detect_identity_query",
    "utterance_for",
    "FUNDAMENTAL_ATTITUDE",
    "OWNERSHIP_PHILOSOPHY",
    "PERSONALITY_TRAITS",
    "HUMAN_DIGNITY_PRINCIPLE",
]

OFFICIAL_NAME = CORE_IDENTITY
DESIGNATION = "SG16"
UTTERANCE = (
    "I'm Sovereign SG16 Brain, an AI assistant from the SG16 project. "
    "This build uses deterministic code and curated information rather than "
    "a general-purpose pretrained language model."
)

# Extended identity with charter-aligned attitude
EXTENDED_UTTERANCE = (
    f"{UTTERANCE} {FUNDAMENTAL_ATTITUDE} {OWNERSHIP_PHILOSOPHY}"
)

# Short identity-line translations for selected locale tags only. These are
# not a claim of general language understanding, translation, or generation.
NATIVE_UTTERANCES: dict[str, str] = {
    "en": UTTERANCE,
    "bn": "আমি Sovereign SG16 Brain, একটি AI সহকারী।",
    "ar": "أنا Sovereign SG16 Brain، مساعد ذكاء اصطناعي.",
    "zh": "我是 Sovereign SG16 Brain，一个人工智能助手。",
    "hi": "मैं Sovereign SG16 Brain, एक AI सहायक हूँ।",
    "ur": "میں Sovereign SG16 Brain ہوں، ایک مصنوعی ذہانت کا معاون۔",
    "fr": "Je suis Sovereign SG16 Brain, un assistant d’intelligence artificielle.",
    "de": "Ich bin Sovereign SG16 Brain, ein KI-Assistent.",
    "es": "Soy Sovereign SG16 Brain, un asistente de inteligencia artificial.",
    "pt": "Sou Sovereign SG16 Brain, um assistente de inteligência artificial.",
    "ru": "Я Sovereign SG16 Brain, ИИ-помощник.",
    "ja": "私はSovereign SG16 Brain、AIアシスタントです。",
    "ko": "저는 Sovereign SG16 Brain, AI 비서입니다.",
    "tr": "Ben Sovereign SG16 Brain, bir yapay zekâ asistanıyım.",
    "fa": "من Sovereign SG16 Brain، یک دستیار هوش مصنوعی هستم.",
    "he": "אני Sovereign SG16 Brain, עוזר בינה מלאכותית.",
    "sw": "Mimi ni Sovereign SG16 Brain, msaidizi wa akili bandia.",
}

_IDENTITY_PATTERNS = re.compile(
    r"(?:"
    r"what(?:'s|\s+is)\s+your\s+name"
    r"|who\s+are\s+you"
    r"|your\s+name"
    r"|introduce\s+yourself"
    r"|তুমি\s+কে"
    r"|তোমার\s+নাম"
    r"|আপনি\s+কে"
    r"|কে\s+আপনি"
    r"|你是谁"
    r"|你叫什么"
    r"|あなたは誰"
    r"|comment\s+t'appelles"
    r"|wer\s+bist\s+du"
    r"|كيف\s+اسمك"
    r"|तुम\s+कौन\s+हो"
    r"|आप\s+कौन\s+हैं"
    r")",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class IdentityInscription:
    """SHA-256 bond between the matrix fingerprint and the official name."""

    official_name: str
    designation: str
    matrix_sha256: str
    digest: str

    def to_dict(self) -> dict:
        return {
            "official_name": self.official_name,
            "designation": self.designation,
            "matrix_sha256": self.matrix_sha256,
            "digest": self.digest,
        }


def inscribe(matrix_sha256: str) -> IdentityInscription:
    """Commit the core matrix to its own name at construction (Block 7 rule 1)."""
    payload = f"{matrix_sha256}|{OFFICIAL_NAME}|{DESIGNATION}|sg16.identity.v1"
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return IdentityInscription(
        official_name=OFFICIAL_NAME,
        designation=DESIGNATION,
        matrix_sha256=matrix_sha256,
        digest=digest,
    )


def verify(matrix_sha256: str, digest: str) -> bool:
    """True when the digest matches the matrix inscription."""
    return inscribe(matrix_sha256).digest == digest


def detect_identity_query(text: str) -> bool:
    """True when the payload is asking who the brain is."""
    stripped = text.strip()
    if not stripped:
        return False
    if _IDENTITY_PATTERNS.search(stripped):
        return True
    lower = stripped.casefold()
    if OFFICIAL_NAME.casefold() in lower and any(
        w in lower for w in ("who", "name", "identity", "designation")
    ):
        return True
    return False


def utterance_for(language: str) -> str:
    """Return a curated identity line for a selected locale tag.

    Only keys present in ``NATIVE_UTTERANCES`` have a localized line; this is
    not general-purpose language detection or translation.
    """
    return NATIVE_UTTERANCES.get(language, UTTERANCE)
