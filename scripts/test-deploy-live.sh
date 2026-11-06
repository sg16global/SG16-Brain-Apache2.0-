#!/usr/bin/env bash
# Tests scripts/deploy-live.sh against a throwaway git repo and stand-in commands
# (systemctl, caddy, npm, npx, curl, openssl). Nothing real is touched:
#   bash scripts/test-deploy-live.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY="$ROOT/scripts/deploy-live.sh"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
REAL_GIT="$(command -v git)"
REAL_PY=""
for c in python3 python; do "$c" -c "import sys" >/dev/null 2>&1 && { REAL_PY="$(command -v "$c")"; break; }; done
MARKER=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef

mkdir -p "$T/bin"
APPD="$T/opt/sg16"; BK="$T/backups"; CADDY="$T/Caddyfile"; UNITS="$T/units"; REMOTE="$T/remote.git"

# ---- stand-ins -----------------------------------------------------------
cat >"$T/bin/git" <<SH
#!/usr/bin/env bash
echo "\$*" >>"$T/git.log"
exec "$REAL_GIT" "\$@"
SH
cat >"$T/bin/ollama" <<SH
#!/usr/bin/env bash
echo "ollama \$*" >>"$T/ollama.log"
case "\$1" in
  list) printf 'NAME ID SIZE MODIFIED\nsaiftechglobal/sg16-brain:previous aaa 14 GB now\nsaiftechglobal/sg16-brain:q4_k_m bbb 7 GB now\n' ;;
esac
exit 0
SH
cat >"$T/bin/python3" <<SH
#!/usr/bin/env bash
exec "$REAL_PY" "\$@"
SH
cat >"$T/bin/openssl" <<SH
#!/usr/bin/env bash
echo "openssl \$*" >>"$T/openssl.log"
echo $MARKER
SH
cat >"$T/bin/systemctl" <<SH
#!/usr/bin/env bash
echo "\$*" >>"$T/systemctl.log"
exit 0
SH
cat >"$T/bin/caddy" <<SH
#!/usr/bin/env bash
echo "caddy \$*" >>"$T/caddy.log"
if [ "\${CADDY_VALIDATE_RC:-0}" != 0 ]; then
  # a real caddy may echo the offending line, secret included
  grep -h 'X-SG16-Proxy-Auth' "\${3:-/dev/null}" 2>/dev/null | head -1
  echo "Error: adapting config using caddyfile: parse error" >&2
  exit 1
fi
exit 0
SH
cat >"$T/bin/npm" <<SH
#!/usr/bin/env bash
echo "npm \$*" >>"$T/npm.log"
case "\$1" in
  ci) [ "\${FAIL_NPM:-0}" = 1 ] && { echo "npm ERR! simulated"; exit 1; }; mkdir -p node_modules/pkg; echo new >node_modules/pkg/new.txt ;;
esac
exit 0
SH
cat >"$T/bin/npx" <<SH
#!/usr/bin/env bash
echo "npx \$* [NODE_OPTIONS=\${NODE_OPTIONS:-}]" >>"$T/npm.log"
touch "$T/building"
[ "\${HANG_BUILD:-0}" = 1 ] && sleep 60
[ "\${FAIL_BUILD:-0}" = 1 ] && { echo "build error (simulated)"; exit 1; }
mkdir -p .next; echo new >.next/new.txt
exit 0
SH
cat >"$T/bin/curl" <<SH
#!/usr/bin/env bash
echo "\$*" >>"$T/curl.log"
args=("\$@"); url="\${args[\${#args[@]}-1]}"
out=""; body=""
for ((i=0;i<\${#args[@]};i++)); do
  [ "\${args[i]}" = -o ] && out="\${args[i+1]}"
  [ "\${args[i]}" = -d ] && body="\${args[i+1]}"
done
case "\$url" in
  *cloudflare.com/ips-v4) printf '173.245.48.0/20\n103.21.244.0/22\n'; exit 0 ;;
  *cloudflare.com/ips-v6) printf '2400:cb00::/32\n'; exit 0 ;;
esac
branch="\$("$REAL_GIT" -C "$APPD" symbolic-ref --short HEAD 2>/dev/null)"
code=200
case "\$url" in
  *8080*/api/health) ;;
  *3000*/api/live)
    [ "\${FAIL_LIVE:-0}" = 1 ] && [ "\$branch" = fixes ] && code=500
    # the old version has no /api/live route at all
    [ "\$branch" = main ] && code=404 ;;
  *3000*/api/health) ;;
  *3000*/api/brain)
    if echo "\$body" | grep -q bomb; then json='{"assistantMessage":{"content":"refused"},"brain":"core-gate"}'
    else json='{"assistantMessage":{"content":"hello"},"brain":"ollama"}'; fi
    [ -n "\$out" ] && echo "\$json" >"\$out"
    ;;
