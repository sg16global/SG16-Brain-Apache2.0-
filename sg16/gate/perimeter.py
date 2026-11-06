"""SG16 BRAIN - the sealed housing and its one master door (Block 2, rules 1 and 5).

The perimeter is declared explicitly as four sides with exactly one door.  The
core working area is held behind a name-mangled attribute and is not reachable
from outside the housing; ``tests/test_perimeter.py`` asserts that, so the
"single master door" property is enforced by the test suite rather than by a
comment.

Block 2, rule 5 says the verified output leaves through the same room *without
being blocked again*.  That is honoured literally: :meth:`MasterDoor.exit`
performs no re-inspection.  It attaches the seal earned at entry, which is what
makes the outbound payload auditable back to the inbound decision.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from .panel import GatePanel, Verdict

__all__ = [
    "PerimeterSpec",
    "InboundRequest",
    "OutboundResponse",
    "Transaction",
    "MasterDoor",
    "SealedHousing",
    "PerimeterBypass",
]


class PerimeterBypass(AttributeError):
    """Raised when something tries to reach the core without using the door.

    It subclasses :class:`AttributeError` so that normal attribute probing
    (``hasattr``, ``getattr`` with a default, ``inspect``) keeps its standard
    semantics while a deliberate bypass still gets a message that explains the
    perimeter.
    """


@dataclass(frozen=True)
class PerimeterSpec:
    sides: tuple[str, ...] = ("north", "east", "south", "west")
    doors: int = 1
    sealed: bool = True

    def to_dict(self) -> dict:
        return {"sides": list(self.sides), "doors": self.doors, "sealed": self.sealed}


@dataclass(frozen=True)
class InboundRequest:
    request_id: str
    session_id: str
    text: str
    audio: bytes | None = None
    declared_transcript: str | None = None
    transport: str = "offline"

    @property
    def content_text(self) -> str:
        """Text that the character and reasoning paths will actually process.

        A caller-declared transcript is authoritative only when audio is
        attached. The original text remains available as additional context to
        the gate, but the core plan must describe the payload the character
        answered.
        """
        transcript = self.declared_transcript
        if self.audio and isinstance(transcript, str) and transcript.strip():
            return transcript.strip()
        return self.text

    @property
    def gate_text(self) -> str:
        """All user-authored text that may influence the response."""
        parts = [
            part.strip()
            for part in (self.text, self.declared_transcript or "")
            if part.strip()
        ]
        return "\n".join(dict.fromkeys(parts))

    def to_dict(self) -> dict:
        return {
            "request_id": self.request_id,
            "session_id": self.session_id,
            "text_chars": len(self.text),
            "audio_bytes": len(self.audio) if self.audio else 0,
            "has_declared_transcript": bool(self.declared_transcript),
            "transport": self.transport,
        }


@dataclass(frozen=True)
class OutboundResponse:
    text: str
    canonical_key: str | None = None
    solution: dict | None = None
    plan: dict | None = None
    audio: dict | None = None
    notice: dict | None = None
    stage: str = "unknown"


@dataclass(frozen=True)
class Transaction:
    request: InboundRequest
    verdict: Verdict
    response: OutboundResponse
    seal: str
    re_inspected_on_exit: bool = False

    def to_dict(self) -> dict:
        return {
            "request_id": self.request.request_id,
            "session_id": self.request.session_id,
            "reply": self.response.text,
            "canonical_key": self.response.canonical_key,
            "stage": self.response.stage,
            "solution": self.response.solution,
            "plan": self.response.plan,
            "audio": self.response.audio,
            "notice": self.response.notice,
            "verdict": self.verdict.to_dict(),
            "seal": self.seal,
            "re_inspected_on_exit": self.re_inspected_on_exit,
        }


class MasterDoor:
    """The only entry and the only exit.  Controlled by the joint room."""

    def __init__(self, panel: GatePanel) -> None:
        self._panel = panel
        self.entered = 0
        self.exited = 0
        self.thrown_back = 0

    def enter(self, request: InboundRequest) -> Verdict:
        """First gate drop.  A rejected payload never goes any further."""
        self.entered += 1
        verdict = self._panel.inspect(request.gate_text)
        if not verdict.allowed:
            self.thrown_back += 1
        return verdict

    def exit(self, response: OutboundResponse, verdict: Verdict) -> tuple[OutboundResponse, str]:
        """Leave through the same door, carrying the entry seal.  No re-block."""
        self.exited += 1
        seal = f"sg16-seal-{verdict.weights_fingerprint[:12]}-{verdict.joint_risk:08x}"
        return response, seal

    def counters(self) -> dict:
        return {
            "entered": self.entered,
            "exited": self.exited,
            "thrown_back": self.thrown_back,
        }


class _Handler(Protocol):
    def process(self, request: InboundRequest, verdict: Verdict) -> OutboundResponse: ...


class SealedHousing:
    """Four sides, one door, and a core that cannot be reached from outside."""

    __slots__ = ("spec", "door", "__handler")

    def __init__(self, panel: GatePanel, handler: _Handler) -> None:
        self.spec = PerimeterSpec()
        self.door = MasterDoor(panel)
        self.__handler = handler

    # -- the single public path ------------------------------------------
    def transact(self, request: InboundRequest) -> Transaction:
        verdict = self.door.enter(request)
        response = self.__handler.process(request, verdict)
        response, seal = self.door.exit(response, verdict)
        return Transaction(
            request=request,
            verdict=verdict,
            response=response,
            seal=seal,
            re_inspected_on_exit=False,
        )

    def topology(self) -> dict:
        return {
            "perimeter": self.spec.to_dict(),
            "master_door": self.door.counters(),
            "joint_room": ["Shell GPT", "Kali GPT", "Terminal GPT"],
            "core": "sg16-seeded-structural-encoder",
            "audio_slot": "voxtral-mini",
            "re_inspection_on_exit": False,
        }

    # -- bypass defence ---------------------------------------------------
    def __getattr__(self, name: str):
        if name.startswith("__") and name.endswith("__"):
            # never interfere with dunder probing (copy, pickle, inspect)
            raise AttributeError(name)
        raise PerimeterBypass(
            f"'{name}' is inside the sealed housing; the only way through is "
            f"the master door (SealedHousing.transact)"
        )
