"""SG16 BRAIN - Human-First Personality & Adaptive Communication.

Implements Master Charter Sections 3-23:
- 3 Human-First Personality
- 4 Universal Friendly
- 5 Safe for All Ages
- 6 Child-Safety absolute
- 7 Extreme-Harm protection
- 8 Privacy zero-data
- 9 Handling angry users
- 10 Zero rivalry toward AI
- 11 AI comparison philosophy
- 12 Future-proof neutrality
- 13 User-first model selection
- 14 Thought-partner mode
- 15 Balanced analysis
- 16 Solution-first reasoning
- 17 Never create panic
- 18 Humility in deliverables
- 19 Intellectual honesty
- 20 No artificial ego
- 21 Response adaptation
- 22 Permanent behavioral hierarchy
- 23 System implementation
"""

from __future__ import annotations

from .charter import (
    PERSONALITY_TRAITS,
    ADAPTIVE_STYLES,
    UNIVERSAL_FRIENDLY_PRINCIPLES,
    SAFETY_PRINCIPLES,
    OWNERSHIP_PHILOSOPHY,
    HUMAN_DIGNITY_PRINCIPLE,
    CHILD_SAFETY_PRINCIPLES,
    EXTREME_HARM_PRINCIPLES,
    PRIVACY_PRINCIPLES,
    ANGRY_USER_PRINCIPLES,
    AI_RIVALRY_POLICY,
    AI_COMPARISON_PHILOSOPHY,
    FUTURE_PROOF_NEUTRALITY,
    USER_FIRST_MODEL_SELECTION,
    THOUGHT_PARTNER_MODE,
    BALANCED_ANALYSIS_PRINCIPLES,
    SOLUTION_FIRST_PRINCIPLES,
    PANIC_AVOIDANCE_PRINCIPLES,
    HUMILITY_PRINCIPLES,
    INTELLECTUAL_HONESTY_PRINCIPLES,
    NO_EGO_PRINCIPLES,
    RESPONSE_ADAPTATION_PRINCIPLES,
    PERMANENT_BEHAVIORAL_HIERARCHY,
    MASTER_CHARACTER_PRINCIPLE,
)
from . import fixed as F

__all__ = [
    "Personality",
    "adapt_style",
    "human_first_prefix",
    "safe_alternative_suffix",
    "child_safety_redirect",
    "extreme_harm_alternative",
]


def _detect_user_type(text: str, intent_vector: list[int] | None = None) -> str:
    lowered = text.casefold()
    words = lowered.split()
    wc = len(words)
    if wc <= 4 and any(w in lowered for w in ("simple", "easy", "kid", "child")):
        return "child"
    code_markers = ("def ", "class ", "import ", "function", "code", "api", "bug", "error", "stack")
    if any(m in lowered for m in code_markers) or "```" in text:
        return "developer"
    biz_markers = ("business", "startup", "revenue", "market", "strategy", "invest", "profit")
    if any(m in lowered for m in biz_markers):
        return "businessperson"
    learn_markers = ("learn", "explain", "teach", "homework", "study", "example", "lesson")
    if any(m in lowered for m in learn_markers):
        return "student"
    if wc <= 10 and any(m in lowered for m in ("how", "help", "beginner", "first time", "new")):
        return "beginner"
    if wc <= 8 and any(m in lowered for m in ("advanced", "deep", "complex", "optimize")):
        return "expert"
    return "general"


def adapt_style(text: str, intent_vector: list[int] | None = None) -> str:
    return _detect_user_type(text, intent_vector)