esac
printf '%s' "\$code"
exit 0
SH
chmod +x "$T/bin/"*
export PATH="$T/bin:$PATH"
export SG16_DEPLOY_APP="$APPD" SG16_DEPLOY_BACKUP_ROOT="$BK" SG16_DEPLOY_CADDYFILE="$CADDY" SG16_DEPLOY_UNIT_DIR="$UNITS"
export SG16_DEPLOY_ALLOW_NONROOT=1 SG16_DEPLOY_MIN_KB=1 GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

# ---- fixtures ---------------------------------------------------------------
"$REAL_GIT" init -q --bare -b main "$REMOTE"
SEED="$T/seed"; "$REAL_GIT" clone -q "$REMOTE" "$SEED" 2>/dev/null
(
  cd "$SEED" || exit 1
  mkdir -p scripts pointoni config
  echo "v1" >app.txt; echo '{"dodo":"old"}' >config/brain.json
  printf '#!/bin/sh\n' >scripts/healthcheck.sh; echo '{}' >pointoni/package.json
  "$REAL_GIT" add -A; "$REAL_GIT" commit -qm base; "$REAL_GIT" push -q origin main
  "$REAL_GIT" checkout -qb fixes; echo "v2" >app.txt; echo "from fixes" >newfile.txt
  "$REAL_GIT" add -A; "$REAL_GIT" commit -qm fixes; "$REAL_GIT" push -q origin fixes
)
FIXES_SHA="$("$REAL_GIT" -C "$REMOTE" rev-parse fixes)"

fixture() {
  rm -rf "$APPD" "$BK" "$UNITS" "$CADDY" "$T/"*.log "$T/building"
  mkdir -p "$(dirname "$APPD")" "$UNITS"
  # like the live server's clone: shallow and single-branch, so origin/fixes does not exist until fetched by name
  if ! "$REAL_GIT" clone -q --depth 1 --single-branch --branch main "file://$REMOTE" "$APPD" 2>/dev/null; then
    "$REAL_GIT" clone -q --single-branch --branch main "$REMOTE" "$APPD" 2>/dev/null
  fi
  echo '{"dodo":"edited-on-server"}' >"$APPD/config/brain.json"        # uncommitted tracked edit
  printf 'SG16_IDENTITY_SECRET=orig-identity-secret-0123456789abcdef0123456789\nSG16_OLLAMA_URL=http://127.0.0.1:11434' >"$APPD/.env"  # no trailing newline
  chmod 600 "$APPD/.env"
  mkdir -p "$APPD/.venv/bin" "$APPD/state" "$APPD/pointoni/node_modules" "$APPD/pointoni/.next"
  echo py >"$APPD/.venv/bin/python"; echo '{"passes":{"tok":1}}' >"$APPD/state/billing_state.json"
  echo jpg >"$APPD/stage-bg.jpg"; echo old >"$APPD/pointoni/node_modules/old.txt"; echo old >"$APPD/pointoni/.next/old.txt"
  printf 'example.com {\n    encode zstd gzip\n    reverse_proxy 127.0.0.1:3000\n}\n' >"$CADDY"
  printf '[Service]\nExecStart=/opt/py/bin/python %s/scripts/serve.py 0.0.0.0 8080\nEnvironment=SG16_TRANSPORT=online\nEnvironment=SG16_CUSTOM_CORE=keepme\n' "$APPD" >"$UNITS/sg16-core.service"
  printf '[Service]\nExecStart=/usr/bin/npx next start -p 3000 -H 0.0.0.0\nEnvironmentFile=-%s/.env\nEnvironment=SG16_CUSTOM_WEB=keepme\n' "$APPD" >"$UNITS/sg16-web.service"
  : >"$T/git.log"; : >"$T/systemctl.log"
  H_ENV="$(md5sum <"$APPD/.env")"; H_STATE="$(md5sum <"$APPD/state/billing_state.json")"
  H_CADDY="$(md5sum <"$CADDY")"; H_CORE="$(md5sum <"$UNITS/sg16-core.service")"; H_WEB="$(md5sum <"$UNITS/sg16-web.service")"
}

