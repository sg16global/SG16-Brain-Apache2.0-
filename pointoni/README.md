# Pointoni — Sovereign SG16 Platform (Next.js full stack)

Premium red-neon front-end + full-stack API for the **Soverian SG16 Brain**.
The ChatPanel routes through **`/api/brain`**, the sovereign chat routing
point that answers self-hosted requests from the real SG16 core
(Q16.16 fixed-point mathematics through the sealed master door).

> Core protection rule: nothing under `../sg16/`, `../config/`, `../web/`,
> `../knowledge/`, `../scripts/` or `../tests/` is modified by this app.
> The brain is reached over HTTP only.

## Architecture

```
Browser ChatPanel
   │  POST /api/brain { modelId, message, sessionId? }   (same origin)
   ▼
Next.js route  src/app/api/brain/route.ts
   │  • validates + caps payloads (8 000 chars)
   │  • persists user/assistant messages (drizzle)
   │  • selfHosted models ──▶ brain gateway
   │  • external grid models ─▶ orchestrator relay personas (relay: true)
   ▼
src/lib/brain-gateway.ts          (server-side only; hard timeout; no client exposure)
   │  POST {SG16_BRAIN_URL}/api/ingest  { text, session_id }
   ▼
SG16 core host (Python stdlib, config/brain.json → 0.0.0.0:8080)
   master door → 3-GPT gate → Q16.16 core → sealed response
```

If the core link is down, `/api/brain` degrades to a clearly flagged local
guard answer (`brain: "fallback-local"`) instead of stranding the UI, and
recovers automatically when the core returns.

## Run

```bash
# 1. the brain core (from the repository root)
npm run brain                 # = python3 ../scripts/serve.py (0.0.0.0:8080)

# 2. this platform
npm install
npm run build && npm start    # or: npm run dev
```

## Persistence

- `DATABASE_URL` set → real PostgreSQL (production path; run
  `npx drizzle-kit migrate` with the migrations in `./drizzle/`).
- unset → **sovereign local mode**: an in-memory PostgreSQL boots in-process
  with the same drizzle migrations applied. Zero external services, fully
  air-gapped; data lives for the process lifetime.

## Environment

See `.env.example`: `DATABASE_URL`, `SG16_BRAIN_URL` (server-side only),
`SG16_BRAIN_TIMEOUT_MS`, and optional provider keys for the relay personas.

## Key endpoints

| Route | Purpose |
| --- | --- |
| `POST /api/brain` | chat through the SG16 core (ChatPanel target) |
| `GET /api/brain?session=<id>` / `?sessions=1` | session archive |
| `GET /api/brain?probe=health` | core reachability probe |
| `DELETE /api/brain?session=<id>` | delete session (DB + core state) |
| `GET /api/health` | `{ ok, database, brain, persistence }` stack status |
