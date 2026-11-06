# SG16 CONNECTOR API — how every future body plugs into the brain

*Doctrine: **SG16 is the power plant; projects are bodies.** Each domain has its
own face, own algorithms, own math — and draws reasoning power from one brain via
one small API. This document is the contract every future project connects against.
Bodies launch only after the brain is complete; this file freezes the cable.*

---

## 1. One endpoint to rule the bodies

```
POST /api/brain
Content-Type: application/json
Authorization: Bearer <sovereign-token>     # optional — elevates to WORK mode
{
  "sessionId": "optional-uuid-to-continue",
  "modelId":   "sg16-brain",                # exclusive core; directory models are atlas-only
  "message":   "any natural-language input"
}
```

Response:

```json
{
  "sessionId": "…", "userMessage": {…}, "assistantMessage": {…},
  "brain": "core", "tier": "free | work"
}
```

- Per-response reality tags: `brain: core | fallback-local | relay`, `latencyMs`, `relay`.
- Rate headers on every reply: `X-Chat-Tier`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` — every body gets identical fairness for free.
- 429 carries a human message + `retryAt` — bodies must surface it, not hide it.

### Your project's own rules (API bypass — 2026-10-19)

A call made with a project key (`Authorization: Bearer sg16p_…`, on
`/api/brain` or `/v1/ask`) gets the brain **clean**: none of SG16's own
website rules (the SG16 system prompt, its tone and language rules, the
self-check) are applied. Only what your project sends reaches the model:

```
{
  "message": "the user's text",                       // /v1/ask: "text"
  "system":  "your project's own rules (optional, max 16K characters)",
  "history": [ { "role": "user", "content": "…" },     // optional, last 8 turns,
               { "role": "assistant", "content": "…" } ] // sent as real chat turns
}
```

What still applies, because it protects the shared VPS and your key: the key
check, your project's rate limit, the one-at-a-time queue, and the basic output
checks (not empty, size cap). Website visitors (no key) always keep SG16's own
rules and cannot send `system`.

### Standard door: OpenAI-compatible (2026-10-27)
Any client that speaks the standard chat-completions protocol connects with three values and no custom code:
```
base URL : https://mistralbrain.com/v1
API key  : a sg16p_ project key (or a sg16_ key)
model    : sg16-brain
```
- `POST /v1/chat/completions` — `{ model, messages: [{ role, content }] }` → a standard `chat.completion`.
  `system` messages become the project's own rules, earlier turns the history (last 8), the last `user`
  message the question. Same pipeline as `/v1/ask`: key check, project rate limit, queue, safety gate,
  output verification; every question is answered by the one SG16 Brain (Q4_K_M).
- `GET /v1/models` — lists `sg16-brain`.
- Text only and no streaming: `stream: true` or image/audio parts get a clear 400, another model name a 404.
  Errors use the standard `{ error: { message, type } }` shape (401, 429 busy/rate limit, 502 model down).

## 2. Same brain, every body — the allowed shapes

| Body | Flavor | Same call, different costume |
|---|---|---|
| mistralbrain.com | full sovereign platform (today's build — reference body) | ChatPanel UI, vaults & capsule |
| sg16finance.com | market analyst — inject ticker snapshot into `message`, read `assistantMessage` | chain with the demo-tape source |
| sg16engine.com | weights/engine CDN + docs + this API | host-only, calls nothing |
| corporate domains | projector/window into the brain | embedded mini-chat |

A body is *only ever* a shell around this POST. No body ever asks for a model other than `sg16-brain`.

## 3. Tiers the API enforces automatically

```
guest shell           → free  20  msgs/hour per visitor IP
signed-in shell       → same until a pass is vaulted to the email
subscriber shell      → work  500 msgs/hour (Bearer token from /api/identity)
humanitarian region   → unlimited, zero-rate billing bypass (existing rule, all bodies inherit it)
```

Bodies don't implement licenses. They forward Bearer. The brain enforces.

## 4. Zero-storage guarantee bodies inherit

- Showroom brain holds sessions in volatile memory only; the copy-of-record always moves to the user's own device/capsule.
- Identity = one email column, ever. Pass vaulting ready now (`/api/identity`) on every domain.

## 5. Frozen invariants (bodies must NOT break)

1. Exclusive model routing — `modelId` always `sg16-brain` from the world's point of view; internal tiers are the brain's private business.
2. `X-Chat-Tier` shown honestly to every body-user.
3. Demonstration data is labeled demonstration (tickers, analytics).
4. Humanitarian bypass is replicated, never wired off, in new bodies.
5. Style can differ per body; math/routing/core ownership never differ.

## 6. Reference call (copy-paste — what every satellite needs)

```ts
const r = await fetch(BRAIN_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ message: userText, modelId: "sg16-brain", sessionId }),
});
const { assistantMessage, sessionId: sid, tier } = await r.json();
// show assistantMessage.content; store nothing; keep tier visible; cache nothing.
```

*Bodies live on their own domains and their own look; they never fork the core, they draw power from it. When a body grows traffic, the answer is a mirror/sister host behind the same signed manifest — never a vendor API.*

— connector v1 · SAIF TECH GLOBAL LLC · the power plant stays singular, the bodies multiply

## Modes (what the request is for)

`POST /api/brain` accepts an optional `"mode"`: `"chat"`, `"assistant"`, `"code"`, `"build"` or `"auto"` (the default).

| Mode | Behaviour |
|---|---|
| `chat` | Conversational, short by default. |
| `assistant` | Does the task and returns the finished result (draft, plan, table, JSON, checklist); no small talk. |
| `code` | Complete runnable code in fenced blocks, file names, no greeting or closing remarks; larger answer budget. |
| `build` | A short plan (stack, files, run steps), every file in full, then next improvements; can write a ready-to-paste prompt for another coding tool. |
| `auto` | Decided from the text: pasted code or fenced blocks give `code`, "build me an app…" gives `build`, anything else `chat`. |

A valid explicit mode always wins over detection. The reply carries the mode that was used (`"mode"`). The safety gate screens every request in every mode.

## Running code (sandbox)

`POST /api/run` with `{ "language": "python" | "node", "code": "...", "timeoutMs": 10000 }`. Only the operator and signed project keys may call it; visitors cannot run code. It is off unless `SG16_SANDBOX_ENABLED=1`.

Each run is a throwaway Docker container: no network, read-only filesystem plus a 16 MB `noexec` tmpfs, all capabilities dropped, no privilege gain, unprivileged user, 128 MB memory, 0.5 CPU, 64 processes, 10 s default (30 s maximum), 64 KB output. The code goes in on stdin and the images are never pulled at run time. Reply: `{ ok, exitCode, stdout, stderr, timedOut, truncated, ms }`.

Host setup: install Docker (rootless Docker is best: membership of the `docker` group is root-equivalent on the host), then `docker pull python:3.12-alpine node:22-alpine`. At most two runs at once (`SG16_SANDBOX_CONCURRENCY`).