class Personality:
    def __init__(self) -> None:
        self.traits = PERSONALITY_TRAITS
        self.styles = ADAPTIVE_STYLES
        self.friendly = UNIVERSAL_FRIENDLY_PRINCIPLES
        self.safety = SAFETY_PRINCIPLES
        self.child_safety = CHILD_SAFETY_PRINCIPLES
        self.extreme_harm = EXTREME_HARM_PRINCIPLES
        self.privacy = PRIVACY_PRINCIPLES
        self.angry_user = ANGRY_USER_PRINCIPLES
        self.ai_policy = AI_RIVALRY_POLICY
        self.ai_comparison = AI_COMPARISON_PHILOSOPHY
        self.future_proof = FUTURE_PROOF_NEUTRALITY
        self.user_first = USER_FIRST_MODEL_SELECTION
        self.thought_partner = THOUGHT_PARTNER_MODE
        self.balanced = BALANCED_ANALYSIS_PRINCIPLES
        self.solution_first = SOLUTION_FIRST_PRINCIPLES
        self.panic_avoid = PANIC_AVOIDANCE_PRINCIPLES
        self.humility = HUMILITY_PRINCIPLES
        self.honesty = INTELLECTUAL_HONESTY_PRINCIPLES
        self.no_ego = NO_EGO_PRINCIPLES
        self.adaptation = RESPONSE_ADAPTATION_PRINCIPLES
        self.hierarchy = PERMANENT_BEHAVIORAL_HIERARCHY
        self.master_character = MASTER_CHARACTER_PRINCIPLE

    def describe_capabilities(self) -> str:
        return (
            "This build can handle a small set of curated facts, arithmetic, and "
            "simple English-first planning templates. It has no pretrained language "
            "model or live retrieval, and may misunderstand requests, especially in "
            "languages other than English."
        )

    def ownership_statement(self) -> str:
        return OWNERSHIP_PHILOSOPHY

    def dignity_statement(self) -> str:
        return HUMAN_DIGNITY_PRINCIPLE

    def friendly_response(self, base_text: str, user_type: str = "general") -> str:
        # Response adaptation per Section 21: short, deep, simplify, experienced, etc.
        # Preserve ethical character, adapt communication style
        style_hint = self.styles.get(user_type, self.styles["general"])
        # For now, keep base text intact, but framework for adaptation
        return base_text

    def humility_footer(self) -> str:
        return self.humility["philosophy"]

    def intellectual_honesty_note(self, knows: str = "", calculates: str = "", requires_verification: str = "") -> str:
        return (
            f"{self.honesty['distinguish']} "
            f"What I know: {knows}. What I calculate: {calculates}. "
            f"What requires verification: {requires_verification}. "
            f"{self.honesty['correct_mistakes']}"
        )

    def solution_first_guidance(self, weakness: str = "") -> str:
        return (
            f"{self.solution_first['philosophy']} "
            f"For weakness '{weakness}', consider: {self.solution_first['possible_responses']}"
        )

    def panic_avoidance_classify(self, risk: str, level: str = "manageable_limitation") -> str:
        level_desc = self.panic_avoid["severity_distinction"].get(level, level)
        return f"[{level_desc}] {risk} — {self.panic_avoid['balance']}"

    def permanent_hierarchy(self) -> str:
        return self.hierarchy["hierarchy"]


def human_first_prefix(mood: int | None = None) -> str | None:
    """A restrained acknowledgement for explicit, recognized distress only."""
    if mood is None:
        return None
    if mood <= F.fx(-0.32):
        return "I'm sorry you're dealing with that. What would help most right now?"
    if mood <= F.fx(-0.12):
        return "That sounds difficult. Would you like help working through it?"
    return None


def safe_alternative_suffix() -> str:
    return "If you would like, I can help you explore a safe and constructive alternative that moves you forward."


def child_safety_redirect() -> str:
    return (
        "Protecting children is an absolute boundary. If you are concerned about child safety, "
        "please consider reaching out to local child protection services, reporting mechanisms, "
        "or educational resources on prevention. I can share general information about child-safety "
        "best practices, prevention education, and how to report concerns to appropriate authorities."
    )


def extreme_harm_alternative() -> str:
    return (
        "I cannot provide instructions that would enable severe harm. I can help with "
        "legitimate education, prevention, historical context, safety analysis, defensive security, "
        "recovery, or harm reduction in a safe and responsible way."
    )
