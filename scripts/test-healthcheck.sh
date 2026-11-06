#!/usr/bin/env bash
# Tests scripts/healthcheck.sh with stand-ins for curl and systemctl, so nothing
# real is probed or restarted:   bash scripts/test-healthcheck.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/state"

# curl stand-in: prints the HTTP code stored for core/web ("err" = connection error)
cat >"$T/bin/curl" <<'SH'
#!/usr/bin/env bash
url="${*: -1}"
case "$url" in
  *:8080*) f="$SHIM/core" ;;
  *) f="$SHIM/web" ;;
esac
v="$(cat "$f" 2>/dev/null || echo 200)"
[ "$v" = err ] && exit 7
printf '%s' "$v"
SH
# systemctl stand-in: records every call
cat >"$T/bin/systemctl" <<'SH'
#!/usr/bin/env bash
echo "$*" >>"$SHIM/calls"
SH
cat >"$T/bin/alert" <<'SH'
#!/usr/bin/env bash
echo "$1" >>"$SHIM/alerts"
SH
chmod +x "$T/bin/"*

export SHIM="$T" PATH="$T/bin:$PATH" SG16_HC_STATE_DIR="$T/state" SG16_HC_TIMEOUT=1
export SG16_HC_FAILS=3 SG16_HC_COOLDOWN=1000
HC="$ROOT/scripts/healthcheck.sh"

fail=0
pass=0
ok()   { pass=$((pass + 1)); echo "ok   - $1"; }
bad()  { fail=$((fail + 1)); echo "FAIL - $1"; }
expect_calls() { # <description> <expected restart calls, space separated unit names or empty>
  local got
  got="$(grep -c '^restart ' "$T/calls" 2>/dev/null || true)"
  [ "${got:-0}" = "$2" ] && ok "$1" || bad "$1 (expected $2 restarts, got ${got:-0})"
}
reset() { rm -rf "$T/state" "$T/calls" "$T/alerts"; mkdir -p "$T/state"; echo 200 >"$T/core"; echo 200 >"$T/web"; }
run() { bash "$HC" >"$T/out" 2>&1; }

reset; run; run
expect_calls "healthy services are never restarted" 0

reset; echo 503 >"$T/core"
run; run
expect_calls "two consecutive core failures: no restart yet" 0
run
expect_calls "third consecutive core failure restarts" 1
grep -q '^restart sg16-core' "$T/calls" && ok "the core unit is the one restarted" || bad "wrong unit restarted"
grep -q 'sg16-web' "$T/calls" && bad "web must not be touched" || ok "the healthy web unit is left alone"
[ "$(sed -n 1p "$T/calls")" = "reset-failed sg16-core" ] && ok "reset-failed runs before the restart" || bad "reset-failed should precede restart"

run; run; run
expect_calls "cool-down: no second restart while it is still cooling" 1
grep -q "cooling down" "$T/out" && ok "cool-down is logged" || bad "cool-down not logged"

reset; echo err >"$T/web"
run; run; run
expect_calls "connection errors count as failures (web)" 1
grep -q '^restart sg16-web' "$T/calls" && ok "the web unit is the one restarted" || bad "wrong unit"

reset
echo 500 >"$T/core"; run
echo 200 >"$T/core"; run
echo 500 >"$T/core"; run; run
expect_calls "failures must be consecutive: fail,ok,fail,fail does not restart" 0
grep -q recovered "$T/out" || ok "(no recovery line on a still-failing run)"

reset; echo 503 >"$T/web"; echo 503 >"$T/core"
run; run; run
expect_calls "both services failing are each restarted once" 2

reset; echo 503 >"$T/core"; export SG16_ALERT_CMD="$T/bin/alert"
run; run; run
grep -q "sg16-core" "$T/alerts" 2>/dev/null && ok "alert command receives a message naming the unit" || bad "alert not sent"
reset; echo 503 >"$T/core"; export SG16_ALERT_CMD="/nonexistent/alert"
run; run; run
expect_calls "a broken alert command does not stop the restart" 1
unset SG16_ALERT_CMD

reset; echo 503 >"$T/core"; SG16_HC_COOLDOWN=0 run; SG16_HC_COOLDOWN=0 run; SG16_HC_COOLDOWN=0 run
SG16_HC_COOLDOWN=0 run; SG16_HC_COOLDOWN=0 run; SG16_HC_COOLDOWN=0 run
expect_calls "after the cool-down it keeps trying: a second restart after 3 more failures" 2

grep -nE 'curl' "$HC" | grep -v -- '--max-time' | grep -vE '^\s*[0-9]+:\s*#|code=.*--max-time|command -v' >/dev/null \
  && bad "a curl call without --max-time" || ok "every curl call has --max-time"

echo
echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
