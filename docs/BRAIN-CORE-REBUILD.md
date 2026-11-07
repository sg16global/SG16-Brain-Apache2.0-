# SG16 Brain — architecture and runbook

The brain of mistralbrain.com: a deterministic core on Cloudflare Workers, one
self-hosted model on a brain server behind a Cloudflare Tunnel, universal
language handling and one-at-a-time queue discipline. Code: `brain-core/`.
First-time setup on new accounts: `docs/FRESH-DEPLOY.md`.

## Architecture

```
                                    ┌──────────────────────────────────┐
 visitor / project key ──▶ HTTPS ──▶│ Cloudflare Worker: sg16-brain-core │
                                    │  KV keys · DO queue · DO matrix    │
                                    │  D1 logs · verification · math     │
                                    └───────────┬──────────────────────┘
                                                │ semaphore = 1, FIFO, lease expiry
                                                │ Cloudflare Tunnel + Access service token
                                                ▼
                                   brain server (16 GB+): Ollama, ONE brain:
                                   saiftechglobal/sg16-brain:Q4_K_M
                                   (7.5 GB, 12.2B, ID f4b21a5d4668),
                                   bound to 127.0.0.1, ctx 8192, zero open ports
                                                │ if the brain server fails, the request fails honestly (502)
                                                ▼
                                   (no third-party AI API exists in this system)
```

## The brain

| | |
|---|---|
| Model | `saiftechglobal/sg16-brain:Q4_K_M` — https://ollama.com/saiftechglobal/sg16-brain:Q4_K_M |
| Size / parameters / quantization | 7.5 GB (7,477,728,576 bytes of weights) · 12.2B · Q4_K_M |
| Ollama ID (manifest) | `f4b21a5d4668` (`sha256:f4b21a5d4668a6e684b9f91d318ff7dedf8390bb75f9a02d1a1157abc5c933b5`) |
| Weights layer | `sha256:966a7e76a38e90bbf46a8a56eea9f2a6bf7a8a16e2c705ae94bbc5ab89623dfd` |
| Chat template | carried by the published package (`[INST]…[/INST]`, system prompt on the first user turn) |
| Package parameters | `num_ctx` 16384, `temperature` 0.7, `top_k` 40, `top_p` 0.9, `repeat_penalty` 1.1, stops `[INST]` `[/INST]` `</s>` |
| What the Worker overrides | `num_ctx` = 8192 on every request (`MODEL_NUM_CTX`); every other parameter is the package's own |
| License | Apache-2.0 (shipped inside the package) |

The brain server installs it with `ollama pull` (`brain-core/scripts/vps-setup-model.sh`)
and refuses any build whose ID is not `f4b21a5d4668`. There is exactly one brain
(`OLLAMA_MAX_LOADED_MODELS=1`, `OLLAMA_KEEP_ALIVE=30m`, never -1); the setup
script removes every other model from the box. The Worker has no other model
and no fallback AI service, and `/v1/health` reports the model as online only
when the brain server lists `MODEL_NAME` among its installed models.

The larger published builds (`Q8_0`, 13 GB; `f16`, 25 GB) are not used by this
project.

RAM budget on a 16 GB server (e.g. OVH b3-16): ~7.5 GB weights + ~1.3 GB KV
cache (8K ctx) + ~2 GB OS/runtime ≈ 11 GB, with headroom.

Speed measured on the studio PC (24 GB RAM, CPU) with an earlier local
Q4_K_M build of the same model: ~2.3 tokens/s generation, ~5 tokens/s prompt
reading; a short chat reply ~6 s, a 300-token explanation ~170 s.
`INFERENCE_TIMEOUT_MS` is 95 s (under Cloudflare's ~100 s origin cap on the
tunnel), so long answers need a faster brain server.

## Free tier (tokens) and visitor accounts

