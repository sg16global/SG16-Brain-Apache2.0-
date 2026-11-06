"""SG16 BRAIN - gate package: the sealed housing and its single master door."""

from __future__ import annotations

from .panel import DEFAULT_THRESHOLD, DEFAULT_VETO, GatePanel, MemberVerdict, Verdict
from .perimeter import MasterDoor, PerimeterSpec, SealedHousing
from .weights import CompiledWeights, compile_weights

__all__ = [
    "GatePanel",
    "MemberVerdict",
    "Verdict",
    "DEFAULT_THRESHOLD",
    "DEFAULT_VETO",
    "CompiledWeights",
    "compile_weights",
    "SealedHousing",
    "MasterDoor",
    "PerimeterSpec",
]