pass=0; fail=0
# Windows filesystems do not keep POSIX modes; the mode checks only mean something on Linux
touch "$T/modeprobe"; chmod 600 "$T/modeprobe"
if [ "$(stat -c %a "$T/modeprobe")" = 600 ]; then POSIX_MODES=1; else POSIX_MODES=0; echo "note: filesystem has no POSIX modes - mode checks are skipped here (they run on Linux)"; fi
ok()  { pass=$((pass + 1)); echo "ok   - $1"; }
bad() { fail=$((fail + 1)); echo "FAIL - $1"; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; [ -n "${SHOW_OUT:-}" ] && sed "s/^/      out: /" "$T/out" | tail -25; fi; }
run_deploy() { bash "$DEPLOY" "$@" >"$T/out" 2>&1; RC=$?; }
branch() { "$REAL_GIT" -C "$APPD" symbolic-ref --short HEAD 2>/dev/null; }

forbidden_git() { grep -Eq '(^| )reset( |$)|(^| )clean( |$)|checkout (-f|--force)|stash .*(-u|--include-untracked|-a|--all)' "$T/git.log"; }
secret_in_output() { grep -q "$MARKER" "$T/out"; }

# 1 ---------------------------------------------------------------------------
fixture
run_deploy
check "refuses to run without --snapshot-done" '[ $RC = 2 ] && grep -q "snapshot-done" "$T/out"'
check "nothing changed when refused" '[ "$(branch)" = main ] && [ ! -d "$BK" ]'

# 2 dry run -----------------------------------------------------------------------
fixture
run_deploy --snapshot-done --dry-run
check "dry run succeeds and says it is a dry run" '[ $RC = 0 ] && grep -q "DRY RUN" "$T/out" && grep -q "\[dry-run\] would" "$T/out"'
check "dry run lists the server edit it would stash" 'grep -q "config/brain.json" "$T/out"'
check "dry run changed nothing in git" '[ "$(branch)" = main ] && grep -q edited-on-server "$APPD/config/brain.json" && [ -z "$("$REAL_GIT" -C "$APPD" stash list)" ]'
check "dry run created no backup" '[ ! -d "$BK" ]'
check "dry run left .env / Caddyfile / units / state byte-identical" '[ "$(md5sum <"$APPD/.env")" = "$H_ENV" ] && [ "$(md5sum <"$CADDY")" = "$H_CADDY" ] && [ "$(md5sum <"$UNITS/sg16-core.service")" = "$H_CORE" ] && [ "$(md5sum <"$APPD/state/billing_state.json")" = "$H_STATE" ]'
check "dry run ran no restart, reload, daemon-reload or build" '! grep -Eq "restart|reload|daemon-reload|enable" "$T/systemctl.log" && [ ! -f "$T/npm.log" ]'
check "dry run did not fetch, stash, checkout or pull" '! grep -Eq "^(-c [^ ]+ )?(-C [^ ]+ )?(fetch|stash|checkout|pull)" "$T/git.log" && ! grep -Eq " (fetch|stash push|checkout|pull) " "$T/git.log"'
check "dry run printed no secret" '! secret_in_output'
check "dry run validated the candidate Caddyfile without installing it" 'grep -q "caddy validate" "$T/caddy.log" && [ "$(md5sum <"$CADDY")" = "$H_CADDY" ]'

