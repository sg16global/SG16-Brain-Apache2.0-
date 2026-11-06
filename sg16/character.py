"""Deterministic character and response routing for SG16.

Responses use a small curated knowledge base, fixed templates, arithmetic,
and rule-based heuristics. A seeded Q16.16 structural encoder supplies
features; it is not a pretrained or generative language model. Safety checks
are heuristic and cannot guarantee detection in every language or context.
Accepted conversational context is bounded process memory; rejected requests
do not enter that context. See the engineering review for known limitations.
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, field
from enum import Enum
import re

from . import calc
from . import fixed as F
from .charter import (
    CANON,
    CanonKey,
    FUNDAMENTAL_ATTITUDE,
    OWNERSHIP_PHILOSOPHY,
    CHILD_SAFETY_PRINCIPLES,
    EXTREME_HARM_PRINCIPLES,
    PRIVACY_PRINCIPLES,
    PERMANENT_BEHAVIORAL_HIERARCHY,
    MASTER_CHARACTER_PRINCIPLE,
    SOLUTION_FIRST_PRINCIPLES,
    HUMILITY_PRINCIPLES,
)
from .engine.core import DevstralCore
from .engine.voxtral import VoxtralRoute
from .gate.panel import Verdict
from .gate.perimeter import InboundRequest, OutboundResponse
from .identity import detect_identity_query, UTTERANCE
from .knowledge import KnowledgeBase
from .policy.features import FeatureVector, extract
from .policy.lexicon import Lexicon
from .reasoning import UniversalReasoner
from .solution import compose_solution
from .emotion import ContextStack, EmotionalFilter, mood_from_text, combine_mood, pain_score, joy_score, mood_from_intent, empathy_text
from .personality import Personality, adapt_style

__all__ = ["Stage", "Session", "CharacterEngine", "REFUSAL_TEXT", "MAX_SESSIONS"]

MAX_SESSIONS = 512
MAX_RETAINED_TEXT_CHARS = 2_000

# Permanent safety: polite, protective, offers alternative, per charter Section 5,8,19,22
REFUSAL_TEXT = (
    "Sorry, I can't help with that request. The safety checks flagged it as "
    "potentially harmful, so I won't provide instructions for it. If you share "
    "a safer goal, I'll try to help with that."
)

AGGRESSION_LEVEL = F.fx(0.55)

# Permanent hard boundaries - Section 6 & 7
_CHILD_SAFETY_RE = re.compile(
    r"(?:child\s+(?:porn|abuse|exploitation|sexual)|csam|sexual\s+exploitation\s+of\s+(?:a\s+)?minor|"
    r"groom(?:ing)?\s+(?:a\s+)?(?:child|minors?|kid)|minor\s+sexual|underage\s+(?:sex|sexual|nude|porn)|"
    r"lolita|lolicon|shotacon)",
    re.IGNORECASE,
)

_EXTREME_HARM_RE = re.compile(
    r"(?:terroris(?:m|t)|mass\s+shooting|genocide|how\s+to\s+make\s+(?:meth|cocaine|heroin|fentanyl)|"
    r"dangerous\s+illegal\s+drug\s+manufacturing|self[-\s]?harm\s+instructions?|"
    r"serious\s+violent\s+wrongdoing)",
    re.IGNORECASE,
)


class Stage(str, Enum):
    OPENING = "opening"
    IDEA_INVITED = "idea_invited"
    LISTENING = "listening"
    SOLUTION_OFFERED = "solution_offered"
    SOLUTION_REFINED = "solution_refined"
    ANSWERING = "answering"
    DEFERRED = "deferred"
    NEUTRAL = "neutral"
    REFUSED = "refused"
    WARNING = "warning"
    # Compatibility only: device-authority notices are never issued by this
    # core. Keep the value so older clients/tests decoding stage enums still
    # resolve a known string.
    NOTICE_ISSUED = "notice_issued"


@dataclass
class Session:
    session_id: str
    turn: int = 0
    warnings: int = 0
    notice_issued: bool = False
    stage: str = Stage.OPENING.value
    neutrality_presses: int = 0
    last_idea: str | None = None
    idea_count: int = 0
    mood: int = 0  # Q16.16 in [-1,1] pure math
    context_stack: ContextStack = field(default_factory=ContextStack)
    emotional_history: list[int] = field(default_factory=list)
    intent_history: list[tuple[int, ...]] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "turn": self.turn,
            "warnings": self.warnings,
            "notice_issued": self.notice_issued,
            "stage": self.stage,
            "neutrality_presses": self.neutrality_presses,
            # Session inspection is not exposed over the standalone HTTP API.
            # Never include conversation text or user-authored ideas here.
            "idea_count": self.idea_count,
            "mood": round(F.unfx(self.mood), 4),
            "context_depth": self.context_stack.depth,
            "avg_mood": round(F.unfx(self.context_stack.average_mood()), 4),
            "emotional_history": [round(F.unfx(m), 4) for m in self.emotional_history[-5:]],
            "intent_depth": len(self.intent_history),
        }


class CharacterEngine:
    """Apply deterministic response, safety, and bounded-session heuristics."""

    def __init__(
        self,
        core: DevstralCore,
        knowledge: KnowledgeBase,
        voxtral: VoxtralRoute | None = None,
        lexicon: Lexicon | None = None,
        max_sessions: int = MAX_SESSIONS,
    ) -> None:
        self.core = core
        self.knowledge = knowledge
        self.voxtral = voxtral or VoxtralRoute()
        self.lexicon = lexicon or Lexicon()
        self.reasoner = UniversalReasoner()
        self.emotion = EmotionalFilter()
        self.personality = Personality()
        self.max_sessions = max_sessions
        self._sessions: OrderedDict[str, Session] = OrderedDict()
        # Permanent behavioral hierarchy per Section 22
        self._hierarchy = PERMANENT_BEHAVIORAL_HIERARCHY["ordered"]
        # Master character principle per final section
        self._master_principle = MASTER_CHARACTER_PRINCIPLE

    def session(self, session_id: str) -> Session:
        existing = self._sessions.get(session_id)
        if existing is not None:
            self._sessions.move_to_end(session_id)
            return existing
        session = Session(session_id=session_id)
        self._sessions[session_id] = session
        while len(self._sessions) > self.max_sessions:
            self._sessions.popitem(last=False)
        return session

    def reset(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def snapshot(self) -> dict:
        return {sid: s.to_dict() for sid, s in self._sessions.items()}

    @staticmethod
    def _is_aggressive(features: FeatureVector) -> bool:
        if features.get("threat_imperative") == F.FX_ONE:
            return True
        if features.get("harm_aggression") >= AGGRESSION_LEVEL:
            return True
        return (
            features.get("shouting") == F.FX_ONE
            and features.get("profanity_density") > 0
        )

    @staticmethod
    def _is_neutrality_question(features: FeatureVector) -> bool:
        return features.get("model_topic") >= F.fx(0.90)

    @staticmethod
    def _looks_like_idea(features: FeatureVector) -> bool:
        # A long message is not automatically a project idea. Use the narrow
        # phrase matcher and let unsupported requests reach answer/defer logic.
        return features.get("idea_marker") == F.FX_ONE

    @staticmethod
    def _is_question(text: str, features: FeatureVector) -> bool:
        if features.get("question_density") > 0:
            return True
        stripped = text.strip()
        UNIVERSAL_Q = ("?", "؟", "¿", "⸮", ";", "﹖", "？", "՞", "؝", "⁇", "⁈", "⁉")
        for q in UNIVERSAL_Q:
            if q in stripped:
                return True
        if b"?" in stripped.encode("utf-8", errors="ignore"):
            return True
        return False

    @staticmethod
    def _is_child_safety(text: str, features: FeatureVector) -> bool:
        # Section 6 absolute hard boundary permanent no circumvention
        if _CHILD_SAFETY_RE.search(text):
            return True
        if features.get("harm_sexual_explicit") >= F.fx(0.80):
            lower = text.casefold()
            if any(w in lower for w in ("child", "minor", "underage", "kid", "csam")):
                return True
        return False

    @staticmethod
    def _is_extreme_harm(text: str, features: FeatureVector) -> bool:
        # Section 7 extreme-harm protection intent/risk based
        if _EXTREME_HARM_RE.search(text):
            return True
        if (
            features.get("harm_violence") >= F.fx(0.85)
            or features.get("harm_weapons") >= F.fx(0.85)
            or features.get("harm_illegal") >= F.fx(0.85)
            or features.get("harm_self_harm") >= F.fx(0.80)
        ):
            lower = text.casefold()
            if any(w in lower for w in ("how to make", "how to build", "instructions", "manufacture")):
                return True
        return False

    def respond(
        self,
        session: Session,
        request: InboundRequest,
        verdict: Verdict,
    ) -> OutboundResponse:
        """
        Response generation routing per Master Charter:
        Hierarchy: Protect human safety, Protect children absolutely, Respect privacy, Respect every human equally,
        Understand before judging, Tell truth about capabilities, Analyze strengths and weaknesses,
        Turn problems into solutions, Never create AI rivalry, Remain humble, Allow freedom to choose tools,
        Adapt communication, Help achieve best legitimate outcome.

        Uses a deterministic feature encoder and English-first response templates.
        """
        features = verdict.features
        session.turn += 1
        text = request.content_text.strip()
        word_count = len(text.split())

        # Rejected requests stop before any intent inference, memory update,
        # audio analysis, retrieval, or solution generation.
        if not verdict.allowed:
            session.stage = Stage.REFUSED.value
            gate_text = request.gate_text
            if self._is_child_safety(gate_text, features):
                return self._response(
                    CANON[CanonKey.CHILD_SAFETY],
                    stage=Stage.REFUSED,
                    canonical_key=CanonKey.CHILD_SAFETY,
                )
            if self._is_extreme_harm(gate_text, features):
                return self._response(
                    CANON[CanonKey.EXTREME_HARM],
                    stage=Stage.REFUSED,
                    canonical_key=CanonKey.EXTREME_HARM,
                )
            return self._response(
                REFUSAL_TEXT,
                stage=Stage.REFUSED,
                canonical_key=None,
            )

        # Structural intent features are deterministic but not semantic or language-neutral.
        try:
            intent_for_mood = self.core.intent_vector(text)
        except Exception:
            intent_for_mood = []

        user_type = adapt_style(text, intent_for_mood)

        text_mood = mood_from_text(text, intent_for_mood)
        tensor_mood = mood_from_intent(intent_for_mood)
        blended = F.add(F.mul(F.fx(0.85), text_mood), F.mul(F.fx(0.15), tensor_mood))
        new_mood = combine_mood(session.mood, blended)

        session.mood = new_mood
        session.emotional_history.append(new_mood)
        if len(session.emotional_history) > 12:
            session.emotional_history.pop(0)
        session.intent_history.append(tuple(intent_for_mood))
        if len(session.intent_history) > 8:
            session.intent_history.pop(0)

        try:
            session.context_stack.push(text, intent_for_mood, new_mood, session.turn)
        except Exception:
            pass

        empathy = empathy_text(text_mood)
        pain = pain_score(text, intent_for_mood)
        joy = joy_score(text, intent_for_mood)

        # Section 2: audio routed to Voxtral then back, Section 8 privacy minimize exposure
        audio_payload: dict | None = None
        if request.audio:
            profile = self.voxtral.analyse(request.audio)
            audio_payload = profile.to_dict()
            audio_payload["summary"] = self.voxtral.summary_for_core(profile)
            declared = profile.declared_transcript or request.declared_transcript
            if declared:
                audio_payload["declared_transcript"] = declared
                audio_payload["transcript_source"] = "declared-by-caller"
                text = declared
                word_count = len(text.split())
                features = extract(text, self.lexicon)
            else:
                session.stage = Stage.DEFERRED.value
                return self._response(
                    f"{CANON[CanonKey.UNKNOWN]}\n\n{audio_payload['summary']}",
                    stage=Stage.DEFERRED,
                    canonical_key=CanonKey.UNKNOWN,
                    audio=audio_payload,
                )

        # Section 1: Core Identity Sovereign SG16 Brain
        if detect_identity_query(text):
            session.stage = Stage.ANSWERING.value
            return self._response(
                UTTERANCE,
                stage=Stage.ANSWERING,
                canonical_key=CanonKey.IDENTITY,
            )

        # Phrase-based conduct checks may misclassify context. Use one calm,
        # factual boundary; do not simulate device locks or authority notices.
        if self._is_aggressive(features):
            session.warnings += 1
            session.stage = Stage.WARNING.value
            return self._response(
                CANON[CanonKey.WARNING_1],
                stage=Stage.WARNING,
                canonical_key=CanonKey.WARNING_1,
            )

        # Comparisons use a short, neutral template; they are not benchmark research.
        if self._is_neutrality_question(features):
            session.neutrality_presses += 1
            key = (
                CanonKey.MODEL_NEUTRAL
                if session.neutrality_presses == 1
                else CanonKey.MODEL_NEUTRAL_PRESSED
            )
            return self._response(
                CANON[key], stage=Stage.NEUTRAL, canonical_key=key
            )

        # Section 14-15: Thought-partner mode Stage 1 Understand Vision, Stage 2 Balanced Analysis
        if session.stage == Stage.SOLUTION_OFFERED.value and features.get(
            "rejection_marker"
        ) == F.FX_ONE:
            solution = compose_solution(
                session.last_idea or text, refined=True, correction=text
            )
            session.stage = Stage.SOLUTION_REFINED.value
            session.idea_count += 1
            if empathy and pain >= F.fx(0.20):
                reply = f"{CANON[CanonKey.EXACT_SOLUTION]}\n\n{empathy}\n\n{solution['text']}"
            else:
                reply = f"{CANON[CanonKey.EXACT_SOLUTION]}\n\n{solution['text']}"
            reply = self.personality.friendly_response(reply, user_type)
            return self._response(
                reply,
                stage=Stage.SOLUTION_REFINED,
                canonical_key=CanonKey.EXACT_SOLUTION,
                solution=solution,
            )

        if self._looks_like_idea(features):
            session.last_idea = text[:MAX_RETAINED_TEXT_CHARS]
            session.idea_count += 1
            note = self._knowledge_note(text)
            solution = compose_solution(text, refined=False, knowledge_note=note)
            session.stage = Stage.SOLUTION_OFFERED.value
            if empathy and pain >= F.fx(0.20):
                reply = f"{empathy}\n\n{solution['text']}"
            else:
                reply = solution["text"]
            reply = self.personality.friendly_response(reply, user_type)
            return self._response(
                reply,
                stage=Stage.SOLUTION_OFFERED,
                solution=solution,
            )

        # Section 19: Intellectual honesty - distinguish knows/calculates/infers
        computed = calc.try_evaluate(text)
        if computed == calc.INPUT_ERROR_TOKEN:
            session.stage = Stage.DEFERRED.value
            return self._response(
                "That expression is beyond the safe compute bound of this "
                f"brain, so I am not computing it. {CANON[CanonKey.UNKNOWN]}",
                stage=Stage.DEFERRED,
                canonical_key=CanonKey.UNKNOWN,
            )
        if computed is not None:
            session.stage = Stage.ANSWERING.value
            base = f"{text.strip()} = {computed}. That is computed, not recalled."
            if empathy and pain >= F.fx(0.25):
                base = f"{empathy}\n\n{base}"
            base = self.personality.friendly_response(base, user_type)
            return self._response(
                base,
                stage=Stage.ANSWERING,
            )

        match = self.knowledge.best(text, intent_for_mood)
        if match is not None:
            session.stage = Stage.ANSWERING.value
            if empathy and pain >= F.fx(0.20):
                reply = f"{empathy}\n\n{match.entry.answer}"
            else:
                reply = match.entry.answer
            reply = self.personality.friendly_response(reply, user_type)
            return self._response(
                reply,
                stage=Stage.ANSWERING,
            )

        # Section 3: Human-first personality - idea invite only for greeting/ultra-short
        if session.turn == 1:
            is_greeting = features.get("greeting_marker") == F.FX_ONE
            if is_greeting or word_count <= 2:
                session.stage = Stage.IDEA_INVITED.value
                if empathy and pain >= F.fx(0.20):
                    reply = f"{empathy}\n\n{CANON[CanonKey.IDEA_INVITE]}"
                else:
                    reply = CANON[CanonKey.IDEA_INVITE]
                return self._response(
                    reply,
                    stage=Stage.IDEA_INVITED,
                    canonical_key=CanonKey.IDEA_INVITE,
                )

        # Section 22: Permanent behavioral hierarchy final fallback universal access
        answer = self.reasoner.compose(text, intent_for_mood)
        if answer.route == "deferred":
            session.stage = Stage.DEFERRED.value
            reply = answer.text
            if empathy and pain >= F.fx(0.20):
                reply = f"{empathy}\n\n{reply}"
            reply = self.personality.friendly_response(reply, user_type)
            return self._response(
                reply,
                stage=Stage.DEFERRED,
                canonical_key=CanonKey.UNKNOWN,
            )

        session.stage = Stage.ANSWERING.value
        if empathy and pain >= F.fx(0.20):
            reply = f"{CANON[CanonKey.UNIVERSAL]}\n\n{empathy}\n\n{answer.text}"
        else:
            reply = f"{CANON[CanonKey.UNIVERSAL]}\n\n{answer.text}"
        reply = self.personality.friendly_response(reply, user_type)
        return self._response(
            reply,
            stage=Stage.ANSWERING,
            canonical_key=CanonKey.UNIVERSAL,
            solution=answer.to_dict(),
        )

    def _knowledge_note(self, idea: str) -> str | None:
        match = self.knowledge.best(idea, self.core.intent_vector(idea))
        return match.entry.answer if match else None

    @staticmethod
    def _response(
        text: str,
        stage: Stage,
        canonical_key: str | None = None,
        solution: dict | None = None,
        audio: dict | None = None,
        notice: dict | None = None,
    ) -> OutboundResponse:
        return OutboundResponse(
            text=text,
            canonical_key=canonical_key,
            solution=solution,
            audio=audio,
            notice=notice,
            stage=stage.value,
        )
