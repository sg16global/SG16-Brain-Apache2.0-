# sg16-brain-core

The SG16 Brain core — a Cloudflare Worker that owns all deterministic logic
and serves the public site, with one self-hosted model on a brain server
behind a Cloudflare Tunnel.

```
visitor/project ──▶ Worker (this package)          [deterministic: keys, routing, state, scoring, verification, queue]
                        │  one at a time, FIFO queue (Durable Object)
                        ▼
                   brain server: Ollama, 127.0.0.1 only, zero open ports
                        via https://internal.<your-domain>  (Cloudflare Tunnel + Access)
                        ONE brain: saiftechglobal/sg16-brain:Q4_K_M (7.5 GB, ID f4b21a5d4668)
                        every answer is verified by the core (optional self-check: SELF_CHECK); no third-party AI API exists
```

## The brain

The brain server can be any machine running Ollama with this model: set it
on `/admin` → BRAIN SERVER (saved in KV, wins over `MODEL_URL`, no redeploy)
or with the `MODEL_URL` deploy setting. See `../docs/BRAIN-CORE-REBUILD.md`
("Connect any brain server", "API projects", "What is stored, and where").

`MODEL_NAME` = **`saiftechglobal/sg16-brain:Q4_K_M`**, exactly as published at
https://ollama.com/saiftechglobal/sg16-brain:Q4_K_M (7.5 GB, 12.2B parameters,
Q4_K_M, Ollama ID `f4b21a5d4668`). The brain server installs it with
`ollama pull` (`scripts/vps-setup-model.sh`), which refuses any other build.
The Worker calls Ollama's `/api/chat` and caps the context at 8192 tokens
(`MODEL_NUM_CTX`); everything else (template, stop tokens, sampling) comes
from the published package. `/v1/health` reports `model: true` only when the
brain server lists this model as installed.

## Layout

```
src/        the Worker (TypeScript, no runtime dependencies)
site/       the public design (static export, committed; staged by scripts/sync-web.mjs)
  fonts/    self-hosted fonts (OFL licences alongside)
test/       node:test suites
scripts/    fresh-setup, make-key, loadtest, sync-web, vps-setup-model.sh, extract-rsc
schema.sql  D1 tables
```

## Bindings

| Binding | Store | Purpose |
|---|---|---|
| `KEYS` | Workers KV | `sha256(api key) -> key record`; `policy:<project>` project rules; `projctl:<key id>` switches; `brain:server` the brain-server setting (credentials encrypted) |
| `LOGS` | D1 (`schema.sql`) | request logs + history digests (real events only), accounts, payments |
| `QUEUE` | Durable Object `InferenceQueueDO` | the single inference slot: semaphore + FIFO + lease expiry; BRAIN POWER switch |
| `MATRIX` | Durable Object `MatrixDO` | per-key living matrix: rate window, totals, integer score, free-token bucket |
| `ASSETS` | Workers static assets | the staged `site/` |

## API

Core (machine codes + the model's answer; nothing else):

| Route | Purpose |
|---|---|
| `POST /v1/ask` `{kind:"chat", text}` | gate -> queue -> brain -> verify -> (self-check if SELF_CHECK) -> answer |
| `POST /v1/ask` `{kind:"compute", op:"2+3*4"}` | deterministic arithmetic inside the Worker — no model involved |
| `POST /v1/ask` `{kind:"state", op:"score.step", delta}` | matrix state transition |
| `GET /v1/state` | the caller's own matrix row |
| `POST /v1/keys` | rotate the calling key itself (owner included) |
| `GET /v1/health` | kv / d1 / queue / model / power probes |
| `POST /v1/chat/completions` | the standard chat-completions request format (`model: "sg16-brain"`), same pipeline as `/v1/ask`; text only, no streaming |
| `GET /v1/models` | lists `sg16-brain` |

Errors are always `{ok:false, code:"E_*"}` with the matching HTTP status
(the chat-completions door uses the standard `{error:{message,type}}` shape).
Human language exists only inside `answer` — produced by the model, verified
by the core.

Site routes (used by the pages in `site/`):

| Route | Purpose |
|---|---|
| `GET/POST /api/brain` | website chat (sign-in or pass required; free-token metered) |
| `GET/POST /api/identity` | visitor email-code sign-in, operator sign-in |
| `GET /api/models`, `GET /api/health`, `GET /api/charter`, `GET /api/parity` | status pages |
| `POST /api/session/forget`, `POST /api/ingest`, `POST /api/project-scan` | session reset, ingest, project scan |
| `GET /api/admin/project-keys` (+ POST/DELETE; POST `{rotate}` = new key, old one retired), `GET /api/admin/project-activity`, `POST /api/admin/project-control`, `GET/POST /api/admin/brain-power` | admin console |
| `GET/POST/DELETE /api/admin/brain-server`, `POST /api/admin/brain-server/test` | admin: connect any brain server, no redeploy (`src/admin-gateway.ts`) |
| `GET/POST/DELETE /api/admin/project-rules` | admin: each API project's own instructions and limits |
| `GET/POST /api/billing`, `POST /api/dodo/checkout`, `POST /api/dodo/webhook`, `POST /api/dodo/confirm`, `POST /api/billing/confirm`, `POST /api/pass/verify`, `POST /api/pass-check` | passes (Dodo Payments) |

## Tests

```bash
npm test               # 134 tests (node:test)
npx tsc --noEmit -p .  # type check
```

## Deploy

Fresh accounts: `../docs/FRESH-DEPLOY.md` (local check -> GitHub -> Cloudflare
-> brain server). Architecture and operations: `../docs/BRAIN-CORE-REBUILD.md`.
