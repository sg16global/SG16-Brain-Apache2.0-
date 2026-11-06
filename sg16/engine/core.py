"""Deterministic fixed-point structural encoder used by SG16 planning.

``DevstralCore`` applies seeded Q16.16 matrices to byte-level input and
produces an intent vector plus a reproducible execution trace. The matrices
are deterministic initial values, not trained weights. The output is not a
language-model completion and this component cannot generate natural-language
answers on its own. Text responses are produced by separate templates,
curated knowledge, and arithmetic helpers.

The transport label is metadata and is deliberately excluded from the plan
digest. This makes the structural calculation repeatable across declared
transport modes; it does not prove response quality or equivalence of external
hosting layers.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Sequence

from .. import fixed as F
from .. import identity as IDENTITY
from .. import matrix as M
from .. import tokenizer as T
from ..tensor import Tensor, cosine, dot, layer_norm, mean_pool

__all__ = ["EngineConfig", "ReasoningPlan", "DevstralCore"]

MAX_INPUT_CHARS = 8192


@dataclass(frozen=True)
class EngineConfig:
    """Geometry and seed for a deterministic, non-trained encoder."""

    head: str = "sg16-seeded-structural-encoder"
    dim: int = 64
    ffn_hidden: int = 128
    chunk_bytes: int = 32
    max_chunks: int = 64
    layers: int = 2
    seed: str = "sg16.core.matrix.v2"
    density: str = "seeded-fixed-point-structural-encoder-not-trained"

    @property
    def fingerprint(self) -> str:
        return hashlib.sha256(
            f"{self.head}|{self.dim}|{self.ffn_hidden}|{self.chunk_bytes}|"
            f"{self.max_chunks}|{self.layers}|{self.seed}|{self.density}".encode("utf-8")
        ).hexdigest()[:16]


@dataclass(frozen=True)
class ReasoningPlan:
    """Trace of one structural-encoder pass; not a generated answer."""

    head: str
    route: str
    char_count: int
    token_count: int
    chunk_count: int
    intent: tuple[int, ...]
    trace: dict[str, str]
    steps: tuple[str, ...]
    plan_sha256: str
    config_fingerprint: str
    transport: str = "unknown"  # metadata only; excluded from plan_sha256

    @property
    def intent_vector(self) -> list[int]:
        return list(self.intent)

    def to_dict(self) -> dict:
        return {
            "head": self.head,
            "route": self.route,
            "transport": self.transport,
            "char_count": self.char_count,
            "token_count": self.token_count,
            "chunk_count": self.chunk_count,
            "intent": [F.unfx(v) for v in self.intent],
            "intent_raw": list(self.intent),
            "trace": dict(self.trace),
            "steps": list(self.steps),
            "plan_sha256": self.plan_sha256,
            "config_fingerprint": self.config_fingerprint,
        }


class DevstralCore:
    """Seeded structural encoder; not the pretrained Devstral model.

    The matrices are generated from named seeds, not learned from training
    data. Its output is a structural feature vector and trace, not fluent text.
    """

    def __init__(self, config: EngineConfig | None = None) -> None:
        self.config = config or EngineConfig()
        c = self.config
        # --- structural processing matrix, synthesised in-process ---------
        # Embedded intelligence: no external 3-4GB mount, math lives inside code.
        self._embed = M.build(f"{c.seed}.embed", T.VOCAB_SIZE, c.dim, F.FX_ONE)
        # Multi-layer dense reasoning: each layer is independent thinking
        self._layers: list[dict] = []
        all_mats: list = [self._embed]
        for li in range(c.layers):
            layer_seed = f"{c.seed}.layer{li}"
            wq = M.build(f"{layer_seed}.wq", c.dim, c.dim, F.fx(0.5))
            wk = M.build(f"{layer_seed}.wk", c.dim, c.dim, F.fx(0.5))
            wv = M.build(f"{layer_seed}.wv", c.dim, c.dim, F.fx(0.5))
            wh = M.build(f"{layer_seed}.wh", c.dim, c.ffn_hidden, F.fx(0.6))
            bh = M.vector(f"{layer_seed}.bh", c.ffn_hidden, F.fx(0.1))
            wo = M.build(f"{layer_seed}.wo", c.ffn_hidden, c.dim, F.fx(0.4))
            bo = M.vector(f"{layer_seed}.bo", c.dim, F.fx(0.1))
            self._layers.append(
                {"wq": wq, "wk": wk, "wv": wv, "wh": wh, "bh": bh, "wo": wo, "bo": bo}
            )
            all_mats.extend([wq, wk, wv, wh, wo])
        # Backward compat: expose first layer as _wq etc for any external access
        if self._layers:
            self._wq = self._layers[0]["wq"]
            self._wk = self._layers[0]["wk"]
            self._wv = self._layers[0]["wv"]
            self._wh = self._layers[0]["wh"]
            self._bh = self._layers[0]["bh"]
            self._wo = self._layers[0]["wo"]
            self._bo = self._layers[0]["bo"]
        self._pos = self._positional_basis()
        self._scale = F.sqrt(F.fx_int(c.dim))
        self.matrix_sha256 = M.fingerprint(*all_mats)
        # --- Block 7 rule 1: the identity inscription ---------------------
        # The core matrix is committed to its own name the moment it exists:
        # a SHA-256 bond between this fingerprint and "Sovereign SG16 Brain".
        # Nothing that does not run this matrix can restate the identity.
        self.identity_inscription = IDENTITY.inscribe(self.matrix_sha256)

    # ------------------------------------------------------------------
    # matrix construction helpers
    # ------------------------------------------------------------------
    def _positional_basis(self) -> list[list[int]]:
        """Integer-period sinusoidal basis.  No floats, no libm.

        Channel ``j`` uses angular step ``1 / (2 + 3j)``, so the whole basis is
        generated from integer division alone.  That keeps the positional
        signal bit-identical across hosts, which the classic ``10000**(j/d)``
        formulation cannot guarantee because it is built with ``pow``.
        """
        basis: list[list[int]] = []
        magnitude = F.fx(0.35)  # positional must stay subordinate to content
        for p in range(self.config.max_chunks):
            row: list[int] = []
            for j in range(self.config.dim):
                step = F.div(F.FX_ONE, F.fx_int(2 + 3 * j))
                angle = F.mul(F.fx_int(p), step)
                value = F.cos(angle) if j % 2 == 0 else F.sin(angle)
                row.append(F.mul(value, magnitude))
            basis.append(row)
        return basis

    # ------------------------------------------------------------------
    # forward pass
    # ------------------------------------------------------------------
    def _chunk_token_ids(self, token_ids: Sequence[int]) -> list[list[int]]:
        size = self.config.chunk_bytes
        limit = self.config.max_chunks
        blocks = [list(token_ids[i : i + size]) for i in range(0, len(token_ids), size)]
        if len(blocks) <= limit:
            return blocks
        # deterministic head+tail truncation: never depends on wall clock
        head = limit // 2
        tail = limit - head
        return blocks[:head] + blocks[-tail:]

    def _embed_chunks(self, blocks: Sequence[Sequence[int]]) -> Tensor:
        rows: list[list[int]] = []
        for block in blocks:
            if not block:
                rows.append([0] * self.config.dim)
                continue
            acc = [0] * self.config.dim
            for token in block:
                row = self._embed.row(token)
                for i in range(self.config.dim):
                    acc[i] += row[i]
            # divide by sqrt(n), not n: byte embeddings are independent and
            # zero-mean, so the block vector must keep unit scale.  Dividing by
            # n collapsed content 24x below the positional basis and made every
            # input look identical in cosine space.
            norm = F.sqrt(F.fx_int(len(block)))
            rows.append([F.div(v, norm) for v in acc])
        return Tensor.from_rows(rows)

    def _attention_with(self, x: Tensor, wq: Tensor, wk: Tensor, wv: Tensor) -> Tensor:
        q = x.matmul(wq)
        k = x.matmul(wk)
        v = x.matmul(wv)
        n = x.rows
        k_rows = [k.row(i) for i in range(n)]
        v_rows = [v.row(i) for i in range(n)]
        out: list[list[int]] = []
        for i in range(n):
            qi = q.row(i)
            scores = [F.div(dot(qi, kj), self._scale) for kj in k_rows]
            probs = F.softmax(scores)
            acc = [0] * self.config.dim
            for p, vj in zip(probs, v_rows):
                if p == 0:
                    continue
                for d in range(self.config.dim):
                    acc[d] += p * vj[d]
            out.append([F.shr_round(a) for a in acc])
        return Tensor.from_rows(out)

    def _attention(self, x: Tensor) -> Tensor:
        # backward compat: first layer
        layer = self._layers[0] if self._layers else None
        if layer is None:
            return x
        return self._attention_with(x, layer["wq"], layer["wk"], layer["wv"])

    def _feed_forward_with(self, x: Tensor, wh: Tensor, bh: list[int], wo: Tensor, bo: list[int]) -> Tensor:
        hidden = x.matmul(wh).add_vector(bh).apply(F.tanh)
        return hidden.matmul(wo).add_vector(bo)

    def _feed_forward(self, x: Tensor) -> Tensor:
        layer = self._layers[0] if self._layers else None
        if layer is None:
            return x
        return self._feed_forward_with(x, layer["wh"], layer["bh"], layer["wo"], layer["bo"])

    def plan(self, text: str, route: str = "text", transport: str = "unknown") -> ReasoningPlan:
        """Run one deterministic structural-encoding pass and return its trace.

        The plan records seeded fixed-point transforms. It is not a natural-
        language answer, an estimate of semantic understanding, or a quality
        guarantee across languages.
        """
        clipped = text[:MAX_INPUT_CHARS]
        token_ids = T.encode(clipped)
        blocks = self._chunk_token_ids(token_ids)
        if not blocks:
            blocks = [[T.PAD]]

        steps: list[str] = ["tokenize:utf8-byte"]
        x = self._embed_chunks(blocks)
        trace = {"embed": x.sha256()}

        rows = x.rows
        pos = Tensor.from_rows(self._pos[:rows])
        x = x.add(pos)
        steps.append("positional:integer-period-basis-dense")
        trace["positional"] = x.sha256()

        x = layer_norm(x)
        steps.append("layernorm:pre-attention")
        trace["layernorm_1"] = x.sha256()

        # --- Layer 1 (backward compat keys: attention, layernorm_2, ffn, layernorm_3) ---
        ctx = self._attention_with(x, self._layers[0]["wq"], self._layers[0]["wk"], self._layers[0]["wv"])
        x = layer_norm(x.add(ctx))
        steps.append("attention:scaled-dot-product-single-head-layer1")
        trace["attention"] = ctx.sha256()
        trace["layernorm_2"] = x.sha256()

        ff = self._feed_forward_with(x, self._layers[0]["wh"], self._layers[0]["bh"], self._layers[0]["wo"], self._layers[0]["bo"])
        x = layer_norm(x.add(ff))
        steps.append("ffn:tanh-2layer-residual-layer1")
        trace["ffn"] = ff.sha256()
        trace["layernorm_3"] = x.sha256()

        # --- Layer 2 (additional density, new keys, preserves old keys for tests) ---
        if len(self._layers) > 1:
            ctx2 = self._attention_with(x, self._layers[1]["wq"], self._layers[1]["wk"], self._layers[1]["wv"])
            x = layer_norm(x.add(ctx2))
            steps.append("attention:scaled-dot-product-single-head-layer2-dense")
            trace["attention_2"] = ctx2.sha256()
            trace["layernorm_4"] = x.sha256()

            ff2 = self._feed_forward_with(x, self._layers[1]["wh"], self._layers[1]["bh"], self._layers[1]["wo"], self._layers[1]["bo"])
            x = layer_norm(x.add(ff2))
            steps.append("ffn:tanh-2layer-residual-layer2-dense")
            trace["ffn_2"] = ff2.sha256()
            trace["layernorm_5"] = x.sha256()

        intent = mean_pool(x)
        steps.append("readout:mean-pool-intent-vector-pure-math")
        trace["intent"] = Tensor.from_vector(intent).sha256()

        hasher = hashlib.sha256()
        hasher.update(self.config.fingerprint.encode("ascii"))
        hasher.update(b"\x1f")
        hasher.update(self.matrix_sha256.encode("ascii"))
        hasher.update(b"\x1f")
        hasher.update(T.token_signature(token_ids).encode("ascii"))
        for name in sorted(trace):
            hasher.update(b"\x1f")
            hasher.update(name.encode("ascii"))
            hasher.update(b"=")
            hasher.update(trace[name].encode("ascii"))
        plan_sha = hasher.hexdigest()

        return ReasoningPlan(
            head=self.config.head,
            route=route,
            char_count=len(clipped),
            token_count=len(token_ids),
            chunk_count=len(blocks),
            intent=tuple(intent),
            trace=trace,
            steps=tuple(steps),
            plan_sha256=plan_sha,
            config_fingerprint=self.config.fingerprint,
            transport=transport,
        )

    # ------------------------------------------------------------------
    # retrieval helpers
    # ------------------------------------------------------------------
    def intent_vector(self, text: str) -> list[int]:
        return self.plan(text).intent_vector

    def identity_path(self) -> dict:
        """Resolve the inscribed identity tensor path (Block 7, rule 1)."""
        vector = self.intent_vector(IDENTITY.OFFICIAL_NAME)
        hasher = hashlib.sha256()
        hasher.update(b"sg16.identity.tensor")
        for value in vector:
            hasher.update(int(value).to_bytes(8, "big", signed=True))
        return {
            "official_name": IDENTITY.OFFICIAL_NAME,
            "designation": IDENTITY.DESIGNATION,
            "utterance": IDENTITY.UTTERANCE,
            "inscription": self.identity_inscription.to_dict(),
            "verified": IDENTITY.verify(
                self.matrix_sha256, self.identity_inscription.digest
            ),
            "tensor": {
                "route": "identity",
                "dim": len(vector),
                "signature": hasher.hexdigest()[:16],
            },
        }

    def similarity(self, plan_a: ReasoningPlan, vector_b: Sequence[int]) -> int:
        """Cosine similarity between an intent vector and another vector."""
        return cosine(list(plan_a.intent), list(vector_b))