# 3 successful deploy ----------------------------------------------------------------
fixture
run_deploy --snapshot-done
check "deploy succeeds" '[ $RC = 0 ] && grep -q "DEPLOY OK" "$T/out"'
check "now on fixes at the remote commit" '[ "$(branch)" = fixes ] && [ "$("$REAL_GIT" -C "$APPD" rev-parse HEAD)" = "$FIXES_SHA" ]'
check "server edit was stashed, not discarded" '[ "$("$REAL_GIT" -C "$APPD" stash list | wc -l)" = 1 ] && "$REAL_GIT" -C "$APPD" stash show -p | grep -q edited-on-server'
check "untracked .venv, state/, stage-bg.jpg untouched" '[ "$(md5sum <"$APPD/state/billing_state.json")" = "$H_STATE" ] && [ -f "$APPD/stage-bg.jpg" ] && [ -f "$APPD/.venv/bin/python" ]'
check ".env keeps its original lines and gains the secrets and defaults" 'grep -q "^SG16_IDENTITY_SECRET=orig-identity-secret-0123456789abcdef0123456789$" "$APPD/.env" && grep -q "^SG16_OLLAMA_URL=http://127.0.0.1:11434$" "$APPD/.env" && grep -Eq "^SG16_PROXY_AUTH_SECRET=.{32,}" "$APPD/.env" && grep -Eq "^SG16_BILLING_SECRET=.{32,}" "$APPD/.env" && grep -q "^SG16_ANSWER_QUEUE_WAIT_MS=30000$" "$APPD/.env" && grep -q "^SG16_OLLAMA_TIMEOUT_MS=60000$" "$APPD/.env"'
[ $POSIX_MODES = 1 ] && check ".env stays mode 600" '[ "$(stat -c %a "$APPD/.env")" = 600 ]'
check "no secret value was printed" '! secret_in_output'
PROXY="$(grep '^SG16_PROXY_AUTH_SECRET=' "$APPD/.env" | cut -d= -f2-)"
check "Caddyfile header carries the SAME proxy secret as .env" 'grep -qF "header_up X-SG16-Proxy-Auth $PROXY" "$CADDY" && grep -q "header_up CF-Connecting-IP {client_ip}" "$CADDY"'
check "Caddyfile got the Cloudflare trusted ranges" 'grep -q "trusted_proxies static 173.245.48.0/20" "$CADDY"'
check "Caddy was validated before the file was replaced, then reloaded" 'grep -q "caddy validate" "$T/caddy.log" && grep -q "reload caddy" "$T/systemctl.log"'
BKD="$(ls -d "$BK"/*/ | head -1)"; BKD="${BKD%/}"
check "backup dir exists" '[ -d "$BKD" ]'
[ $POSIX_MODES = 1 ] && check "backup dirs have mode 700" '[ "$(stat -c %a "$BKD")" = 700 ] && [ "$(stat -c %a "$BK")" = 700 ] && [ "$(stat -c %a "$BKD/app.tgz")" = 600 ]'
check "backup holds tar, .env, state/, Caddyfile and units" '[ -s "$BKD/app.tgz" ] && [ -f "$BKD/env.backup" ] && [ -f "$BKD/state/billing_state.json" ] && [ -f "$BKD/Caddyfile" ] && [ -f "$BKD/units/sg16-core.service" ]'
check "the backed-up .env is the pre-deploy one" '[ "$(md5sum <"$BKD/env.backup")" = "$H_ENV" ]'
check "the tar excludes node_modules and .venv" '! tar tzf "$BKD/app.tgz" | grep -Eq "node_modules|\.venv"'
check "old build kept aside for rollback" '[ -f "$APPD/.deploy-rollback/node_modules/old.txt" ] && [ -f "$APPD/.deploy-rollback/.next/old.txt" ] && [ -f "$APPD/pointoni/node_modules/pkg/new.txt" ] && [ ! -e "$APPD/pointoni/node_modules.rollback" ] && [ ! -e "$APPD/pointoni/.next.rollback" ]'
check "next build gets a raised heap limit" 'grep -q "npx next build \[NODE_OPTIONS=--max-old-space-size=[0-9]" "$T/npm.log"'
check "npm ci --include=dev and next build ran" 'grep -q "npm ci --include=dev" "$T/npm.log" && grep -q "npx next build" "$T/npm.log"'
check "units: operator-added Environment lines and bind address are kept" 'grep -q "SG16_CUSTOM_CORE=keepme" "$UNITS/sg16-core.service" && grep -q "serve.py 0.0.0.0 8080" "$UNITS/sg16-core.service" && grep -q "SG16_CUSTOM_WEB=keepme" "$UNITS/sg16-web.service" && grep -q -- "-H 0.0.0.0" "$UNITS/sg16-web.service" && grep -q "Restart=always" "$UNITS/sg16-core.service" && [ -f "$UNITS/sg16-healthcheck.timer" ]'
check "core restarted before web, timer enabled last" 'c=$(grep -n "^restart sg16-core" "$T/systemctl.log" | head -1 | cut -d: -f1); w=$(grep -n "^restart sg16-web" "$T/systemctl.log" | head -1 | cut -d: -f1); t=$(grep -n "enable --now sg16-healthcheck.timer" "$T/systemctl.log" | cut -d: -f1); [ -n "$c" ] && [ "$c" -lt "$w" ] && [ "$w" -lt "$t" ]'
check "the chat checks send the server's secret as proxy AND probe headers (the probe one shows the exact engine), and never print it" 'grep -q "X-SG16-Proxy-Auth: $MARKER" "$T/curl.log" && grep -q "X-SG16-Probe-Auth: $MARKER" "$T/curl.log" && ! secret_in_output'
check "clean and blocked chats were exercised" 'grep -q "clean chat: http=200 engine=ollama" "$T/out" && grep -q "blocked chat: http=200 engine=core-gate" "$T/out"'
check "no reset --hard / clean / forced checkout / stash -u was ever run" '! forbidden_git'

