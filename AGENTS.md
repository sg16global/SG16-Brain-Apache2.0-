# AGENTS.md — standing rules for this repository

These rules apply to every engineer and agent working on SG16. Higher-level
docs may add rules; nothing may remove these.

## 1. The public design is protected

`mistralbrain.com`'s visible design (`brain-core/site/`, mirrored from the
pointoni app) was built by the owner over many hours, and the owner has
requested repeatedly: **do not destroy or replace the public design.**

- No change to the homepage or any public page's look without the owner's
  explicit approval on the specific change.
- Deploys must stage the design via `brain-core/scripts/sync-web.mjs`
  (`site/` is the whole front-end; the old `web/` chat panel at `/panel/`
  was removed at the owner's request on 2026-10-18 and is no longer staged).
- A change is "approved" only when the owner has seen and accepted it —
  never assume visual changes are wanted as part of backend work.
- If a task would alter what visitors see, stop and ask first.

## 2. The brain and the design are separate concerns

Backend work (Worker routes, D1, KV, the VPS model server, payments) must
proceed without touching `brain-core/site/` or `web/` unless the task
explicitly names them.

## 3. Deploy discipline

- `main` deploys automatically on push (`.github/workflows/brain-core-deploy.yml`).
- The cutover of 2026-10-17 replaced the owner's design with a plain panel
  without approval. That must not happen again — the design is now committed
  (`brain-core/site/`) precisely so no deploy or sync can revert it.

## 4. The owner's build process (binding, added 2026-10-17 after the all-day outage)

The owner's words: "follow the user's prompt first, build exactly that, then
the owner checks with their own eyes; if you see a problem or suggestion, tell
it a thousand times instead of acting on it."

- **Build exactly what the prompt asks.** No "while I'm here" improvements, no
  architectural liberties, no extra refactors. If a change is not in the
  owner's request, it does not ship.
- **The owner verifies with their own eyes before anything is called done.**
  A deploy is not "finished" — the owner must see the result in the browser and
  accept it. Give them the exact URL to check, every time.
- **Problems and suggestions are reported, repeatedly, not acted on.** If you
  see something broken or improvable outside the assigned task, say so and
  say it again — never fix it silently on your own authority.
- **One task, one deploy, one verification.** Never stack multiple unrequested
  changes into one deploy. Every deploy must be attributable to one owner
  request, so a bad deploy can be found and reverted in one step.
