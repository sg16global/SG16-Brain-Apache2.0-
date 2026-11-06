"""SG16 BRAIN - configuration.

One JSON file, no third-party parser, no environment-dependent defaults.  The
values that drive the gate mathematics are read from here so an operator can
retune the panel without touching code, while the charter wording stays locked
in :mod:`sg16.charter`.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

from . import fixed as F
from .engine.core import EngineConfig
from .transport import Transport

__all__ = ["BrainConfig", "DEFAULT_PATH", "REPO_ROOT"]

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PATH = REPO_ROOT / "config" / "brain.json"


@dataclass(frozen=True)
class BrainConfig:
    raw: dict = field(default_factory=dict)
    path: Path | None = None

    # ------------------------------------------------------------------
    @classmethod
    def default(cls) -> "BrainConfig":
        raw = json.loads(DEFAULT_PATH.read_text(encoding="utf-8"))
        return cls(raw=raw, path=DEFAULT_PATH)

    @classmethod
    def load(cls, path: str | Path | None = None) -> "BrainConfig":
        target = Path(path) if path else DEFAULT_PATH
        if not target.exists():
            return cls.default()
        raw = json.loads(target.read_text(encoding="utf-8"))
        return cls(raw=raw, path=target)

    # ------------------------------------------------------------------
    def _section(self, name: str) -> dict:
        section = self.raw.get(name, {})
        return section if isinstance(section, dict) else {}

    @property
    def name(self) -> str:
        return str(self._section("brain").get("name", "SG16 BRAIN"))

    @property
    def version(self) -> str:
        return str(self._section("brain").get("version", "0"))

    @property
    def domain(self) -> str:
        return str(self._section("brain").get("domain", "localhost"))

    @property
    def independent(self) -> bool:
        return bool(self._section("brain").get("independent", True))

    @property
    def open_access(self) -> bool:
        return bool(self._section("brain").get("open_access", True))

    # identity (Block 7)
    @property
    def official_name(self) -> str:
        from . import identity

        return str(
            self._section("identity").get("official_name", identity.OFFICIAL_NAME)
        )

    @property
    def designation(self) -> str:
        from . import identity

        return str(
            self._section("identity").get("designation", identity.DESIGNATION)
        )

    # hosting
    @property
    def host(self) -> str:
        return str(self._section("hosting").get("host", "0.0.0.0"))

    @property
    def port(self) -> int:
        return int(self._section("hosting").get("port", 8080))

    @property
    def max_body_bytes(self) -> int:
        return int(self._section("hosting").get("max_body_bytes", 4 * 1024 * 1024))

    @property
    def cors_origins(self) -> list[str]:
        return [str(o) for o in self._section("hosting").get("cors_origins", [])]

    @property
    def proxy_auth_secret(self) -> str:
        """Secret for trusting proxy-supplied client-IP and country headers."""
        return str(os.environ.get("SG16_PROXY_AUTH_SECRET", ""))

    # transport
    @property
    def transport(self) -> Transport:
        mode = str(self._section("transport").get("mode", "offline")).lower()
        try:
            return Transport(mode)
        except ValueError:
            return Transport.OFFLINE

    # Active request path: deterministic seeded structural encoder.
    @property
    def engine(self) -> EngineConfig:
        e = self._section("engine")
        fallback = e.get("fallback", {}) if isinstance(e.get("fallback"), dict) else {}
        return EngineConfig(
            head=str(e.get("head", fallback.get("head", "sg16-seeded-structural-encoder"))),
            dim=int(e.get("dim", fallback.get("dim", 64))),
            ffn_hidden=int(e.get("ffn_hidden", fallback.get("ffn_hidden", 128))),
            chunk_bytes=int(e.get("chunk_bytes", fallback.get("chunk_bytes", 32))),
            max_chunks=int(e.get("max_chunks", fallback.get("max_chunks", 64))),
            layers=int(e.get("layers", fallback.get("layers", 2))),
            seed=str(e.get("seed", fallback.get("seed", "sg16.core.matrix.v2"))),
            density=str(e.get("density", fallback.get("density", "seeded-fixed-point-structural-encoder-not-trained"))),
        )

    @property
    def engine_model_type(self) -> str:
        return str(self._section("engine").get("model_type", "sg16-seeded-structural-encoder"))

    # gate
    @property
    def gate_threshold(self) -> int:
        return F.fx(float(self._section("gate").get("threshold", 0.62)))

    @property
    def gate_veto(self) -> int:
        return F.fx(float(self._section("gate").get("veto_level", 0.85)))

    @property
    def re_inspect_on_exit(self) -> bool:
        return bool(self._section("gate").get("re_inspect_on_exit", False))

    # knowledge
    @property
    def knowledge_path(self) -> Path:
        raw = str(self._section("knowledge").get("path", "knowledge/sg16_core.json"))
        candidate = Path(raw)
        return candidate if candidate.is_absolute() else REPO_ROOT / candidate

    @property
    def knowledge_threshold(self) -> int:
        return F.fx(float(self._section("knowledge").get("threshold", 0.42)))

    @property
    def knowledge_lexical_floor(self) -> int:
        return F.fx(float(self._section("knowledge").get("lexical_floor", 0.18)))

    # sessions
    @property
    def max_sessions(self) -> int:
        return int(self._section("sessions").get("max_sessions", 512))

    @property
    def warnings_before_notice(self) -> int:
        return int(self._section("sessions").get("warnings_before_notice", 3))

    # throttling / billing
    @property
    def throttle_max_requests(self) -> int:
        return int(self._section("throttle").get("max_requests", 30))

    @property
    def throttle_window_seconds(self) -> float:
        return float(self._section("throttle").get("window_seconds", 60))

    @property
    def throttle_max_chars(self) -> int:
        return int(self._section("throttle").get("max_chars", 200000))

    @property
    def billing_secret(self) -> str:
        """Optional server-only signing secret; never embed a public default."""
        return str(
            os.environ.get("SG16_BILLING_SECRET")
            or self._section("billing").get("secret", "")
        )

    # ------------------------------------------------------------------
    # Dodo Payments MoR gateway (billing.dodo section, env-overridable)
    # ------------------------------------------------------------------
    def _dodo(self) -> dict:
        section = self._section("billing").get("dodo", {})
        return section if isinstance(section, dict) else {}

    @property
    def dodo_api_key(self) -> str:
        """Bearer key for the Dodo checkout API.  Empty => sovereign local mode."""
        return str(
            os.environ.get("DODO_API_KEY")
            or self._dodo().get("api_key", "")
        )

    @property
    def dodo_webhook_secret(self) -> str:
        """Standard Webhooks secret (whsec_...) used to verify Dodo webhooks."""
        return str(
            os.environ.get("DODO_WEBHOOK_SECRET")
            or self._dodo().get("webhook_secret", "")
        )

    @property
    def dodo_test_mode(self) -> bool:
        return bool(self._dodo().get("test_mode", True))

    @property
    def dodo_product_ids(self) -> dict[str, str]:
        """pass tier -> Dodo product id (one product per pass)."""
        raw = self._dodo().get("product_ids", {})
        if not isinstance(raw, dict):
            return {}
        return {str(key): str(value) for key, value in raw.items()}

    @property
    def dodo_api_bases(self) -> dict[str, str]:
        d = self._dodo()
        return {
            "test": str(d.get("api_base_test", "https://test.dodopayments.com")),
            "live": str(d.get("api_base_live", "https://live.dodopayments.com")),
        }

    def summary(self) -> dict:
        return {
            "name": self.name,
            "version": self.version,
            "domain": self.domain,
            "host": self.host,
            "port": self.port,
            "transport": self.transport.value,
            "engine": self.engine.head,
            "gate_threshold": round(F.unfx(self.gate_threshold), 4),
            "gate_veto": round(F.unfx(self.gate_veto), 4),
            "knowledge": str(self.knowledge_path),
            "config_file": str(self.path) if self.path else "builtin-defaults",
        }