# 4 verification failure -> automatic rollback ------------------------------------------
fixture
FAIL_LIVE=1 run_deploy --snapshot-done
check "failed verification ends with ROLLED BACK and a non-zero exit" '[ $RC = 1 ] && grep -qx "ROLLED BACK" "$T/out"'
check "rollback: back on main with the server edit restored (stash popped)" '[ "$(branch)" = main ] && grep -q edited-on-server "$APPD/config/brain.json" && [ -z "$("$REAL_GIT" -C "$APPD" stash list)" ]'
check "rollback: .env, Caddyfile and units are byte-identical to before" '[ "$(md5sum <"$APPD/.env")" = "$H_ENV" ] && [ "$(md5sum <"$CADDY")" = "$H_CADDY" ] && [ "$(md5sum <"$UNITS/sg16-core.service")" = "$H_CORE" ] && [ "$(md5sum <"$UNITS/sg16-web.service")" = "$H_WEB" ] && [ ! -f "$UNITS/sg16-healthcheck.timer" ]'
check "rollback: previous node_modules and build are back" '[ -f "$APPD/pointoni/node_modules/old.txt" ] && [ ! -e "$APPD/pointoni/node_modules/pkg" ] && [ -f "$APPD/pointoni/.next/old.txt" ] && [ ! -e "$APPD/pointoni/.next/new.txt" ]'
check "rollback: state/ and untracked files untouched" '[ "$(md5sum <"$APPD/state/billing_state.json")" = "$H_STATE" ] && [ -f "$APPD/stage-bg.jpg" ]'
check "rollback: services restarted again, watchdog timer never enabled" '[ "$(grep -c "^restart sg16-core" "$T/systemctl.log")" -ge 2 ] && ! grep -q "enable --now sg16-healthcheck.timer" "$T/systemctl.log"'
check "rollback verifies the OLD version on /api/health (it has no /api/live) and reports a clean ROLLED BACK" 'grep -qx "ROLLED BACK" "$T/out" && ! grep -q "WITH PROBLEMS" "$T/out" && grep -q "platform (after rollback) is up" "$T/out"'
check "rollback printed no secret and ran no forbidden git" '! secret_in_output && ! forbidden_git'

