# SG16 DELTA PACK — the heart comes home

*Applied on branch `arena/01a0cb1f-soverian-sg16-brain` · SAIF TECH GLOBAL LLC*

This document is the README for the delta pack: what each file does, why it is
shaped that way, and how to verify it. Everything here obeys the frozen
doctrine — **SG16 is the power plant; projects are bodies** — and every claim
below is checkable in the source, not asserted.

---

## 1. What landed, file by file

| # | File | What it does |
|---|---|---|
| 1 | `pointoni/src/lib/ollama-brain.ts` | **Ollama heart-bridge.** Server-side bridge to a local Ollama daemon so the platform keeps answering from the operator's own metal when the Q16.16 core is down. Hard timeout, no content logging, URL from env only, charter preamble on every turn. Inert unless `SG16_OLLAMA_URL` is set. |
| 2 | `pointoni/src/lib/charter-prompt.ts` | **Charter law distiller.** Compresses Master Charter Sections 1-23 + the Master Character Principle into the system preamble one body needs. 16 distilled laws, the 13-step permanent hierarchy, and per-body overlays (flagship / finance / engine). The charter is *not* rewritten — trimmed. |
| 3 | `pointoni/src/lib/warm-alias.ts` | **Warm alias.** One warm human name per runtime (`the sovereign core`, `the hearth`, `the local guard`, `the relay`) and warm system copy for degraded engines, fair-use pauses and tier chips. Warmth never claims a capability the runtime lacks. |
| 5 | `pointoni/src/app/api/brain/route.ts` | **The thinking ladder.** `core → ollama → guard → relay`, reported honestly as `brain:` on every turn. Nothing is written down: no session row, no message row. |
| 7 | `pointoni/src/app/api/health/route.ts` | Honest operator picture: database, core, heart, which engine is currently answering and the charter digest. |
| 8 | `pointoni/src/components/chrome/FooterRail.tsx` | **Footer rail ticker.** The doctrine tape: zero storage, one brain, humanity-bypass and Apache 2.0 — moving under every page. No state, no fetch, no analytics. |
| 9 | `pointoni/src/components/chrome/SiteChrome.tsx` | Mounts the rail at the head of the footer. |
| 10 | `pointoni/src/components/chrome/Sidebar.tsx` | **Sidebar auto-panel.** Presents itself once on a first visit, re-peeks after 45s idle, and can be **pinned** per device. Slide-out on hover/focus is unchanged; the page still owns the full viewport width. |
| 11 | `pointoni/src/app/globals.css` | Rail animation (seamless -50% loop, hover-pause, edge mask) plus a genuine static fallback under `prefers-reduced-motion`. |
| 12 | `pointoni/.env.example` | Documents the bridge and the identity secret — no values, no secrets. |
| 15 | ~~`scripts/engine-sync.sh`~~ | Removed 2026-11-06 with the in-browser FRIEND engine (SG16 Brain Q4_K_M is the one brain). |
| 16 | `scripts/vps-cannon.sh` | **VPS cannon.** Wraps `vps-setup.sh`, installs the Ollama heart-bridge, restarts the units and prints an honest engine verdict. No secrets asked or echoed. |
| 17 | `docs/SG16-DELTA-PACK.md` | This file. |

---

## 2. The thinking ladder

```
browser  ──POST /api/brain──▶  Next.js route
                                 │
                                 ├─ 1. core          Q16.16 sovereign runtime   (@ SG16_BRAIN_URL)
                                 ├─ 2. ollama        heart-bridge on your metal  (@ SG16_OLLAMA_URL)
                                 ├─ 3. fallback-local local guard channel        (in-process)
                                 └─ 4. relay         external grid models        (unchanged)
```

Every response carries the runtime that actually answered:

```json
{ "brain": "core" | "ollama" | "fallback-local" | "relay", "tier": "free" | "work" }
```

**Why it matters:** before this, a dead core silently produced a bracketed machine note. Now the second rung is the operator's own Ollama, and if even that is down the notice is written warmly while still naming the real reason (charter §10 honest claims, §19 intellectual honesty).

---

## 4. Configure & run

```bash
cd pointoni
npm ci
cp .env.example .env        # then edit — no secrets are ever requested here

# optional: bring the heart online (the one brain, registered from its GGUF)
ollama create saiftechglobal/sg16-brain:q4_k_m -f ../brain-core/model/Modelfile
#   SG16_OLLAMA_URL=http://127.0.0.1:11434
#   SG16_OLLAMA_MODEL=saiftechglobal/sg16-brain:q4_k_m

npx next build && npx next start
curl -s localhost:3000/api/health | head -c 400
```

The health payload answers the only question an operator really has:

```json
{ "brain": "offline", "heart": { "status": "online", "model": "mistral" },
  "answering": "ollama", "engines": ["core", "ollama", "fallback-local"] }
```

---

## 5. Verification performed

- `npx tsc --noEmit` — **clean**.
- `npx next build` — **succeeded** (see the build log in the session).
- `node -e "require('lucide-react')"` — confirmed the icons used by the pin control exist in the pinned version.
- Runtime proof: with no core and no Ollama reachable, `/api/brain` still answers and reports `brain: "fallback-local"`; with only Ollama, it reports `brain: "ollama"`.

---

## 6. Frozen invariants (unchanged by this pack)

1. `modelId` from the world's point of view is always `sg16-brain`.
2. `X-Chat-Tier` / rate headers are shown honestly to every body.
3. Demonstration data stays labelled demonstration (the footer rail carries no
   market numbers; the tape panel keeps its own DEMO TAPE line).
4. The humanitarian bypass is inherited, never wired off.
5. Style differs per body; math, routing and core ownership never differ.

---

*One brain, many bodies, all of them small and honest. The heart now beats on
the operator's own metal when the core is out of reach — and the platform says
which engine answered, every single time.*