Free website chat needs a (free) visitor account. Sign-up and sign-in are one
step on the My Domain page (`/login`, add-on `site/sg16-account.js`): the
visitor enters an email, gets a 6-digit code from the `EMAIL_FROM` sender
(Cloudflare Email Sending, binding `EMAIL`) and enters it; the first right
code creates the account. Codes live 10 minutes, take 5 tries, and an email
gets at most one code a minute and 5 an hour (`src/accounts.ts`). D1 keeps
only `accounts` (email, created/last sign-in, the account's pass) and
`login_codes` (one hashed code per email); the Worker creates both tables on
first use.

Each account has a one-time allowance of `FREE_TOKEN_ALLOWANCE` model tokens
(default 10,000; prompt + answer, as counted by the model server) in its own
`MatrixDO` bucket, so it follows the person to every device. Only a delivered
answer is charged. When it is spent, `/api/brain` answers `402` with
`{ error, freeTokensExhausted: true, subscribeUrl: "/subscription" }`. Not
signed in and no pass: `401 { signInRequired: true, signInUrl: "/login" }`.
A pass used while signed in is kept with the account and works on every
device the visitor signs in on. API project keys are not metered.

Until the domain is onboarded to Cloudflare Email Sending (Workers Paid is
needed to send to any address), `/api/identity` `request` answers "Email
sign-in is not switched on yet".

## The operator (admin) and the admin switches

- **Admin sign-in:** only `sg16global@gmail.com`, with the password in the
  Cloudflare secret `SG16_ADMIN_PASSWORD`. No secret = admin sign-in is off.
  An email code never opens the admin console, not even for that email.
- **BRAIN POWER** (`site/sg16-power.js`, `GET|POST /api/admin/brain-power`):
  ON = the brain answers; OFF = every chat (website, passes, API keys) gets
  `503 E_BRAIN_OFF` and nothing reaches the model or is charged. Held by the
  global queue Durable Object, so it applies everywhere at once and survives
  deploys.
- **API keys** (`site/sg16-projects.js`, `POST /api/admin/project-control`):
  each key is ON (works), OFF (paused: `403 E_KEY_OFF`) or BROKEN (retired for
  good: `401`). Keys called in the last 24 h show green; never-used and idle
  keys are marked UNUSED. Stored in KV (`projctl:<key id>`), so a switch
  reaches every edge within about a minute.
- **BRAIN SERVER** (`site/sg16-gateway.js`, `src/admin-gateway.ts`,
  `GET|POST|DELETE /api/admin/brain-server`, `POST /api/admin/brain-server/test`):
  see "Connect any brain server" below.
- **PROJECT RULES and NEW KEY** (`site/sg16-projects.js`): see "API projects"
  below.

## Connect any brain server

The core is not tied to one server. Any machine that runs Ollama with
`saiftechglobal/sg16-brain:Q4_K_M` can be the brain:

1. On the new server (Ubuntu/Debian, 16 GB RAM), as root:
   `DOMAIN_INTERNAL=internal.your-domain.com bash brain-core/scripts/vps-setup-model.sh`.
   It installs Ollama, pulls the brain, checks its ID, keeps Ollama on
   127.0.0.1 and opens a Cloudflare Tunnel to that hostname.
2. Lock the hostname with Cloudflare Access (service token).
3. On `/admin` → **BRAIN SERVER**: enter `https://internal.your-domain.com`,
   choose the door credentials, press **TEST CONNECTION** and then
   **SAVE & CONNECT**. No redeploy; every Cloudflare location uses the new
   server within about a minute (KV read cache: 30 s).

Door credentials:

| Choice | What is sent to the brain server |
|---|---|
| CLOUDFLARE SECRETS (default) | the deployment's `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, `MODEL_SHARED_SECRET` |
| ENTER HERE | values typed on `/admin`; stored in KV `brain:server` encrypted with AES-GCM (key derived from `SG16_IDENTITY_SECRET` by HKDF), never sent back to the browser; a blank field keeps the saved value |
| NONE | no credentials (only for a server that is already private, e.g. local testing) |

Addresses must be `https://` (any host, optional path); `http://` is accepted
only for this machine (`localhost`, `127.0.0.1`). **USE DEPLOY SETTING** deletes
the saved server and goes back to `MODEL_URL`. If `SG16_IDENTITY_SECRET`
changes, saved custom credentials can no longer be read; the panel says so
and they must be entered again. The test reports: connected and the brain
installed, the server answers but the brain is missing (with the models it
found), the door refused (401/403), timeout, or not reachable.

## API projects (other projects using the brain)

The owner's other projects connect with their own key. Every project is
independent of the website: none of the website's system prompt, self-check
or free-token limits apply to a project key.

- **Create:** `/admin` → PROJECT KEYS → name → CREATE KEY (`sg16p_…`, shown once).
- **RULES** (per project, `GET|POST|DELETE /api/admin/project-rules`, stored as
  KV `policy:<project>`): instructions for the brain (up to 16,384
  characters), requests per minute per key (1–10,000, default 60), maximum
  wait for the brain (up to `MAX_QUEUE_WAIT_MS`), JSON-only answers
  (`{"answer": "…"}`), and blocked patterns (regular expressions; matching
  questions are refused with `403`, matching answers are not delivered). The
  instructions are sent to the brain first, then any `system` text the
  project sends with a call. All keys of a project share its rules. The name
  `web` is reserved for the website itself.
- **NEW KEY** (`POST /api/admin/project-keys {rotate: <key id>}`): a fresh key
  for the same project; the old key stops at the same moment (BROKEN).
- **ON / OFF / BROKEN:** as above.

A project calls `POST /v1/ask` (`{"kind":"chat","text":"…","system":"…","history":[…]}`)
or `POST /v1/chat/completions`, with `Authorization: Bearer <its key>`.

## What is stored, and where

Nothing is stored on the brain server: it only runs the model.

| Store (Cloudflare) | What | Not stored |
|---|---|---|
| D1 `accounts` | visitor email, created / last sign-in, the account's pass | names, chat text, files |
| D1 `login_codes` | one HMAC of the current sign-in code per email | the code itself |
| D1 `checkouts`, `passes`, `webhook_events` | pass purchases (Dodo reference, status, pass token record) | card or bank details (Dodo holds them) |
| D1 `requests` | per call: time, key id, project, kind, status, timings, script | the question or the answer |
| D1 `history` | SHA-256 digests of question and answer | the question or the answer |
| KV `KEYS` | SHA-256 of API keys, key records, project rules, key switches, the brain-server setting (credentials encrypted) | API keys themselves |
| Durable Objects | the queue slot; per-key rate window, score and free-token count | any text |
| Visitor's device | chat history, files, the pass token (browser storage) | — |

## Language handling

- **No hardcoded language logic anywhere.** No language-specific prompts,
  routing or flags.
- **Universal autodetect:** `src/detect.ts` walks Unicode script ranges and
  reports the dominant script of each message. Nothing routes on it.
- **One universal prompt rule** (`src/prompt.ts`): *"Always reply in the same
  language the user writes in."* Mixed input → the dominant language.
- **The core speaks only machine codes** (`E_RATE_LIMIT`, `E_UNVERIFIED`, ...)
  with standard HTTP status. Human language is produced by the model and is
  verified by the core before it is accepted.

The model, not the core, decides reply quality in each language.

## Queue discipline (how flooding is impossible)

`InferenceQueueDO` (name `global`) holds one semaphore. `acquire` returns
either the slot or a FIFO position plus a per-request deadline
(`min(policy.max_queue_ms, MAX_QUEUE_WAIT_MS)`). The Worker polls until
granted or expired, then calls the brain server exactly once. `release` frees
the slot and grants the next ticket. If a caller dies without releasing, the
lease expires (`leaseMs` 300 s — draft + retry + self-check at 95 s each, with
headroom) and the next acquire reclaims the slot — no deadlock, no flood, no
OOM from concurrency.

## Verification (the core never trusts the model)

The draft passes `src/verify.ts` before it is accepted: structure (JSON
`{answer}` when the project requires it), size cap, control-character check,
and the project's blocked regex patterns. One retry on failure; a second
failure rejects with `E_UNVERIFIED`. Optional self-check (`SELF_CHECK="true"`,
off by default — it doubles answer time): the same model re-reads its own
draft (`checkMessages`) and either confirms it ("OK") or returns a corrected
answer, which must pass `verify.ts` too. Compute and state routes never touch
the model.

## Keys and load test

```bash
node scripts/make-key.mjs                        # owner = user 1
node scripts/make-key.mjs --user 2 --project <name>
node scripts/loadtest.mjs keys.txt               # 10 concurrent project connections
```

Each key is printed ONCE with the exact `wrangler kv key put` command.
Rotation is `POST /v1/keys` with the current key — the same path for the
owner. Load-test criteria: all 10 end 200; inference never runs twice at
once; `free -m` on the brain server stays flat.

## Zero open ports

The tunnel is outbound-only, so the brain server needs no inbound port:

1. `ufw default deny incoming && ufw allow outgoing && ufw enable`.
2. SSH is the one service you still need: move it behind the tunnel
   (`cloudflared access ssh`, Zero Trust docs) **before** closing port 22 —
   otherwise the box becomes unreachable.
3. Back up the Worker's data with `wrangler kv key list` and a D1 export.

## Constraints honored

- No third-party AI API — none exists in this system. If the brain server is
  down, chat fails honestly with 502.
- D1 stores real request rows and history digests only — no synthetic
  metrics, no fake counters. History stores SHA-256 digests, never message
  text.
- The brain's logic has no owner override; the owner authenticates with the
  same key system as everyone else (user #1).