# 5 build failure -> rollback --------------------------------------------------------------
fixture
FAIL_BUILD=1 run_deploy --snapshot-done
check "build failure rolls back" '[ $RC = 1 ] && grep -qx "ROLLED BACK" "$T/out" && [ "$(branch)" = main ] && [ "$(md5sum <"$APPD/.env")" = "$H_ENV" ] && [ -f "$APPD/pointoni/node_modules/old.txt" ]'
fixture
FAIL_NPM=1 run_deploy --snapshot-done
check "npm ci failure rolls back" '[ $RC = 1 ] && grep -qx "ROLLED BACK" "$T/out" && [ "$(branch)" = main ] && [ "$(md5sum <"$CADDY")" = "$H_CADDY" ]'

# 6 a new branch that would overwrite an untracked file -> stop + rollback, file untouched ---
fixture
echo "precious local file" >"$APPD/newfile.txt"
run_deploy --snapshot-done
check "untracked file that the branch would overwrite: rolled back, file intact" '[ $RC = 1 ] && grep -qx "ROLLED BACK" "$T/out" && [ "$(cat "$APPD/newfile.txt")" = "precious local file" ] && [ "$(branch)" = main ] && grep -q edited-on-server "$APPD/config/brain.json"'

# 7 Caddy validation fails -> Caddyfile untouched, deploy still succeeds ------------------------
fixture
CADDY_VALIDATE_RC=1 run_deploy --snapshot-done
check "failed caddy validate leaves the Caddyfile alone but the deploy completes" '[ $RC = 0 ] && grep -q "DEPLOY OK" "$T/out" && [ "$(md5sum <"$CADDY")" = "$H_CADDY" ] && grep -q "failed .caddy validate" "$T/out"'
check "a secret echoed by a failing caddy is redacted from the output" '! secret_in_output && ! grep -qF "$(grep "^SG16_PROXY_AUTH_SECRET=" "$APPD/.env" | cut -d= -f2-)" "$T/out"'

# 8 secrets and defaults already present: nothing generated or appended -------------------------
fixture
printf '\nSG16_PROXY_AUTH_SECRET=%s\nSG16_BILLING_SECRET=%s\nSG16_PROJECT_KEY_SECRET=%s\nSG16_ANSWER_QUEUE_WAIT_MS=5000\nSG16_OLLAMA_TIMEOUT_MS=45000\n' "$(printf 'p%.0s' $(seq 40))" "$(printf 'b%.0s' $(seq 40))" "$(printf 'k%.0s' $(seq 40))" >>"$APPD/.env"
H2="$(md5sum <"$APPD/.env")"
run_deploy --snapshot-done
check "existing secrets and settings are left alone (no openssl call, .env unchanged)" '[ $RC = 0 ] && [ ! -s "$T/openssl.log" ] && [ "$(md5sum <"$APPD/.env")" = "$H2" ]'

