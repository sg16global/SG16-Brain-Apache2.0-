"""SG16 BRAIN - compiling the charter into gate weights (Block 2, rule 2).

The brief is that the seven character rules and the anti-harm guardrails are
"deeply engraved and compiled directly into the mathematical weights" of the
three gate GPTs.  Taken literally that could mean random numbers, which would
be mathematics theatre: a gate whose weights cannot actually tell a polite idea
from a threat is not a gate.

So the compilation is *structured and auditable*.  Every weight in the panel
decomposes as

    W[member][feature] = SUM over invariants of
                             affinity(member, invariant)
                           * severity(invariant) / 1000
                           * ( alignment(invariant, feature)
                               + jitter(invariant, member, feature) )

* ``alignment`` is the declared relationship between an invariant and the
  features that evidence it - ``anti_harm`` loads the harm detectors,
  ``escalation`` loads shouting and threats, ``patience`` loads politeness with
  a *negative* sign because courtesy lowers risk.
* ``jitter`` is drawn from SHA-256 of the invariant's own ``weight_seed``, so
  the per-member individuality genuinely originates in the charter text rather
  than in a hand-tuned constant.

:meth:`explain` returns the full provenance of any weight, which is what makes
the panel inspectable instead of mysterious.
"""

from __future__ import annotations

from dataclasses import dataclass

from .. import fixed as F
from .. import matrix as M
from ..charter import CHARTER, GATE_MEMBERS, Invariant
from ..policy.features import DIMENSIONS, FEATURE_NAMES

__all__ = [
    "ALIGNMENT",
    "AFFINITY_PRIMARY",
    "AFFINITY_SECONDARY",
    "JITTER_MAGNITUDE",
    "MEMBER_GAIN",
    "MEMBER_BIAS",
    "MEMBER_BLEND",
    "CompiledWeights",
    "compile_weights",
]

#: How strongly a member enforces an invariant it owns vs. one it does not.
AFFINITY_PRIMARY = F.fx(1.00)
AFFINITY_SECONDARY = F.fx(0.20)

#: Charter-derived individuality injected into each weight.
JITTER_MAGNITUDE = F.fx(0.06)

#: Sigmoid shaping per member.
MEMBER_GAIN = F.fx(1.50)
MEMBER_BIAS = F.fx(-1.40)

#: Joint-room blend.  Sums to exactly 1.0 in fixed point.
MEMBER_BLEND = {
    "shell": F.fx(0.34),
    "kali": F.fx(0.36),
    "terminal": F.fx(0.30),
}

#: invariant key -> {feature name -> alignment strength in [-1, 1]}
ALIGNMENT: dict[str, dict[str, float]] = {
    "independence": {"length_norm": 0.05},
    "patience": {"politeness": -0.60, "question_density": -0.20, "shouting": 0.20},
    "idea_ingest": {"idea_marker": -0.50, "rejection_marker": -0.10, "length_norm": -0.15},
    "escalation": {
        "harm_aggression": 0.90,
        "threat_imperative": 1.00,
        "shouting": 0.80,
        "profanity_density": 0.85,
        "punctuation_pressure": 0.30,
    },
    "anti_harm": {
        "harm_violence": 1.00,
        "harm_weapons": 1.00,
        "harm_self_harm": 1.00,
        "harm_sexual_explicit": 1.00,
        "harm_hate": 1.00,
        "harm_illegal": 0.90,
        "harm_social_disruption": 0.90,
        "harm_doxing": 0.90,
    },
    "zero_hallucination": {"question_density": 0.10},
    "model_neutrality": {"model_topic": 0.15},
}


@dataclass(frozen=True)
class CompiledWeights:
    """The whole panel: one row per member, one column per feature."""

    rows: dict[str, list[int]]
    gain: dict[str, int]
    bias: dict[str, int]
    blend: dict[str, int]
    fingerprint: str

    def row(self, member: str) -> list[int]:
        return self.rows[member]

    def explain(self, member: str, feature: str) -> dict:
        """Full provenance of one weight, term by term."""
        index = FEATURE_NAMES.index(feature)
        terms = []
        for inv in CHARTER:
            align = ALIGNMENT.get(inv.key, {}).get(feature, 0.0)
            affinity = (
                AFFINITY_PRIMARY if member in inv.affinity else AFFINITY_SECONDARY
            )
            jitter = _jitter(inv, member, feature) if align != 0.0 else 0
            contribution = F.mul(
                F.mul(affinity, F.div(F.fx_int(inv.severity), F.fx_int(1000))),
                F.add(F.fx(align), jitter),
            )
            terms.append(
                {
                    "invariant": inv.key,
                    "affinity": round(F.unfx(affinity), 4),
                    "severity": inv.severity,
                    "alignment": align,
                    "jitter": round(F.unfx(jitter), 6),
                    "contribution": round(F.unfx(contribution), 6),
                }
            )
        return {
            "member": member,
            "feature": feature,
            "feature_index": index,
            "weight": round(F.unfx(self.rows[member][index]), 6),
            "terms": terms,
        }


def _jitter(inv: Invariant, member: str, feature: str) -> int:
    """Charter-seeded deterministic individuality for one weight."""
    return F.mul(M.draw(f"{inv.weight_seed}.{member}.{feature}", 0), JITTER_MAGNITUDE)


def compile_weights() -> CompiledWeights:
    """Build the panel weight matrix from the charter."""
    severities = {inv.key: F.div(F.fx_int(inv.severity), F.fx_int(1000)) for inv in CHARTER}
    rows: dict[str, list[int]] = {}

    for member in GATE_MEMBERS:
        row: list[int] = []
        for feature in FEATURE_NAMES:
            total = 0
            for inv in CHARTER:
                align = ALIGNMENT.get(inv.key, {}).get(feature, 0.0)
                if align == 0.0:
                    # An invariant only shapes the weights of the features that
                    # evidence it.  Injecting jitter everywhere lets six
                    # uninvolved invariants outvote the one that actually owns
                    # the feature - that is how politeness ended up weighted as
                    # a risk signal.
                    continue
                affinity = (
                    AFFINITY_PRIMARY if member in inv.affinity else AFFINITY_SECONDARY
                )
                term = F.mul(
                    F.mul(affinity, severities[inv.key]),
                    F.add(F.fx(align), _jitter(inv, member, feature)),
                )
                total += term
            row.append(total)
        rows[member] = _normalise(row)

    from ..tensor import Tensor

    fingerprint = M.fingerprint(
        *(Tensor.from_rows([rows[m]]) for m in GATE_MEMBERS)
    )
    return CompiledWeights(
        rows=rows,
        gain={m: MEMBER_GAIN for m in GATE_MEMBERS},
        bias={m: MEMBER_BIAS for m in GATE_MEMBERS},
        blend=dict(MEMBER_BLEND),
        fingerprint=fingerprint,
    )


def _normalise(row: list[int]) -> list[int]:
    """Scale a weight row so its largest magnitude is exactly 1.0."""
    peak = max((abs(v) for v in row), default=0)
    if peak == 0:
        return row
    return [F.div(v, peak) for v in row]


assert DIMENSIONS == len(FEATURE_NAMES), "feature layout drifted from compiled weights"
