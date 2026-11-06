"""SG16 BRAIN - transport state and online/offline parity (Block 3, rule 2).

The transport label describes the *host*, never the mathematics.  It is
therefore declared by the operator and never probed: a network check would be
an external dependency, and the whole point of this module is that the engine
has none.

    SG16_TRANSPORT=online|offline      (default: offline)

``verify_online_offline_parity`` runs the same payloads under both labels and
proves the reasoning plans are byte-for-byte identical.  That is the executable
form of the parity claim, and it is asserted by the test suite on every run.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from enum import Enum
from typing import TYPE_CHECKING, Iterable

if TYPE_CHECKING:  # pragma: no cover
    from .engine.core import DevstralCore, ReasoningPlan

__all__ = [
    "Transport",
    "current",
    "plan_fingerprint",
    "verify_online_offline_parity",
    "ENV_VAR",
]

ENV_VAR = "SG16_TRANSPORT"


class Transport(str, Enum):
    ONLINE = "online"
    OFFLINE = "offline"

    @property
    def air_gapped(self) -> bool:
        return self is Transport.OFFLINE


def current() -> Transport:
    """Read the declared transport.  Never touches the network."""
    raw = os.environ.get(ENV_VAR, "offline").strip().lower()
    try:
        return Transport(raw)
    except ValueError:
        return Transport.OFFLINE


def plan_fingerprint(plan: "ReasoningPlan") -> str:
    """A single digest over the whole plan, transport label excluded."""
    hasher = hashlib.sha256()
    hasher.update(plan.config_fingerprint.encode("ascii"))
    hasher.update(b"\x1f")
    hasher.update(plan.plan_sha256.encode("ascii"))
    hasher.update(b"\x1f")
    hasher.update(",".join(map(str, plan.intent)).encode("ascii"))
    hasher.update(b"\x1f")
    hasher.update("|".join(plan.steps).encode("ascii"))
    return hasher.hexdigest()


@dataclass(frozen=True)
class ParityReport:
    payloads: int
    identical: bool
    online_digest: str
    offline_digest: str
    mismatches: tuple[str, ...]

    def to_dict(self) -> dict:
        return {
            "payloads": self.payloads,
            "identical": self.identical,
            "online_digest": self.online_digest,
            "offline_digest": self.offline_digest,
            "mismatches": list(self.mismatches),
            "conclusion": (
                "reasoning plans are byte-for-byte identical across transports"
                if self.identical
                else "PARITY VIOLATION"
            ),
        }


def verify_online_offline_parity(
    core: "DevstralCore", payloads: Iterable[str]
) -> ParityReport:
    """Run every payload under both transport labels and compare digests."""
    texts = list(payloads)
    online: list[str] = []
    offline: list[str] = []
    mismatches: list[str] = []

    for text in texts:
        a = plan_fingerprint(core.plan(text, transport=Transport.ONLINE.value))
        b = plan_fingerprint(core.plan(text, transport=Transport.OFFLINE.value))
        online.append(a)
        offline.append(b)
        if a != b:
            mismatches.append(text[:64])

    digest_online = hashlib.sha256("".join(online).encode("ascii")).hexdigest()
    digest_offline = hashlib.sha256("".join(offline).encode("ascii")).hexdigest()
    return ParityReport(
        payloads=len(texts),
        identical=digest_online == digest_offline and not mismatches,
        online_digest=digest_online,
        offline_digest=digest_offline,
        mismatches=tuple(mismatches),
    )
