"""Block 2 rule 4 and Block 3: the core engine and the audio route."""

from __future__ import annotations

import io
import json
import math
import struct
import unittest
import wave

from sg16 import fixed as F
from sg16.engine.core import DevstralCore, EngineConfig, MAX_INPUT_CHARS
from sg16.engine.voxtral import (
    SG16_ENVELOPE_MAGIC,
    EnvelopeError,
    VoxtralRoute,
)

SAMPLE_RATE = 16000


def make_wav(samples: list[int], rate: int = SAMPLE_RATE) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(struct.pack(f"<{len(samples)}h", *samples))
    return buffer.getvalue()


def sine(amplitude: int, hz: float, seconds: float, rate: int = SAMPLE_RATE) -> list[int]:
    n = int(rate * seconds)
    return [int(amplitude * math.sin(2 * math.pi * hz * i / rate)) for i in range(n)]


def white_noise(amplitude: int, seconds: float, rate: int = SAMPLE_RATE) -> list[int]:
    n = int(rate * seconds)
    return [int(amplitude * math.sin(i * 12.9898) * 43758.5453 % (2 * amplitude) - amplitude) for i in range(n)]


class EngineConfigTests(unittest.TestCase):
    def test_fingerprint_reflects_geometry(self) -> None:
        a = EngineConfig(dim=32)
        b = EngineConfig(dim=48)
        self.assertNotEqual(a.fingerprint, b.fingerprint)

    def test_fingerprint_is_stable(self) -> None:
        self.assertEqual(EngineConfig().fingerprint, EngineConfig().fingerprint)


class CoreForwardPassTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.core = DevstralCore()

    def test_matrix_synthesis_is_deterministic(self) -> None:
        self.assertEqual(self.core.matrix_sha256, DevstralCore().matrix_sha256)

    def test_plan_is_deterministic_for_identical_text(self) -> None:
        a = self.core.plan("Share your idea first.")
        b = self.core.plan("Share your idea first.")
        self.assertEqual(a.plan_sha256, b.plan_sha256)
        self.assertEqual(a.intent, b.intent)
        self.assertEqual(a.trace, b.trace)

    def test_different_text_gives_different_plan(self) -> None:
        self.assertNotEqual(
            self.core.plan("hello").plan_sha256, self.core.plan("hello!").plan_sha256
        )

    def test_intent_vector_has_the_configured_width(self) -> None:
        plan = self.core.plan("anything at all")
        self.assertEqual(len(plan.intent), self.core.config.dim)

    def test_every_pipeline_stage_is_traced(self) -> None:
        plan = self.core.plan("trace me")
        for stage in ("embed", "positional", "layernorm_1", "attention", "ffn", "intent"):
            self.assertIn(stage, plan.trace)
        self.assertEqual(len(set(plan.trace.values())), len(plan.trace))

    def test_steps_describe_the_real_forward_pass(self) -> None:
        plan = self.core.plan("steps")
        joined = " ".join(plan.steps)
        for stage in ("tokenize", "positional", "layernorm", "attention", "ffn", "readout"):
            self.assertIn(stage, joined)

    def test_long_input_is_truncated_deterministically(self) -> None:
        long_text = "x" * (MAX_INPUT_CHARS * 2)
        plan = self.core.plan(long_text)
        self.assertLessEqual(plan.chunk_count, self.core.config.max_chunks)
        self.assertLessEqual(plan.char_count, MAX_INPUT_CHARS)
        self.assertEqual(plan.plan_sha256, self.core.plan(long_text).plan_sha256)

    def test_unicode_input_is_handled(self) -> None:
        plan = self.core.plan("سلام عليكم، أريد بناء مشروع")
        self.assertGreater(plan.token_count, 2)
        self.assertEqual(len(plan.intent), self.core.config.dim)

    def test_transport_label_does_not_change_the_mathematics(self) -> None:
        online = self.core.plan("parity", transport="online")
        offline = self.core.plan("parity", transport="offline")
        self.assertEqual(online.plan_sha256, offline.plan_sha256)
        self.assertEqual(online.intent, offline.intent)
        self.assertNotEqual(online.transport, offline.transport)

    def test_empty_input_still_produces_a_valid_plan(self) -> None:
        plan = self.core.plan("")
        self.assertGreaterEqual(plan.chunk_count, 1)
        self.assertEqual(len(plan.intent), self.core.config.dim)

    def test_to_dict_is_json_serialisable(self) -> None:
        payload = self.core.plan("serialise me").to_dict()
        json.dumps(payload)

    def test_similarity_of_identical_vectors_is_one(self) -> None:
        plan = self.core.plan("same vector")
        self.assertEqual(self.core.similarity(plan, plan.intent_vector), F.FX_ONE)


class VoxtralDspTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.route = VoxtralRoute()

    def test_tone_is_classified_as_tone(self) -> None:
        profile = self.route.analyse(make_wav(sine(12000, 440, 0.5)))
        self.assertEqual(profile.classification, "tone")
        self.assertEqual(profile.container, "wave")

    def test_rms_matches_the_analytic_value(self) -> None:
        profile = self.route.analyse(make_wav(sine(12000, 440, 0.5)))
        expected = (12000 / 32768) / math.sqrt(2)
        self.assertAlmostEqual(F.unfx(profile.rms), expected, delta=5e-3)

    def test_peak_matches_amplitude(self) -> None:
        profile = self.route.analyse(make_wav(sine(12000, 440, 0.5)))
        self.assertAlmostEqual(F.unfx(profile.peak), 12000 / 32768, delta=2e-3)

    def test_silence_is_classified_as_silence(self) -> None:
        profile = self.route.analyse(make_wav([0] * (SAMPLE_RATE // 2)))
        self.assertEqual(profile.classification, "silence")
        self.assertEqual(profile.rms, 0)

    def test_noise_is_classified_as_broadband(self) -> None:
        profile = self.route.analyse(make_wav(white_noise(9000, 0.5)))
        self.assertEqual(profile.classification, "broadband-noise")
        self.assertGreater(F.unfx(profile.spectral_flatness), 0.5)

    def test_duration_is_measured(self) -> None:
        profile = self.route.analyse(make_wav(sine(8000, 300, 0.5)))
        self.assertEqual(profile.duration_ms, 500)

    def test_zero_crossing_rate_separates_pitch(self) -> None:
        low = self.route.analyse(make_wav(sine(8000, 200, 0.5)))
        high = self.route.analyse(make_wav(sine(8000, 2000, 0.5)))
        self.assertLess(low.zero_crossing_rate, high.zero_crossing_rate)

    def test_spectrum_has_one_bin_per_declared_frequency(self) -> None:
        profile = self.route.analyse(make_wav(sine(8000, 440, 0.5)))
        self.assertEqual(len(profile.spectrum), 8)

    def test_transcript_is_deferred_without_a_declaration(self) -> None:
        profile = self.route.analyse(make_wav(sine(8000, 440, 0.5)))
        self.assertIsNone(profile.declared_transcript)
        self.assertEqual(profile.transcript_source, "deferred-no-asr-weights")
        self.assertIn("don't have enough reliable information", self.route.summary_for_core(profile))

    def test_to_dict_is_json_serialisable(self) -> None:
        json.dumps(self.route.analyse(make_wav(sine(8000, 440, 0.5))).to_dict())


class VoxtralEnvelopeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.route = VoxtralRoute()

    @staticmethod
    def _envelope(header: dict, audio: bytes) -> bytes:
        raw = json.dumps(header).encode("utf-8")
        return SG16_ENVELOPE_MAGIC + struct.pack(">I", len(raw)) + raw + audio

    def test_declared_transcript_is_accepted_and_labelled(self) -> None:
        payload = self._envelope(
            {"transcript": "turn on the lights"}, make_wav(sine(8000, 440, 0.5))
        )
        profile = self.route.analyse(payload)
        self.assertEqual(profile.declared_transcript, "turn on the lights")
        self.assertEqual(profile.transcript_source, "declared-by-caller")

    def test_declared_transcript_appears_in_the_core_summary(self) -> None:
        payload = self._envelope({"transcript": "open the door"}, make_wav(sine(8000, 440, 0.5)))
        self.assertIn("open the door", self.route.summary_for_core(self.route.analyse(payload)))

    def test_truncated_header_length_raises(self) -> None:
        with self.assertRaises(EnvelopeError):
            self.route.split_envelope(SG16_ENVELOPE_MAGIC + b"\x00\x00")

    def test_truncated_header_body_raises(self) -> None:
        with self.assertRaises(EnvelopeError):
            self.route.split_envelope(SG16_ENVELOPE_MAGIC + struct.pack(">I", 999) + b"{}")

    def test_invalid_json_header_raises(self) -> None:
        raw = b"{not json"
        with self.assertRaises(EnvelopeError):
            self.route.split_envelope(SG16_ENVELOPE_MAGIC + struct.pack(">I", len(raw)) + raw)

    def test_non_object_header_raises(self) -> None:
        raw = b"[1,2,3]"
        with self.assertRaises(EnvelopeError):
            self.route.split_envelope(SG16_ENVELOPE_MAGIC + struct.pack(">I", len(raw)) + raw)

    def test_envelope_without_audio_raises(self) -> None:
        with self.assertRaises(EnvelopeError):
            self.route.analyse(self._envelope({"transcript": "x"}, b""))

    def test_empty_payload_raises(self) -> None:
        with self.assertRaises(EnvelopeError):
            self.route.analyse(b"")

    def test_8bit_audio_is_rejected(self) -> None:
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(1)
            handle.setframerate(8000)
            handle.writeframes(bytes(2000))
        with self.assertRaises(EnvelopeError):
            self.route.analyse(buffer.getvalue())

    def test_stereo_is_downmixed(self) -> None:
        buffer = io.BytesIO()
        # 8000 interleaved samples == 4000 stereo frames == 250 ms at 16 kHz
        frames = [int(6000 * math.sin(2 * math.pi * 440 * i / SAMPLE_RATE)) for i in range(4000)]
        interleaved = [v for v in frames for _ in range(2)]
        with wave.open(buffer, "wb") as handle:
            handle.setnchannels(2)
            handle.setsampwidth(2)
            handle.setframerate(SAMPLE_RATE)
            handle.writeframes(struct.pack(f"<{len(interleaved)}h", *interleaved))
        profile = self.route.analyse(buffer.getvalue())
        self.assertEqual(profile.channels, 2)
        self.assertEqual(profile.duration_ms, 250)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
