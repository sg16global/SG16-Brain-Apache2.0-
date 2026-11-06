# Architecture

## The sealed perimeter

`sg16/gate/perimeter.py` declares four sides and **one** master door. The core
working area is held behind a name-mangled attribute and `SealedHousing.__getattr__`
raises `PerimeterBypass` for anything else, so there is no second entrance.
`tests/test_gate.py` asserts `hasattr(housing, "core") is False`.

Every payload enters via `MasterDoor.enter` → the 3-GPT panel inspects it
(**first gate drop**) → if rejected it is thrown back and the core *never runs*
(the transaction's `plan` is `None`). If accepted it reaches the character engine
and Devstral/Mistral core, and the response leaves via `MasterDoor.exit` **without
re-inspection**, carrying the entry seal (Block 2, rule 5).

## The 3-GPT joint room

`sg16/gate/panel.py` runs Shell + Kali + Terminal. Each member scores the payload
as `risk = sigmoid(gain · (W · features) + bias)` in Q16.16, and the joint room
blends them with weights that sum to exactly 1. A single saturated harm category
vetoes on its own. The weight matrix is compiled from the charter
(`sg16/gate/weights.py`): each invariant contributes to the features that evidence
it, scaled by its severity and its per-member affinity, plus SHA-256-seeded jitter.
`GET /api/weight` prints the full provenance of any weight.

## The core - Universal Mode (Devstral Small 2) - 74k params Q16.16

`sg16/engine/core.py` runs the forward pass entirely in integers:
byte-tokenization → block embedding → integer-period positional basis → LayerNorm →
scaled dot-product self-attention → tanh feed-forward → mean-pool intent vector.
Every intermediate is hashed into the plan trace; the plan digest excludes the
transport label, so online and offline plans are byte-for-byte identical.
Runs on any device from tea-vendor low-end phone to industrialist server.

This deterministic encoder plans and retrieves; it does not generate language.
Language generation belongs to the one SG16 Brain (Q4_K_M weights,
`brain-core/model/Modelfile`) served by the model host behind the brain-core
Worker. The former experimental Mistral 7B loader (`sg16/engine/mistral.py`,
`scripts/download_mistral.py`) was removed on 2026-11-06.

## The audio route (Voxtral)

`sg16/engine/voxtral.py` parses SG16-envelope / WAVE / raw PCM and computes real
DSP in fixed point: peak, RMS, zero-crossing rate, an 8-bin Goertzel spectrum and a
spectral-flatness classification (silence / tone / speech-like / broadband-noise).
Transcription is deferred unless the caller declares one (labelled, never faked).
Control returns to the structural core afterwards.

## Character & zero-hallucination

`sg16/character.py` is the state machine for the listen-then-solve rule, the
escalation ladder, model neutrality and the canonical deferral. Answers come from
three sources only: **recall** (sovereign KB), **compute** (safe arithmetic) or
**defer**. There is no fourth path, so fabrication is structurally impossible.
Permanently inscribed with Master Charter Sections 1-23.

## The host (the only network surface)

`sg16/server/app.py` is a stdlib `ThreadingHTTPServer`. It serves the UI from
`web/`, the JSON API, and nothing else. `tests/test_isolation.py` parses every core
module and fails on any network/subprocess/third-party import, with no exceptions.
So the core cannot quietly grow a dependency.

## SG16 Developer Logo

SG16 Developer AI Developer Engine by Saif Tech Global LLC
- AI DEVELOPER • OFFLINE & ONLINE MODE
- Apache 2.0
- developer.saiftechglobal.com
- USA UK FRANCE RUSSIA CHINA GERMANY

Represents universal deployment: offline once weights downloaded, online when needed.
License: Apache 2.0.
