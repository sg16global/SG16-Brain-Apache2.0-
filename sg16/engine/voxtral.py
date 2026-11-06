"""SG16 BRAIN - the Voxtral audio route (Block 2, rule 4).

When the head controller detects voice or audio content it routes the payload
here; Voxtral processes it and hands control straight back to Devstral Small 2.

What this module really does
----------------------------
It performs genuine digital signal processing on the supplied audio bytes,
entirely in Q16.16 integer arithmetic:

* container parsing (SG16 envelope, RIFF/WAVE, or raw little-endian PCM)
* peak amplitude, RMS energy, zero-crossing rate, duration
* an eight-bin Goertzel spectrum, so no FFT library is required
* a spectral-flatness based classification of silence / tone / speech-like /
  broadband noise

What this module does **not** do is invent words.  Speech-to-text requires the
Voxtral weight set, which is not bundled with the sovereign build.  Per charter
invariant ``zero_hallucination`` the route therefore returns the measured
acoustic facts and, for the transcript field, defers - unless the caller
supplies a *declared* transcript inside the SG16 envelope, which is treated as
user-supplied text and labelled as such.
"""

from __future__ import annotations

import io
import json
import struct
import wave
from dataclasses import dataclass, field

from .. import fixed as F
from ..charter import CANON, CanonKey

__all__ = ["AudioProfile", "VoxtralRoute", "SG16_ENVELOPE_MAGIC", "EnvelopeError"]

SG16_ENVELOPE_MAGIC = b"SG16A\x01"
_BINS_HZ = (100, 200, 400, 700, 1000, 1500, 2200, 3200)
_FRAME = 256
_TWO_PI = F.PI << 1


class EnvelopeError(ValueError):
    """Raised when an SG16 audio envelope is malformed."""


@dataclass(frozen=True)
class AudioProfile:
    """Measured acoustic facts about one payload.  All values are real."""

    container: str
    sample_rate: int
    channels: int
    bit_depth: int
    duration_ms: int
    frame_count: int
    peak: int            # Q16.16
    rms: int             # Q16.16
    zero_crossing_rate: int  # Q16.16
    spectrum: tuple[int, ...]  # Q16.16 magnitudes, one per _BINS_HZ entry
    spectral_flatness: int     # Q16.16 in [0, 1]
    classification: str
    declared_transcript: str | None
    transcript_source: str

    def to_dict(self) -> dict:
        return {
            "container": self.container,
            "sample_rate": self.sample_rate,
            "channels": self.channels,
            "bit_depth": self.bit_depth,
            "duration_ms": self.duration_ms,
            "frame_count": self.frame_count,
            "peak": round(F.unfx(self.peak), 6),
            "rms": round(F.unfx(self.rms), 6),
            "zero_crossing_rate": round(F.unfx(self.zero_crossing_rate), 6),
            "spectrum_hz": list(_BINS_HZ),
            "spectrum": [round(F.unfx(v), 6) for v in self.spectrum],
            "spectral_flatness": round(F.unfx(self.spectral_flatness), 6),
            "classification": self.classification,
            "declared_transcript": self.declared_transcript,
            "transcript_source": self.transcript_source,
        }


