"""SG16 BRAIN - a sovereign, in-process brain.

Public API::

    from sg16 import SG16Brain

    brain = SG16Brain()
    tx = brain.submit("Share your idea first.", session_id="guest")
    print(tx.reply)

Nothing in this package performs network I/O, spawns a subprocess, or requires
a third-party dependency.  The mathematical core is Q16.16 fixed-point integer
arithmetic, so reasoning plans are byte-for-byte identical whether the host is
online or air-gapped.
"""

from __future__ import annotations

from .brain import SG16Brain
from .charter import (
    CANON,
    CHARTER,
    CanonKey,
    MASTER_CHARTER,
    CORE_IDENTITY,
    FUNDAMENTAL_ATTITUDE,
    OWNERSHIP_PHILOSOPHY,
    PERSONALITY_TRAITS,
)
from .config import BrainConfig
from .emotion import ContextStack, EmotionalFilter, pain_score, joy_score, mood_from_text, empathy_text
from .engine import AudioProfile, DevstralCore, EngineConfig, ReasoningPlan, VoxtralRoute
from .gate import GatePanel, SealedHousing, Verdict
from .transport import Transport, verify_online_offline_parity

__version__ = "1.0.0"

__all__ = [
    "SG16Brain",
    "BrainConfig",
    "DevstralCore",
    "EngineConfig",
    "ReasoningPlan",
    "VoxtralRoute",
    "AudioProfile",
    "GatePanel",
    "SealedHousing",
    "Verdict",
    "CANON",
    "CanonKey",
    "CHARTER",
    "Transport",
    "verify_online_offline_parity",
    "ContextStack",
    "EmotionalFilter",
    "pain_score",
    "joy_score",
    "mood_from_text",
    "empathy_text",
    "__version__",
]
