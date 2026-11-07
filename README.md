# SOVEREIGN SG16 Brain

**SG16 Brain** — the conversational AI of **SAIF TECH GLOBAL LLC**, live at
**[mistralbrain.com](https://mistralbrain.com)**. This repository is the
official, definitive home of the Brain project.

> Self-hosted · one brain · no third-party AI API · Apache-2.0

## Official links

| | |
|---|---|
| Website | https://mistralbrain.com |
| Source (this repository) | https://github.com/sg16global/SG16-Brain-Apache2.0- |
| Models (Ollama) | https://ollama.com/saiftechglobal/sg16-brain |
| The brain of mistralbrain.com | https://ollama.com/saiftechglobal/sg16-brain:Q4_K_M |

## All branches of the Brain

### Model builds (published on Ollama, all Apache-2.0, 128K-token context window)

| Build | Size | Ollama ID | Use | Run |
|---|---|---|---|---|
| **`Q4_K_M`** | 7.5 GB | `f4b21a5d4668` | **the brain of mistralbrain.com** (integrated in this repository) | `ollama run saiftechglobal/sg16-brain:Q4_K_M` |
| `Q8_0` | 13 GB | `ac9c1b995446` | higher fidelity, more memory | `ollama run saiftechglobal/sg16-brain:Q8_0` |
| `f16` | 25 GB | `2c7021a7e77c` | full-precision weights | `ollama run saiftechglobal/sg16-brain:f16` |

All three builds are the same 12.2B-parameter SG16 Brain at different
precisions. Always name the build: the model has no `latest` tag, so
`ollama run saiftechglobal/sg16-brain` without a tag does not resolve.
mistralbrain.com serves **only** `Q4_K_M`.

### Repository branches

| Branch | Purpose |
|---|---|
| `main` | the released Brain — the single source of truth for mistralbrain.com |

### Project parts

| Part | Path | What it is |
|---|---|---|
| Brain core | [`brain-core/`](brain-core/) | Cloudflare Worker: keys, queue, verification, payments, accounts, and the site's API |
| Public design | [`brain-core/site/`](brain-core/site/) | the mistralbrain.com pages (static export, committed, self-hosted fonts) |
| Brain server setup | [`brain-core/scripts/vps-setup-model.sh`](brain-core/scripts/vps-setup-model.sh) | installs Ollama + `saiftechglobal/sg16-brain:Q4_K_M` behind a Cloudflare Tunnel |
| Design source | [`pointoni/`](pointoni/) | the Next.js app the design was first exported from (`site/` has been edited since; see `AGENTS.md`) |
| Docs | [`docs/`](docs/) | [fresh deployment](docs/FRESH-DEPLOY.md) · [architecture & runbook](docs/BRAIN-CORE-REBUILD.md) · [inference format](docs/FINE-TUNING-FORMAT.md) |

## How it fits together

```
visitor / API project ──▶ mistralbrain.com (Cloudflare Worker: brain-core)
                              │  keys · one-at-a-time queue · verification · math
                              ▼  Cloudflare Tunnel + Access (zero open ports)
                          brain server: Ollama, 127.0.0.1 only
                              saiftechglobal/sg16-brain:Q4_K_M  (the one brain)
```

If the brain server is down, chat fails honestly with `502` — there is no
backup AI service.

## Run it locally

```bash
ollama pull saiftechglobal/sg16-brain:Q4_K_M     # 7.5 GB, once; `ollama list` ID f4b21a5d4668
cd brain-core
npm install
npm test                                         # 124 tests
npx tsc --noEmit -p .
node scripts/sync-web.mjs
npx wrangler dev --local --var MODEL_URL:http://127.0.0.1:11434 \
  --var SG16_IDENTITY_SECRET:<32+ chars> --var SG16_ADMIN_PASSWORD:<test password> \
  --var BILLING_SECRET:<32+ chars> --var SG16_PROJECT_KEY_SECRET:<32+ chars>
# open http://127.0.0.1:8787
```

Production deployment: [`docs/FRESH-DEPLOY.md`](docs/FRESH-DEPLOY.md).

## API in one line

`POST https://mistralbrain.com/v1/ask` with `Authorization: Bearer <key>` and
`{"kind":"chat","text":"..."}` — or any client that speaks the standard
chat-completions format with base URL `https://mistralbrain.com/v1` and model
`sg16-brain`. Full route list: [`brain-core/README.md`](brain-core/README.md).

## Company

SAIF TECH GLOBAL LLC — Technology Services | Software Development | AI Tools |
Digital Products — 8206 LOUISIANA BLVD NE, STE A #10595, ALBUQUERQUE, NM 87113, USA.

## License

Apache License 2.0 — see [`LICENSE`](LICENSE). The model's own license ships
inside each Ollama build.