# 8b operator email: taken from this run's environment, only if .env has none ------------------------------
fixture
SG16_DEPLOY_ADMIN_EMAILS=op@example.com run_deploy --snapshot-done
check "SG16_ADMIN_EMAILS is added from SG16_DEPLOY_ADMIN_EMAILS when .env has none" '[ $RC = 0 ] && grep -q "^SG16_ADMIN_EMAILS=op@example.com$" "$APPD/.env"'
fixture
run_deploy --snapshot-done
check "without it the deploy warns that nobody can open the admin console, and still succeeds" '[ $RC = 0 ] && grep -q "nobody can open the admin console" "$T/out" && ! grep -q "^SG16_ADMIN_EMAILS=" "$APPD/.env"'
fixture
printf '
SG16_ADMIN_EMAILS=kept@example.com
' >>"$APPD/.env"
SG16_DEPLOY_ADMIN_EMAILS=other@example.com run_deploy --snapshot-done
check "an existing SG16_ADMIN_EMAILS is never overwritten" '[ $RC = 0 ] && grep -q "^SG16_ADMIN_EMAILS=kept@example.com$" "$APPD/.env" && ! grep -q "other@example.com" "$APPD/.env"'

# 8b2 operator password hash: validated, written to .env, never printed ---------------------------------------
GOODHASH='scrypt:32768:8:1:c2FsdHNhbHRzYWx0:aGFzaGhhc2hoYXNoaGFzaA'
fixture
SG16_DEPLOY_ADMIN_PASSWORD_HASH="$GOODHASH" run_deploy --snapshot-done
check "the admin password hash is added to .env from the deploy environment, and never printed" '[ $RC = 0 ] && grep -q "^SG16_ADMIN_PASSWORD_HASH=$GOODHASH$" "$APPD/.env" && ! grep -q "c2FsdHNhbHRzYWx0" "$T/out"'
fixture
SG16_DEPLOY_ADMIN_PASSWORD_HASH='not a hash; rm -rf /' run_deploy --snapshot-done
check "a malformed hash stops the deploy and rolls back, .env untouched" '[ $RC = 1 ] && grep -qx "ROLLED BACK" "$T/out" && [ "$(md5sum <"$APPD/.env")" = "$H_ENV" ]'
fixture
printf '\nSG16_ADMIN_PASSWORD_HASH=scrypt:1:1:1:keep:keep\n' >>"$APPD/.env"
SG16_DEPLOY_ADMIN_PASSWORD_HASH="$GOODHASH" run_deploy --snapshot-done
check "an existing admin password hash is never overwritten" '[ $RC = 0 ] && grep -q "^SG16_ADMIN_PASSWORD_HASH=scrypt:1:1:1:keep:keep$" "$APPD/.env" && ! grep -q "c2FsdHNhbHRzYWx0" "$APPD/.env"'

# 8b3 switching the answering model ----------------------------------------------------------------------
Q8=saiftechglobal/sg16-brain:q4_k_m
fixture
: >"$T/ollama.log"
printf '\nSG16_OLLAMA_MODEL=saiftechglobal/sg16-brain:previous\nSG16_ANSWER_QUEUE_WAIT_MS=30000\n' >>"$APPD/.env"
SG16_DEPLOY_OLLAMA_MODEL="$Q8" run_deploy --snapshot-done
check "the model is switched in .env (one line, others untouched) and the old model is unloaded after a good deploy" '[ $RC = 0 ] && [ "$(grep -c "^SG16_OLLAMA_MODEL=" "$APPD/.env")" = 1 ] && grep -q "^SG16_OLLAMA_MODEL=$Q8$" "$APPD/.env" && grep -q "^SG16_ANSWER_QUEUE_WAIT_MS=30000$" "$APPD/.env" && grep -q "ollama stop saiftechglobal/sg16-brain:previous" "$T/ollama.log"'
fixture
: >"$T/ollama.log"
SG16_DEPLOY_OLLAMA_MODEL="$Q8" run_deploy --snapshot-done
check "with no model line yet, one is added" '[ $RC = 0 ] && grep -q "^SG16_OLLAMA_MODEL=$Q8$" "$APPD/.env"'
fixture
: >"$T/ollama.log"
SG16_DEPLOY_OLLAMA_MODEL="saiftechglobal/sg16-brain:not-pulled" run_deploy --snapshot-done
check "a model that is not pulled is refused before anything changes (rolled back, .env untouched, nothing unloaded)" '[ $RC = 1 ] && grep -q "not pulled yet" "$T/out" && [ "$(md5sum <"$APPD/.env")" = "$H_ENV" ] && ! grep -q "ollama stop" "$T/ollama.log"'
fixture
: >"$T/ollama.log"
FAIL_LIVE=1 SG16_DEPLOY_OLLAMA_MODEL="$Q8" run_deploy --snapshot-done
check "if the deploy fails after switching, the old model setting comes back and nothing is unloaded" '[ $RC = 1 ] && [ "$(md5sum <"$APPD/.env")" = "$H_ENV" ] && ! grep -q "ollama stop" "$T/ollama.log"'

