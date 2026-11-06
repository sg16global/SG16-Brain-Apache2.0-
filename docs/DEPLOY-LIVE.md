# Deploying the `fixes` branch to the live server (/opt/sg16)

One script does it, with a backup first and an automatic rollback: `scripts/deploy-live.sh`.

## Before you run it

1. **Take a provider snapshot of the VPS.** The script refuses to run without `--snapshot-done`; that flag is your
   statement that you did.
2. Make sure `/opt/sg16-test` is on the latest `fixes` (it is the clone you run the script from):
   `git -C /opt/sg16-test pull --ff-only origin fixes`
3. Have a second SSH session open, in case you want to watch `journalctl -u sg16-web -f`.

## Run it

Look first (changes nothing; it prints every step it would take, validates the new Caddyfile on a temporary copy,
and shows how the systemd units would change):

```
sudo bash /opt/sg16-test/scripts/deploy-live.sh --snapshot-done --dry-run
```

Then the real thing:

```
git -C /opt/sg16-test pull --ff-only origin fixes && sudo bash /opt/sg16-test/scripts/deploy-live.sh --snapshot-done
```

It takes a few minutes (npm ci + build). At the end it prints `DEPLOY OK`, or `ROLLED BACK`.

## What it does, in order

| # | Step | If it fails |
|---|---|---|
| 0 | Checks tools, free disk (3 GB), that `/opt/sg16` is a git checkout, shows what is uncommitted | stops, nothing changed |
| 1 | Backup into `/root/backups/<timestamp>` (mode 0700): tar of `/opt/sg16` without `node_modules` and `.venv`, plus copies of `.env`, `state/`, the Caddyfile and the `sg16-*` systemd units, plus the current git commit | stops, nothing changed |
| 2 | `git stash` of the server's uncommitted edits to **tracked** files (kept, listed in `git stash list`), `git fetch`, `git checkout fixes`, `git pull --ff-only`. Untracked files (`.env`, `.venv`, `state/`, `stage-bg.jpg`) are never touched. If the branch would overwrite an untracked file it stops instead | rollback |
| 3 | `.env`: adds `SG16_PROXY_AUTH_SECRET` and `SG16_BILLING_SECRET` (random, via `openssl`) **only if missing**; adds `SG16_ANSWER_QUEUE_WAIT_MS=30000` and `SG16_OLLAMA_TIMEOUT_MS=60000` **only if unset**. Existing values are never changed. Secret values are never printed | rollback |
| 4 | Caddyfile: adds `header_up CF-Connecting-IP {client_ip}` and `header_up X-SG16-Proxy-Auth <same secret as .env>` to the `reverse_proxy 127.0.0.1:3000` block, and (if the file has no global options block) Cloudflare's trusted ranges. It is installed only after `caddy validate` passes; if validation fails the Caddyfile is left as it was and the deploy continues (per-visitor rate limits then stay off) | continues, with a warning |
| 5 | Moves the old `node_modules` and `.next` to `/opt/sg16/.deploy-rollback` (outside `pointoni/`, because TypeScript scans everything inside it), then `npm ci --include=dev --ignore-scripts`, `npm run sync-onnx`, `npx next build` | rollback |
| 6 | Installs the `sg16-core`, `sg16-web` and `sg16-healthcheck` units. Your existing bind address, interpreter path and any extra `Environment=` lines in the old units are carried over | rollback |
| 7 | Restarts `sg16-core`, waits for health, restarts `sg16-web`, waits for `/api/live` | rollback |
| 8 | Verifies: core `:8080/api/health`, platform `:3000/api/live` and `/api/health`, **one real clean chat** (must be answered by ollama, core or the local guard) and **one dangerous message** (must be stopped by the gate, `core-gate`) | rollback |
| 9 | Only now enables the watchdog timer (`sg16-healthcheck.timer`) | warning only |

Anything failing in steps 2-8, or you pressing Ctrl+C, runs the **rollback**: previous git commit and branch,
`stash pop`, `.env`, Caddyfile and units restored from the backup, old `node_modules` and `.next` moved back, core and
web restarted and re-checked. It ends with `ROLLED BACK`. The backup directory is kept either way.

## What it will never do

`git reset --hard`, `git clean`, `git stash -u`, a forced checkout, touching anything inside `state/`, editing any Dodo
setting (note: the code on the `fixes` branch itself carries the Dodo product IDs and `test_mode` that you committed earlier;
the script does not edit them), or printing a secret.

## After a successful deploy

- `systemctl list-timers sg16-healthcheck.timer` and `journalctl -u sg16-healthcheck -n 20`.
- Open the admin page: the "traffic" card should start counting.
- Per-visitor rate limits need the Caddy header. The script's last lines say what it did to the Caddyfile
  (`caddy: ...`). If it says it left the Caddyfile unchanged, read `docs/OPERATIONS.md` ("What the proxy chain must do")
  and add the lines by hand.
- If the clean chat reported `engine=fallback-local` or `core`, Ollama was not used: check `SG16_OLLAMA_URL` and
  `SG16_OLLAMA_MODEL` in `/opt/sg16/.env`.
- Your earlier server edits are in `git -C /opt/sg16 stash list` (not re-applied; the `fixes` branch already contains the
  ported billing/pass persistence). Delete the stash only when you are sure nothing in it is still needed.
- Disk: `/opt/sg16/.deploy-rollback` (old `node_modules` and `.next`) is kept until the next deploy removes it.

## If the script itself cannot finish a rollback

It prints `ROLLED BACK (WITH PROBLEMS)` and the backup path. Everything needed is in `/root/backups/<timestamp>`:
`env.backup`, `Caddyfile`, `units/`, `state/`, `app.tgz`, `git-state.txt` (previous branch and commit), `deploy.log`.
Last resort: restore the provider snapshot.
