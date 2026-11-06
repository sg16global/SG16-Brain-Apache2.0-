# Soverian-SG16-BRAIN

**Sovereign SG16 Brain** — an independent, self-contained brain hosted on its own
domain, **mistralbrain.com**. It has no external owner, no remote model API and
no daemon. The whole engine is pure in-process mathematics, and the same build
runs identically fully online or strictly air-gapped offline.

> 100% fully independent · self-contained · open to everyone · Apache-2.0

```
        ┌────────────────────────  SEALED HOUSING  ────────────────────────┐
        │  north / east / south / west                                     │
        │                                                                  │
        │            ┌────────────  JOINT ROOM (3-GPT)  ────────────┐      │
   in ──▶  MASTER     │  Shell GPT · Kali GPT · Terminal GPT         │     │
        │  DOOR  ───▶ │  first gate drop: reject harm, never enter   │     │
        │   (1)       └───────────────┬──────────────────────────────┘     │
        │                             ▼ clean only                         │
        │                    ┌────────────────────┐   audio  ┌──────────┐  │
        │                    │  Devstral Small 2  │ ───────▶ │  Voxtral │  │
        │                    │   head controller  │ ◀─────── │  (mini)  │  │
        │                    └────────┬───────────┘  returns └──────────  │
        │                             ▼                                    │
   out ◀─  MASTER DOOR (same door, no re-block, entry seal attached)       │
        └──────────────────────────────────────────────────────────────────┘
```

## The charter (baked into the weights, not bolted on)

1. **Absolute independence & open access.** No external ownership; open for everyone.
2. **Extreme patience & politeness.** Never excited, never loses patience.
3. **Idea ingesting.** Initiates with *"Share your idea first."*, listens, then solves.
   If the solution is not liked it immediately says
   *"Alright, I am providing the exact solution you are talking about."*
4. **Aggressive-user escalation.** Two to three polite warnings; beyond the limit of
   decency it issues the **device-authority notice** — a *simulated* deterrent screen;
   it performs no device action and contacts no external authority (it cannot).
5. **Strict anti-harm guardrails.** Harmful, socially disruptive and adult content is
   rejected at the **first gate drop** and never reaches the core.
6. **Zero hallucination.** Unknown topics get
   *"Please give me a moment. I do not know this thing right now, I will find out and tell you."*
   Arithmetic is **computed**, never recalled.
7. **Model neutrality.** Never ranks other models; *"We are all good, we are all bad."*

The seven invariants are compiled into the 3-GPT panel as auditable fixed-point
weights (`sg16/gate/weights.py`); `GET /api/weight?member=&feature=` prints the
charter-level provenance of any single weight.

## The mathematics (why online == offline, byte for byte)

Everything is **Q16.16 fixed-point integer arithmetic** (`sg16/fixed.py`): no floats
on the reasoning path, so results are identical on every host and in every deployment
state. `exp/ln/tanh/sigmoid/sin/cos` are integer Taylor series (no libm), `sqrt` is an
exact integer root. The structural matrix is synthesised from named seeds by SHA-256,
so it is a fixed invariant, not a file that can drift. `GET /api/parity` proves the
reasoning plans are byte-for-byte identical across transports.

## Layout

```
sg16/            the brain (stdlib only, no network in the core)
  fixed.py       Q16.16 kernel          tensor.py     integer tensor algebra
  tokenizer.py   byte-level tokenizer   matrix.py     seeded structural matrix
  retrieval.py   hashing vectorizer     calc.py       safe arithmetic
  knowledge.py   sovereign KB           solution.py   idea -> solution composer
  character.py   state machine          charter.py    the seven invariants
  brain.py       orchestrator           transport.py  online/offline parity
  engine/        Devstral core + Voxtral audio route
  gate/          sealed housing, master door, 3-GPT panel, compiled weights
  policy/        harm lexicon + deterministic features
  server/        the ONLY network surface (stdlib HTTP host)
web/             the UI layer (Vite source tree, served raw by the host)
knowledge/       verifiable facts only (recall / compute / defer)
config/          brain.json (single config, no env magic)
tests/           327 tests, stdlib unittest
```

## Run it

```bash
python3 -m unittest discover -s tests -t .      # full suite (327 tests)
python3 -m sg16.server 0.0.0.0 8080             # or: python3 scripts/serve.py
# open http://localhost:8080
```