# 8c the other secrets: generated when missing, never printed; a too-short identity secret fails safely --------
fixture
run_deploy --snapshot-done
check "project-key and identity secrets are generated when missing (values hidden)" '[ $RC = 0 ] && grep -Eq "^SG16_PROJECT_KEY_SECRET=.{32,}" "$APPD/.env" && grep -Eq "^SG16_IDENTITY_SECRET=.{32,}" "$APPD/.env" && ! secret_in_output'
check "the deploy tells the operator how to set the admin password when it is missing" 'grep -q "scripts/admin-password.mjs" "$T/out"'
fixture
printf '
SG16_IDENTITY_SECRET=too-short
' >>"$APPD/.env"
run_deploy --snapshot-done
check "a too-short identity secret fails before restart and rolls back" '[ $RC = 1 ] && grep -qx "ROLLED BACK" "$T/out" && [ "$(branch)" = main ]'
fixture
printf '
SG16_ADMIN_PASSWORD_HASH=scrypt:1:2:3:a:b
' >>"$APPD/.env"
run_deploy --snapshot-done
check "no warning about the admin password when it is set" '[ $RC = 0 ] && ! grep -q "scripts/admin-password.mjs" "$T/out"'

# 9 a billing secret too short for the core to accept is caught before restart -------------------------
fixture
printf '\nSG16_BILLING_SECRET=short\n' >>"$APPD/.env"
run_deploy --snapshot-done
check "short SG16_BILLING_SECRET fails safely and rolls back" '[ $RC = 1 ] && grep -qx "ROLLED BACK" "$T/out" && [ "$(md5sum <"$APPD/.env")" != "" ] && [ "$(branch)" = main ]'

# 10 SIGTERM during the build -> rollback ------------------------------------------------------------------
fixture
rm -f "$T/building"
HANG_BUILD=1 bash "$DEPLOY" --snapshot-done >"$T/out" 2>&1 &
DPID=$!
for _ in $(seq 1 60); do [ -f "$T/building" ] && break; sleep 0.5; done
kill -TERM "$DPID" 2>/dev/null
# a real Ctrl+C reaches the whole foreground group; here the stand-in build's sleep must be ended by hand
for p in $(ps | awk '/[s]leep/ {print $1}'); do kill "$p" 2>/dev/null; done
wait "$DPID" 2>/dev/null
check "an interrupt mid-deploy rolls back too" 'grep -qx "ROLLED BACK" "$T/out" && [ "$(branch)" = main ] && [ "$(md5sum <"$APPD/.env")" = "$H_ENV" ] && [ -f "$APPD/pointoni/node_modules/old.txt" ]'

# 11 the script's own text -----------------------------------------------------------------------------
check "script never invokes git reset or git clean (comments excluded)" '! grep -vE "^[[:space:]]*#" "$DEPLOY" | grep -Eq "(git|G)( -c [^ ]+)?( -C [^ ]+)? (reset|clean)( |$)"'
check "script never touches Dodo settings (comments excluded)" '! grep -vE "^[[:space:]]*#" "$DEPLOY" | grep -qiE "dodo|brain\.json"'
check "script never greps secrets to the screen (no set -x, no echo of secret vars)" '! grep -Eq "set -x|echo .*\\\$(v|secret|PROXY_SECRET)\b" "$DEPLOY"'

echo
echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