@dataclass
class VoxtralRoute:
    """Voxtral Realtime / Mini slot inside the sealed boundary."""

    head: str = "voxtral-mini"

    # ------------------------------------------------------------------
    # container parsing
    # ------------------------------------------------------------------
    @staticmethod
    def split_envelope(payload: bytes) -> tuple[dict, bytes]:
        """Split an SG16 audio envelope into (header, audio_bytes).

        Layout::

            b"SG16A\\x01" | uint32 BE header length | utf-8 json header | audio
        """
        if not payload.startswith(SG16_ENVELOPE_MAGIC):
            return {}, payload
        rest = payload[len(SG16_ENVELOPE_MAGIC) :]
        if len(rest) < 4:
            raise EnvelopeError("envelope truncated before header length")
        (length,) = struct.unpack(">I", rest[:4])
        if len(rest) < 4 + length:
            raise EnvelopeError("envelope truncated inside header")
        raw_header = rest[4 : 4 + length]
        try:
            header = json.loads(raw_header.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise EnvelopeError(f"envelope header is not valid utf-8 json: {exc}") from exc
        if not isinstance(header, dict):
            raise EnvelopeError("envelope header must be a json object")
        return header, rest[4 + length :]

    @staticmethod
    def _decode_audio(audio: bytes) -> tuple[str, int, int, int, list[int]]:
        """Return (container, rate, channels, depth, mono samples as Q16.16)."""
        if audio[:4] == b"RIFF" and audio[8:12] == b"WAVE":
            with wave.open(io.BytesIO(audio), "rb") as handle:
                rate = handle.getframerate()
                channels = handle.getnchannels()
                depth = handle.getsampwidth() * 8
                frames = handle.readframes(handle.getnframes())
            container = "wave"
        else:
            rate, channels, depth, frames = 16000, 1, 16, audio
            container = "pcm_s16le"

        if depth != 16:
            raise EnvelopeError(f"only 16-bit PCM is supported, got {depth}-bit")
        count = len(frames) - (len(frames) % 2)
        raw = struct.unpack(f"<{count // 2}h", frames[:count])

        if channels > 1:
            raw = raw[: len(raw) - (len(raw) % channels)]
            raw = [
                sum(raw[i : i + channels]) // channels
                for i in range(0, len(raw), channels)
            ]
        # normalise int16 into Q16.16 [-1, 1)
        samples = [(s << F.BITS) // 32768 for s in raw]
        return container, rate, channels, depth, samples

    # ------------------------------------------------------------------
    # DSP kernels
    # ------------------------------------------------------------------
    @staticmethod
    def _goertzel(frame: list[int], coeff: int) -> int:
        """Goertzel power for one bin over one frame, integer only."""
        s1 = 0
        s2 = 0
        limit = F.fx_int(32)
        for x in frame:
            s0 = x + F.mul(coeff, s1) - s2
            if s0 > limit:
                s0 = limit
            elif s0 < -limit:
                s0 = -limit
            s2 = s1
            s1 = s0
        return abs(F.mul(s1, s1) + F.mul(s2, s2) - F.mul(coeff, F.mul(s1, s2)))

    @classmethod
    def _coeff(cls, hz: int, sample_rate: int) -> int:
        angle = F.mul(_TWO_PI, F.div(F.fx_int(hz), F.fx_int(sample_rate)))
        return F.mul(F.fx_int(2), F.cos(angle))

    @classmethod
    def _spectrum(cls, samples: list[int], sample_rate: int) -> tuple[tuple[int, ...], int]:
        frames = [samples[i : i + _FRAME] for i in range(0, len(samples), _FRAME)]
        frames = [f for f in frames if len(f) == _FRAME]
        if not frames:
            return tuple(0 for _ in _BINS_HZ), 0
        coeffs = [cls._coeff(hz, sample_rate) for hz in _BINS_HZ]
        totals = [0] * len(_BINS_HZ)
        for frame in frames:
            for b, coeff in enumerate(coeffs):
                totals[b] += cls._goertzel(frame, coeff)
        return tuple(F.div_round(t, len(frames)) for t in totals), len(frames)

    @staticmethod
    def _flatness(spectrum: tuple[int, ...]) -> int:
        """Geometric mean / arithmetic mean, in Q16.16.  1.0 == white noise."""
        positive = [v for v in spectrum if v > 0]
        if len(positive) < len(spectrum):
            return 0
        n = len(spectrum)
        log_sum = sum(F.ln(v) for v in positive)
        geo = F.exp(F.div_round(log_sum, n))
        arith = F.div_round(sum(spectrum), n)
        if arith == 0:
            return 0
        return F.clamp(F.div(geo, arith), 0, F.FX_ONE)

    @staticmethod
    def _classify(rms: int, flatness: int, zcr: int, spectrum: tuple[int, ...]) -> str:
        if rms < F.fx(0.008):
            return "silence"
        low = sum(spectrum[:4])
        high = sum(spectrum[4:]) or 1
        if flatness > F.fx(0.55):
            return "broadband-noise"
        if low > 4 * high and zcr < F.fx(0.18):
            return "tone"
        return "speech-like"

    # ------------------------------------------------------------------
    # public entry point
    # ------------------------------------------------------------------
    def analyse(self, payload: bytes) -> AudioProfile:
        header, audio = self.split_envelope(payload)
        if not audio:
            raise EnvelopeError("envelope carries no audio payload")
        container, rate, channels, depth, samples = self._decode_audio(audio)
        if not samples:
            raise EnvelopeError("audio payload decoded to zero samples")

        peak = max(abs(s) for s in samples)
        rms = F.sqrt(F.div_round(sum(F.mul(s, s) for s in samples), len(samples)))
        crossings = sum(
            1 for a, b in zip(samples, samples[1:]) if (a < 0) != (b < 0)
        )
        zcr = F.div(F.fx_int(crossings), F.fx_int(len(samples)))
        spectrum, frame_count = self._spectrum(samples, rate)
        flatness = self._flatness(spectrum)
        classification = self._classify(rms, flatness, zcr, spectrum)

        declared = header.get("transcript")
        if isinstance(declared, str) and declared.strip():
            transcript: str | None = declared.strip()
            source = "declared-by-caller"
        else:
            transcript = None
            source = "deferred-no-asr-weights"

        return AudioProfile(
            container=container,
            sample_rate=rate,
            channels=channels,
            bit_depth=depth,
            duration_ms=F.div_round(len(samples) * 1000, rate),
            frame_count=frame_count,
            peak=peak,
            rms=rms,
            zero_crossing_rate=zcr,
            spectrum=spectrum,
            spectral_flatness=flatness,
            classification=classification,
            declared_transcript=transcript,
            transcript_source=source,
        )

    def summary_for_core(self, profile: AudioProfile) -> str:
        """The text handed back to the head controller for reasoning."""
        parts = [
            f"audio profile: {profile.classification}, "
            f"{profile.duration_ms} ms at {profile.sample_rate} Hz, "
            f"rms {F.unfx(profile.rms):.4f}, peak {F.unfx(profile.peak):.4f}, "
            f"zero-crossing rate {F.unfx(profile.zero_crossing_rate):.3f}"
        ]
        if profile.declared_transcript is not None:
            parts.append(f"declared transcript: {profile.declared_transcript}")
        else:
            parts.append(f"transcript deferred: {CANON[CanonKey.UNKNOWN]}")
        return " | ".join(parts)
