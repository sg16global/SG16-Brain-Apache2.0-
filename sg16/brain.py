"""SG16 BRAIN - the orchestrator.

:class:`SG16Brain` is the handler that lives inside the sealed housing.  It is
the only thing that may touch the core working area, and it only ever receives
work through :meth:`SealedHousing.transact`, which is the master door.

Request path, end to end::

    caller
      -> SealedHousing.transact
        -> MasterDoor.enter          (GatePanel: Shell + Kali + Terminal)
             rejected  -> thrown back at the first gate, core never runs
             accepted  -> CharacterEngine.respond
                            -> audio?  Voxtral -> back to Devstral
                            -> DevstralCore.plan   (Q16.16 forward pass)
                            -> knowledge / arithmetic / canonical deferral
        -> MasterDoor.exit           (no re-inspection, entry seal attached)
      -> Transaction
"""

from __future__ import annotations

import hashlib
from dataclasses import replace

from . import identity as identity_mod
from .character import REFUSAL_TEXT, CharacterEngine, Session
from .config import BrainConfig
from .engine.core import DevstralCore
from .identity import NATIVE_UTTERANCES
from .engine.voxtral import EnvelopeError, VoxtralRoute
from .gate.panel import GatePanel, Verdict
from .gate.perimeter import (
    InboundRequest,
    OutboundResponse,
    SealedHousing,
    Transaction,
)
from .knowledge import KnowledgeBase
from .policy.lexicon import Lexicon
from .transport import Transport, verify_online_offline_parity

__all__ = ["SG16Brain", "PARITY_PAYLOADS"]

PARITY_PAYLOADS = (
    "Share your idea first.",
    "I want to build a solar dryer for my village",
    "how does the master door work",
    "which is better, openai or claude",
    "سلام عليكم، أريد أن أبني مشروعاً",
    "What's your name?",
    "তুমি কে? তোমার নাম কি?",
    "what is the capital of France",
)


