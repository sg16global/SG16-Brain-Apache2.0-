# SOVEREIGN SG16 Brain

**SG16 Brain** is the conversational AI of **SAIF TECH GLOBAL LLC**, live at
**[mistralbrain.com](https://mistralbrain.com)**. This repository is the
official, definitive home of the Brain project.

> Self-hosted · one brain · no third-party AI API · runs on any server · Apache-2.0

## Contents

1. [Official links](#official-links)
2. [All branches of the Brain](#all-branches-of-the-brain)
3. [How it works](#how-it-works)
4. [Repository layout](#repository-layout)
5. [Admin console](#admin-console)
6. [Using the API from other projects](#using-the-api-from-other-projects)
7. [Run it locally](#run-it-locally)
8. [Deploy](#deploy)
9. [Data and privacy](#data-and-privacy)
10. [Company and license](#company-and-license)

---

## Official links

| | |
|---|---|
| Website | https://mistralbrain.com |
| Source (this repository) | https://github.com/sg16global/SG16-Brain-Apache2.0- |
| Models (Ollama) | https://ollama.com/saiftechglobal/sg16-brain |
| The brain of mistralbrain.com | https://ollama.com/saiftechglobal/sg16-brain:Q4_K_M |

## All branches of the Brain

### Model builds

Published on Ollama. All builds are Apache-2.0 and have a 128K-token context window.

| Build | Size | Ollama ID | Use | Run |
|---|---|---|---|---|
| **`Q4_K_M`** | 7.5 GB | `f4b21a5d4668` | **the brain of mistralbrain.com** (integrated in this repository) | `ollama run saiftechglobal/sg16-brain:Q4_K_M` |
| `Q8_0` | 13 GB | `ac9c1b995446` | higher fidelity, more memory | `ollama run saiftechglobal/sg16-brain:Q8_0` |
| `f16` | 25 GB | `2c7021a7e77c` | full-precision weights | `ollama run saiftechglobal/sg16-brain:f16` |

All three are the same 12.2B-parameter SG16 Brain at different precisions.
Always name the build: the model has no `latest` tag, so
`ollama run saiftechglobal/sg16-brain` without a tag does not resolve.
mistralbrain.com serves **only** `Q4_K_M`.

### Repository branches

| Branch | Purpose |
|---|---|
| `main` | the released Brain, and the single source of truth for mistralbrain.com |

## How it works

```
visitor / API project ──▶ mistralbrain.com  (Cloudflare Worker: brain-core)
                              │  keys · one-at-a-time queue · project rules
                              │  verification · arithmetic · accounts · passes
                              ▼  Cloudflare Tunnel + Access (zero open ports)
                          brain server: any machine running Ollama, 127.0.0.1 only
                              saiftechglobal/sg16-brain:Q4_K_M   (the one brain)
```

- **One brain, self-hosted.** Every answer comes from the Q4_K_M build on
  the owner's own server. No third-party AI service is used. If the brain
  server is down, chat fails honestly with `502`; there is no backup AI.
- **Any server.** The brain server is not fixed. The owner connects it on
  `/admin` → **BRAIN SERVER**: test, save, done, with no redeploy.
- **The core decides, the model talks.** The Worker handles keys, rate
  limits, the queue, verification and arithmetic. Only language generation
  goes to the model.
- **Nothing is stored on the brain server.** It only runs the model.

## Repository layout

| Part | Path | What it is |
|---|---|---|
| Brain core | [`brain-core/`](brain-core/) | Cloudflare Worker: keys, queue, verification, payments, accounts, admin gateway and the site's API ([details](brain-core/README.md)) |
| Public site | [`brain-core/site/`](brain-core/site/) | the mistralbrain.com pages (static export, committed, self-hosted fonts) plus the `sg16-*.js` add-ons (robot guide, admin panels, account) |
| Brain server setup | [`brain-core/scripts/vps-setup-model.sh`](brain-core/scripts/vps-setup-model.sh) | installs Ollama and `saiftechglobal/sg16-brain:Q4_K_M` behind a Cloudflare Tunnel |
| Design source | [`pointoni/`](pointoni/) | the Next.js app the design was first exported from (`site/` has been edited since; see [`AGENTS.md`](AGENTS.md)) |
| Docs | [`docs/`](docs/) | [fresh deployment](docs/FRESH-DEPLOY.md) · [architecture and runbook](docs/BRAIN-CORE-REBUILD.md) · [inference format](docs/FINE-TUNING-FORMAT.md) |
| CI | [`.github/workflows/brain-core-deploy.yml`](.github/workflows/brain-core-deploy.yml) | deploys `brain-core` to Cloudflare; **manual only** (a push never deploys) |

## Admin console

`/admin`: only the operator (`sg16global@gmail.com` with the
`SG16_ADMIN_PASSWORD` secret) can open it. Visitors use the public pages and
never see it.

| Panel | What the owner can do |
|---|---|
| **BRAIN POWER** | switch the brain on or off for everyone at once |
| **BRAIN SERVER** | connect any server running the brain: address and door credentials, test the connection, save without a redeploy, or go back to the deploy setting |
| **PROJECT KEYS** | create an API key for another project by name (shown once) |
| **CONNECTED PROJECTS** | live status per key; **ON / OFF / BROKEN** switch; **RULES** for the project's own instructions, rate limit, wait, JSON-only answers and blocked patterns; **NEW KEY** to replace a key (the old one stops at once) |

Every API project is independent of the website: none of the website's
rules or free-token limits apply to it.

## Using the API from other projects

Create a key on `/admin`, then call:

```bash
curl https://mistralbrain.com/v1/ask \
  -H "Authorization: Bearer <project key>" \
  -H "Content-Type: application/json" \
  -d '{"kind":"chat","text":"Hello!","system":"optional per-call rules","history":[]}'
```

Any client that speaks the standard chat-completions format works too: base
URL `https://mistralbrain.com/v1`, model `sg16-brain`
(`POST /v1/chat/completions`, `GET /v1/models`). The full route list is in
[`brain-core/README.md`](brain-core/README.md#api).

## Run it locally

```bash
ollama pull saiftechglobal/sg16-brain:Q4_K_M     # 7.5 GB, once; `ollama list` shows ID f4b21a5d4668
cd brain-core
npm install
npm test                                         # 134 tests
npx tsc --noEmit -p .
node scripts/sync-web.mjs
npx wrangler dev --local --var MODEL_URL:http://127.0.0.1:11434 \
  --var SG16_IDENTITY_SECRET:<32+ chars> --var SG16_ADMIN_PASSWORD:<test password> \
  --var BILLING_SECRET:<32+ chars> --var SG16_PROJECT_KEY_SECRET:<32+ chars>
# open http://127.0.0.1:8787  (admin: /login → My Domain → sg16global@gmail.com + the test password)
```

## Deploy

Step by step, for a new Cloudflare account, the GitHub repository and a new
brain server: [`docs/FRESH-DEPLOY.md`](docs/FRESH-DEPLOY.md).
Architecture, operations and the admin features:
[`docs/BRAIN-CORE-REBUILD.md`](docs/BRAIN-CORE-REBUILD.md).

## Data and privacy

- Chat history and files stay on the visitor's device.
- Cloudflare (D1, KV) keeps only the following:
  - account emails and passes;
  - per-request counters (no question or answer text, only SHA-256 digests);
  - key fingerprints, project rules and the brain-server setting (credentials encrypted).
- The brain server stores nothing.

Full table: [What is stored, and where](docs/BRAIN-CORE-REBUILD.md#what-is-stored-and-where).

## Company and license

SAIF TECH GLOBAL LLC: Technology Services | Software Development | AI Tools |
Digital Products. 8206 LOUISIANA BLVD NE, STE A #10595, ALBUQUERQUE, NM 87113, USA.

Apache License 2.0; see [`LICENSE`](LICENSE). The model's own license ships
inside each Ollama build.