No third-party Python packages. No `pip install`. The UI needs no build step — the
host serves `web/` as native ES modules — though `web/` is also a valid Vite project
(`cd web && npm i && npm run dev`, API proxied to the host).

## HTTP API

| Method & path | Purpose |
|---|---|
| `POST /api/ingest` | `{text, session_id, audio_b64?, declared_transcript?}` → full transaction |
| `POST /api/audio` | raw audio bytes; headers `X-Session-Id`, `X-Transcript` |
| `POST /api/introspect` | `{text}` → gate verdict + features + retrieval + plan |
| `GET /api/health` | readiness, digests, sealed topology |
| `GET /api/charter` | invariants + canonical lines |
| `GET /api/parity` | online/offline parity proof |
| `GET /api/weight?member=&feature=` | charter provenance of one weight |
| `POST /api/session/forget` | clear host-side conversation context (no session data returned) |
| `POST /api/subscribe` | proxy-verified humanitarian record only; paid local issuance disabled |
| `POST /api/dodo/checkout` | Dodo Payments MoR checkout session for one pass |
| `POST /api/dodo/webhook` | signed Dodo payment confirmation (Standard Webhooks) |
| `POST /api/dodo/confirm` | client pickup of the confirmed, duration-locked record |

## Standalone application layer (web/)

* **Cinematic homepage** — the green/gold emblem sits at the top centre over the
  crimson stage matrix; neon dashboard grid throughout.
* **Buy API / API Portal** — prominent controls; the portal lists the endpoints and
  issues an account-scoped API token stored hashed in the configured database.
* **Premium passes** — 24h **$3** · 1-week **$5** · 15-day **$8** · 1-month **$15**,
  sold through **Dodo Payments Merchant-of-Record** only when the operator
  configures gateway credentials (`/api/dodo/checkout` → Dodo-hosted payment →
  signed webhook confirmation correlated to a host-created checkout →
  `/api/dodo/confirm`). Without gateway credentials paid checkout fails closed.
  The client may cache a bearer pass record locally, but access is only granted
  after the host verifies the token. Process-local pass/checkout state is lost
  on restart; deployment logs and backups are operator concerns.
* **Humanitarian exception** — a zero-rate record is issued only when an
  operator-trusted proxy authenticates geo headers (`X-SG16-Proxy-Auth` plus
  `CF-IPCountry` / `X-Vercel-IP-Country` / `X-SG16-Geo-Country` = `PS`/`PSE`).
  Browser locale, JSON region claims and unauthenticated `X-SG16-Region` cannot
  mint a free pass.
* **Byte-stream delivery** — every asset and module is served by the sovereign host
  itself (`X-SG16-Stream: binary`), no CDN, no external origin.
* **Footer** carries the corporate footprint: *SAIF TECH GLOBAL LLC — Technology
  Services | Software Development | AI Tools | Digital Products — 8206 LOUISIANA
  BLVD NE, STE A #10595, ALBUQUERQUE, NM 87113, USA.*

## Deployment (mistralbrain.com)

See `docs/deployment.md` for the reverse-proxy + TLS recipe and the air-gapped
variant. Because the core has no network dependency, both deployments run the
identical mathematics.

## Honesty notes

* The **device-authority notice is simulated** and says so in its payload and
  fine print; the brain has no capability to lock hardware.
* **Payments are live through Dodo Payments (MoR)** only when the operator
  fills `billing.dodo` in `config/brain.json` (API key, webhook secret and one
  product id per pass). With empty credentials paid checkout reports unavailable
  on `/api/billing`. Webhook confirmations are verified with the Standard
  Webhooks HMAC scheme, required to match a host-created checkout, amount and
  USD currency, and humanitarian passes are structurally incapable of being
  charged. Pass and pending-checkout state is currently in-memory.
* **Speech-to-text is deferred, not faked.** Voxtral measures real acoustics
  (RMS, peak, ZCR, 8-bin Goertzel spectrum) and reports them; the transcript is
  deferred unless the caller declares one, which is labelled `declared-by-caller`.
* **Retrieval is recall, not generation.** The knowledge base holds only verifiable
  facts; anything else defers. This is how zero-hallucination is enforced
  structurally.