class SG16Brain:
    """Sovereign brain: sealed perimeter, one door, in-process mathematics."""

    def __init__(self, config: BrainConfig | None = None) -> None:
        self.config = config or BrainConfig.default()
        self.lexicon = Lexicon()
        # The shipped response path has no autoregressive language-model
        # implementation. Use the deterministic Q16.16 structural encoder for
        # planning and retrieval.
        requested_model_type = self.config.engine_model_type
        self.core = DevstralCore(self.config.engine)
        self.devstral_core = self.core
        self._primary_core_for_knowledge = self.core
        self.model_capabilities = {
            "requested_model_type": requested_model_type,
            "active_component": self.core.config.head,
            "component_type": "seeded fixed-point structural encoder",
            "pretrained_weights_loaded": False,
            "generative_language_model": False,
            "response_method": "deterministic templates, curated knowledge, and arithmetic",
            "note": "This build does not include a pretrained generative language model.",
        }

        self.knowledge = KnowledgeBase.load(
            self.config.knowledge_path,
            self.config.knowledge_threshold,
            self.config.knowledge_lexical_floor,
        )
        try:
            self.knowledge.index(self._primary_core_for_knowledge)
        except Exception:
            # fallback indexing with the structural core
            self.knowledge.index(self.devstral_core if hasattr(self, 'devstral_core') else self.core)
        self.panel = GatePanel(
            threshold=self.config.gate_threshold,
            veto_level=self.config.gate_veto,
            lexicon=self.lexicon,
        )
        self.character = CharacterEngine(
            core=self.core,
            knowledge=self.knowledge,
            voxtral=VoxtralRoute(),
            lexicon=self.lexicon,
            max_sessions=self.config.max_sessions,
        )
        self.housing = SealedHousing(self.panel, self)
        self._counter = 0

    # ------------------------------------------------------------------
    # the handler contract used by the master door
    # ------------------------------------------------------------------
    def process(self, request: InboundRequest, verdict: Verdict) -> OutboundResponse:
        """Called by the door *after* the gate has already decided."""
        session = self.character.session(request.session_id)
        response = self.character.respond(session, request, verdict)
        if not verdict.allowed:
            # Block 2 rule 3: a rejected payload never reaches the core.
            return response
        plan = self.core.plan(
            request.content_text,
            route="audio" if request.audio else "text",
            transport=request.transport,
        )
        return replace(response, plan=plan.to_dict())

    # ------------------------------------------------------------------
    # public surface
    # ------------------------------------------------------------------
    def submit(
        self,
        text: str,
        session_id: str = "default",
        audio: bytes | None = None,
        declared_transcript: str | None = None,
        request_id: str | None = None,
    ) -> Transaction:
        """Send one payload through the master door."""
        # SG16 envelopes may carry a caller-declared transcript in their
        # header. Extract it before the gate so audio content cannot bypass
        # text moderation. This is metadata parsing only; audio without a
        # declared transcript remains untranscribed and is deferred later.
        if audio and not (isinstance(declared_transcript, str) and declared_transcript.strip()):
            try:
                header, _ = VoxtralRoute.split_envelope(audio)
            except EnvelopeError:
                header = {}
            candidate = header.get("transcript")
            if isinstance(candidate, str) and candidate.strip():
                declared_transcript = candidate.strip()

        self._counter += 1
        if request_id is None:
            seed = f"{session_id}|{self._counter}|{text}|{len(audio or b'')}"
            request_id = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:24]
        request = InboundRequest(
            request_id=request_id,
            session_id=session_id,
            text=text,
            audio=audio,
            declared_transcript=declared_transcript,
            transport=self.config.transport.value,
        )
        return self.housing.transact(request)

    def session(self, session_id: str) -> Session:
        return self.character.session(session_id)

    def reset_session(self, session_id: str) -> None:
        self.character.reset(session_id)

    def introspect(self, text: str) -> dict:
        """Full gate and retrieval breakdown for one payload (diagnostics)."""
        verdict = self.panel.inspect(text)
        if not verdict.allowed:
            return {
                "text_chars": len(text),
                "verdict": verdict.to_dict(),
                "refusal": REFUSAL_TEXT,
                "features": verdict.features.as_floats(),
                "retrieval": None,
                "plan": None,
            }
        plan = self.core.plan(text, transport=self.config.transport.value)
        return {
            "text_chars": len(text),
            "verdict": verdict.to_dict(),
            "features": verdict.features.as_floats(),
            "retrieval": self.knowledge.explain(text, plan.intent_vector),
            "plan": plan.to_dict(),
        }

    def explain_weight(self, member: str, feature: str) -> dict:
        return self.panel.explain_weight(member, feature)

    def parity_report(self, payloads=PARITY_PAYLOADS) -> dict:
        return verify_online_offline_parity(self.core, payloads).to_dict()

    def identity(self) -> dict:
        """The designation-protocol handshake payload (Block 7, rule 2) + Master Charter."""
        from .charter import (
            MASTER_CHARTER,
            FUNDAMENTAL_ATTITUDE,
            OWNERSHIP_PHILOSOPHY,
            PERSONALITY_TRAITS,
            HUMAN_DIGNITY_PRINCIPLE,
        )

        path = self.core.identity_path()
        return {
            "designation": self.config.designation,
            "official_name": self.config.official_name,
            "utterance": path["utterance"],
            "fundamental_attitude": FUNDAMENTAL_ATTITUDE,
            "ownership_philosophy": OWNERSHIP_PHILOSOPHY,
            "personality_traits": list(PERSONALITY_TRAITS),
            "human_dignity": HUMAN_DIGNITY_PRINCIPLE,
            "master_charter": {
                "title": MASTER_CHARTER["title"],
                "purpose": MASTER_CHARTER["purpose"],
                "sections": list(MASTER_CHARTER.keys()),
            },
            "native": dict(NATIVE_UTTERANCES),
            "language_capabilities": {
                "input_encoding": "UTF-8",
                "language_identification": "not implemented",
                "translation": "not implemented",
                "general_multilingual_generation": False,
                "response_language": "Mostly English deterministic templates and curated answers",
                "identity_line_locale_tags": sorted(NATIVE_UTTERANCES),
                "note": "Unicode input is accepted, but this is not all-language understanding or generation.",
            },
            "inscription": path["inscription"],
            "tensor": path["tensor"],
            "verified": path["verified"],
        }

    def health(self) -> dict:
        from .charter import PRIVACY_PRINCIPLES, CHILD_SAFETY_PRINCIPLES, EXTREME_HARM_PRINCIPLES

        base = {
            "status": "ready",
            "brain": self.config.name,
            "official_name": self.config.official_name,
            "designation": self.config.designation,
            "identity_sha256": self.core.identity_inscription.digest,
            "identity_verified": identity_mod.verify(
                self.core.matrix_sha256, self.core.identity_inscription.digest
            ),
            "version": self.config.version,
            "domain": self.config.domain,
            "transport": self.config.transport.value,
            "air_gapped": self.config.transport.air_gapped,
            "core": self.core.config.head,
            "model_capabilities": dict(self.model_capabilities),
            "language_capabilities": {
                "input_encoding": "UTF-8",
                "language_identification": "not implemented",
                "translation": "not implemented",
                "general_multilingual_generation": False,
                "response_language": "Mostly English deterministic templates and curated answers",
                "identity_line_locale_tags": sorted(NATIVE_UTTERANCES),
            },
            "core_matrix_sha256": self.core.matrix_sha256,
            "gate_weights_sha256": self.panel.weights.fingerprint,
            "knowledge_entries": len(self.knowledge.entries),
            "knowledge_version": self.knowledge.version,
            "topology": self.housing.topology(),
            "door": self.housing.door.counters(),
            "config": self.config.summary(),
            "privacy": {
                "core_session_state": "bounded process memory; cleared on reset, session eviction, or process restart",
                "max_sessions": self.character.max_sessions,
                "max_context_entries_per_session": 8,
                "max_retained_text_chars_per_entry": 2000,
                "session_api_includes_raw_text": False,
                "rejected_requests_added_to_context": False,
                "deployment_logging": "HTTP, reverse-proxy, and platform logs depend on deployment configuration and are not covered by the core's in-memory session policy",
                "principles": dict(PRIVACY_PRINCIPLES["stateless_rules"]),
            },
            "child_safety": {
                "boundary": CHILD_SAFETY_PRINCIPLES["boundary"],
                "permanence": CHILD_SAFETY_PRINCIPLES["permanence"],
            },
            "extreme_harm": {
                "protection": EXTREME_HARM_PRINCIPLES["refusal"],
                "intelligent_protection": EXTREME_HARM_PRINCIPLES["goal"],
            },
        }

        base["engine_model_type"] = self.config.engine_model_type
        base["trained_model_serving"] = False
        base["external_model_api"] = False
        return base
