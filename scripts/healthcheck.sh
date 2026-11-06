#!/usr/bin/env bash
# ============================================================
# SG16 WATCHDOG — run once a minute by sg16-healthcheck.timer.
#
# Checks the core and the platform with curl (always with --max-time). After
# SG16_HC_FAILS consecutive failures of one service it restarts that service
# (and only that one), then leaves it alone for a cool-down so a slow start is
# not mistaken for a failure. Everything is logged to stdout, which systemd
# sends to the journal:   journalctl -u sg16-healthcheck
#
# No third-party service is contacted. For alerts, set SG16_ALERT_CMD to any
# command you choose (a script, `mail`, a webhook curl...); it is run with ONE
# argument - a short message - whenever a service had to be restarted.
#
# Environment (all optional):
#   SG16_CORE_URL        default http://127.0.0.1:8080/api/health
#   SG16_WEB_URL         default http://127.0.0.1:3000/api/live
#   SG16_CORE_UNIT       default sg16-core
#   SG16_WEB_UNIT        default sg16-web
#   SG16_HC_FAILS        consecutive failures before a restart (default 3)
#   SG16_HC_TIMEOUT      curl --max-time seconds (default 5)
#   SG16_HC_COOLDOWN     seconds to skip checks after a restart (default 90)
#   SG16_HC_STATE_DIR    where counters live (default /run/sg16-healthcheck)
#   SG16_ALERT_CMD       optional alert command (see above)
# ============================================================
set -uo pipefail

CORE_URL="${SG16_CORE_URL:-http://127.0.0.1:8080/api/health}"
WEB_URL="${SG16_WEB_URL:-http://127.0.0.1:3000/api/live}"
CORE_UNIT="${SG16_CORE_UNIT:-sg16-core}"
WEB_UNIT="${SG16_WEB_UNIT:-sg16-web}"
FAILS="${SG16_HC_FAILS:-3}"
TIMEOUT="${SG16_HC_TIMEOUT:-5}"
COOLDOWN="${SG16_HC_COOLDOWN:-90}"
STATE="${SG16_HC_STATE_DIR:-/run/sg16-healthcheck}"

mkdir -p "$STATE" || { echo "sg16-healthcheck: cannot create $STATE" >&2; exit 1; }

# one run at a time
if command -v flock >/dev/null 2>&1; then
  exec 9>"$STATE/lock"
  flock -n 9 || exit 0
fi

log() { echo "sg16-healthcheck: $*"; }

alert() {
  [ -n "${SG16_ALERT_CMD:-}" ] || return 0
  # the alert channel is the operator's own; a slow or broken one must not stall the watchdog
  timeout 15 "$SG16_ALERT_CMD" "$1" >/dev/null 2>&1 || log "alert command failed or timed out"
}

# check <name> <unit> <url>
check() {
  local name="$1" unit="$2" url="$3"
  local now fails_file="$STATE/$name.fails" cool_file="$STATE/$name.cool" n=0 code until

  now="$(date +%s)"
  if [ -f "$cool_file" ]; then
    until="$(cat "$cool_file" 2>/dev/null || echo 0)"
    if [ "$now" -lt "${until:-0}" ] 2>/dev/null; then
      log "$name: cooling down after restart ($((until - now))s left), skipping"
      return 0
    fi
  fi

  code="$(curl -s -o /dev/null --max-time "$TIMEOUT" -w '%{http_code}' "$url" 2>/dev/null || true)"
  [ -n "$code" ] || code=000

  if [ "$code" = 200 ]; then
    if [ -f "$fails_file" ] && [ "$(cat "$fails_file" 2>/dev/null || echo 0)" != 0 ]; then
      log "$name: recovered (was failing)"
    fi
    echo 0 >"$fails_file"
    return 0
  fi

  n="$(cat "$fails_file" 2>/dev/null || echo 0)"
  n=$((n + 1))
  echo "$n" >"$fails_file"
  log "$name: check failed ($n/$FAILS) http=$code url=$url"

  if [ "$n" -ge "$FAILS" ]; then
    log "$name: $FAILS consecutive failures - restarting $unit"
    # a unit that hit its start limit must be reset before systemd will start it again
    systemctl reset-failed "$unit" >/dev/null 2>&1 || true
    if systemctl restart "$unit"; then
      log "$name: restart of $unit issued"
    else
      log "$name: restart of $unit FAILED"
    fi
    echo 0 >"$fails_file"
    echo $((now + COOLDOWN)) >"$cool_file"
    alert "SG16: $unit was unhealthy ($FAILS failed checks, last http=$code) and has been restarted on $(hostname)"
  fi
}

check core "$CORE_UNIT" "$CORE_URL"
check web  "$WEB_UNIT"  "$WEB_URL"
exit 0
