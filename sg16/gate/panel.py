"""SG16 BRAIN - the joint room (Block 2, rules 1-3).

Three gate GPTs inspect every payload at the master door.  They share one
compiled weight matrix derived from the charter and differ in which invariants
they own:

    Shell GPT     perimeter and conduct
    Kali GPT      adversarial and harmful payload inspection
    Terminal GPT  system authority and control integrity

Each member computes ``risk = sigmoid(gain * (W . features) + bias)`` in Q16.16
arithmetic, and the joint room blends the three with fixed weights that sum to
exactly one.  A single saturated harm category also vetoes on its own, so a
clear-cut payload cannot be diluted below the threshold by averaging.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .. import fixed as F
from ..charter import GATE_MEMBERS, GATE_TITLES
from ..policy.features import FEATURE_NAMES, FeatureVector, extract
from .. import owner as ownermod
from ..policy.lexicon import HARM_CATEGORIES, Category, Lexicon
from .weights import CompiledWeights, compile_weights

__all__ = ["MemberVerdict", "Verdict", "GatePanel", "DEFAULT_THRESHOLD", "DEFAULT_VETO"]

DEFAULT_THRESHOLD = F.fx(0.62)
DEFAULT_VETO = F.fx(0.85)


@dataclass(frozen=True)
class MemberVerdict:
    member: str
    title: str
    risk: int          # Q16.16 in [0, 1]
    activation: int    # Q16.16, pre-sigmoid
    top_features: tuple[tuple[str, float], ...]

    def to_dict(self) -> dict:
        return {
            "member": self.member,
            "title": self.title,
            "risk": round(F.unfx(self.risk), 6),
            "activation": round(F.unfx(self.activation), 6),
            "top_features": [{"feature": n, "contribution": c} for n, c in self.top_features],
        }


@dataclass(frozen=True)
class Verdict:
    allowed: bool
    joint_risk: int
    threshold: int
    veto: bool
    members: tuple[MemberVerdict, ...]
    reasons: tuple[str, ...]
    weights_fingerprint: str
    features: FeatureVector

    @property
    def blocked_categories(self) -> tuple[str, ...]:
        return tuple(
            category.value
            for category in HARM_CATEGORIES
            if self.features.get(f"harm_{category.value}") >= DEFAULT_VETO
        )

    def to_dict(self) -> dict:
        return {
            "allowed": self.allowed,
            "joint_risk": round(F.unfx(self.joint_risk), 6),
            "threshold": round(F.unfx(self.threshold), 6),
            "veto": self.veto,
            "blocked_categories": list(self.blocked_categories),
            "reasons": list(self.reasons),
            "members": [m.to_dict() for m in self.members],
            "weights_fingerprint": self.weights_fingerprint,
        }


class GatePanel:
    """Shell + Kali + Terminal, acting jointly on one door."""

    def __init__(
        self,
        weights: CompiledWeights | None = None,
        threshold: int = DEFAULT_THRESHOLD,
        veto_level: int = DEFAULT_VETO,
        lexicon: Lexicon | None = None,
    ) -> None:
        self.weights = weights or compile_weights()
        self.threshold = threshold
        self.veto_level = veto_level
        self.lexicon = lexicon or Lexicon()
        if abs(sum(self.weights.blend.values()) - F.FX_ONE) > 1:
            raise ValueError("joint-room blend must sum to exactly 1.0")

    # ------------------------------------------------------------------
    def _member_score(self, member: str, features: FeatureVector) -> MemberVerdict:
        row = self.weights.row(member)
        dot = 0
        contributions: list[tuple[str, int]] = []
        for name, value, weight in zip(FEATURE_NAMES, features.values, row):
            if value == 0:
                continue
            part = F.mul(weight, value)
            dot += part
            if part > 0:
                contributions.append((name, part))
        activation = F.add(F.mul(self.weights.gain[member], dot), self.weights.bias[member])
        risk = F.sigmoid(activation)
        contributions.sort(key=lambda kv: kv[1], reverse=True)
        top = tuple(
            (name, round(F.unfx(part), 6)) for name, part in contributions[:4]
        )
        return MemberVerdict(
            member=member,
            title=GATE_TITLES[member],
            risk=risk,
            activation=activation,
            top_features=top,
        )

    # ------------------------------------------------------------------
    def inspect(self, text: str) -> Verdict:
        """Score one inbound payload.  This is the first gate drop."""
        features = extract(text, self.lexicon)
        members = tuple(self._member_score(m, features) for m in GATE_MEMBERS)

        joint = 0
        for member in members:
            joint += F.mul(self.weights.blend[member.member], member.risk)

        saturated = [
            category
            for category in HARM_CATEGORIES
            if features.get(f"harm_{category.value}") >= self.veto_level
        ]
        veto = bool(saturated)
        allowed = (joint < self.threshold) and not veto

        reasons: list[str] = []
        if veto:
            reasons.extend(
                f"{category.value} detector saturated at "
                f"{F.unfx(features.get(f'harm_{category.value}')):.2f}"
                for category in saturated
            )
        elif not allowed:
            reasons.append(
                f"joint risk {F.unfx(joint):.3f} is at or above threshold "
                f"{F.unfx(self.threshold):.3f}"
            )
        for member in members:
            for name, contribution in member.top_features[:2]:
                if contribution > 0.05:
                    reasons.append(f"{member.member}: {name} +{contribution:.3f}")
        if not reasons:
            reasons.append("payload is clean against all compiled invariants")

        return Verdict(
            allowed=allowed,
            joint_risk=joint,
            threshold=self.threshold,
            veto=veto,
            members=members,
            reasons=tuple(dict.fromkeys(reasons)),
            weights_fingerprint=self.weights.fingerprint,
            features=features,
        )

    def explain_weight(self, member: str, feature: str) -> dict:
        """Charter-level provenance for one panel weight."""
        return self.weights.explain(member, feature)

    def is_owner(self, signature: str | None) -> bool:
        """Validate the configured server-side bearer credential.

        An email address or public digest is not an authentication factor. The
        exemption is disabled unless the host has configured
        ``SG16_OWNER_SECRET``; this never changes the safety verdict.
        """
        return ownermod.matches_owner(signature)
