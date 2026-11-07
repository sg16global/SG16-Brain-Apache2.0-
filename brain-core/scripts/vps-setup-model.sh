#!/usr/bin/env bash
# =============================================================================
# SG16 BRAIN — brain server setup (run ON the brain server, 16 GB+ RAM, as root).
#
# ONE brain, nothing else: SG16 Brain Q4_K_M, exactly as published on Ollama
#   https://ollama.com/saiftechglobal/sg16-brain:Q4_K_M
#   7.5 GB · 12.2B parameters · Q4_K_M · manifest f4b21a5d4668
# The published package carries its own weights, chat template, stop tokens,
# system prompt and license; nothing is rebuilt or re-templated here.
#
# Two ways to run the tunnel:
#
#   A. Dashboard tunnel (token) — the tunnel was created in Cloudflare Zero
#      Trust -> Networks -> Tunnels, which gave an install token:
#        read -rs TUNNEL_TOKEN && export TUNNEL_TOKEN     # paste the token, Enter
#        DOMAIN_INTERNAL=internal.your-domain.com bash scripts/vps-setup-model.sh
#      Its public hostname is set in the dashboard, pointing at
#      http://localhost:$MODEL_PORT with HTTP Host Header "localhost:$MODEL_PORT".
#
#   B. Tunnel created here — after 'cloudflared login':
#        DOMAIN_INTERNAL=internal.your-domain.com bash scripts/vps-setup-model.sh
#
# What this script does:
#   1. installs/upgrades Ollama and binds it to 127.0.0.1 ONLY (never a public port)
#   2. pulls saiftechglobal/sg16-brain:Q4_K_M and checks its manifest id
#   3. removes every other model from this box (one brain only)
#   4. installs cloudflared and runs the tunnel (A: from the token; B: creates
#      $DOMAIN_INTERNAL -> http://127.0.0.1:$MODEL_PORT)
#   5. proves local inference and the tunnel, then prints the Cloudflare
#      Access + Worker secret steps you must run
#
# The token is never written to this repository; cloudflared keeps it in its
# own service unit on this server.
#
# Context cap is enforced twice: OLLAMA_CONTEXT_LENGTH=8192 here, and
# options.num_ctx=8192 in every Worker request.
# KEEP_ALIVE stays a finite default (30m) — NEVER -1 (never pin models forever).
# =============================================================================
set -euo pipefail

MODEL_PORT="${MODEL_PORT:-8081}"
# One level under the domain only (e.g. internal.your-domain.com): the free
# Cloudflare certificate covers *.your-domain.com, not a.b.your-domain.com.
# If the tunnel is later managed from the dashboard, its remote config
# overrides the local config.yml written below.
DOMAIN_INTERNAL="${DOMAIN_INTERNAL:-}"
TUNNEL_NAME="${TUNNEL_NAME:-sg16-model}"
# A dashboard tunnel's install token (way A). Empty = way B (cloudflared login).
TUNNEL_TOKEN="${TUNNEL_TOKEN:-}"
CTX="${CTX:-8192}"
# The one brain. Keep in sync with wrangler.jsonc MODEL_NAME.
MODEL_NAME="${MODEL_NAME:-saiftechglobal/sg16-brain:Q4_K_M}"
# The published Q4_K_M build (first 12 hex digits of its manifest digest, as
# shown on ollama.com and by `ollama list`). If the owner publishes a new
# Q4_K_M build, update this value after checking the new build.
MODEL_ID="${MODEL_ID:-f4b21a5d4668}"
# 1 = keep any other models already on the box (default: remove them)
KEEP_OTHER_MODELS="${KEEP_OTHER_MODELS:-0}"

say()  { echo "[vps-setup] $*"; }
die()  { echo "[vps-setup] ERROR: $*" >&2; exit 1; }
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

[ "$(id -u)" = 0 ] || die "run as root"
[ -n "$DOMAIN_INTERNAL" ] || die "set DOMAIN_INTERNAL to the tunnel hostname on your domain, e.g. DOMAIN_INTERNAL=internal.your-domain.com"
case "$DOMAIN_INTERNAL" in
  *://*|*/*) die "DOMAIN_INTERNAL is a hostname only (internal.your-domain.com), without https:// or a path" ;;
esac
# a "16 GB" server reports a little under 16000 MiB; the brain needs ~9 GB (weights + 8K KV cache)
free -m | awk 'NR==2{ if ($2 < 15000) exit 1 }' || die "this box needs a 16 GB server for the 12B Q4_K_M brain + its 8K KV cache"
# the pull needs ~7.5 GB of disk for the weights, plus headroom
df -Pm / | awk 'NR==2{ if ($4 < 10240) exit 1 }' || die "need at least 10 GB free disk for the 7.5 GB brain"

# Preflight: cloudflared must be installed and authenticated BEFORE the brain
# is pulled and before other models are removed — fail fast, not half-swapped.
command -v cloudflared >/dev/null 2>&1 || {
  arch="$(dpkg --print-architecture)"
  curl -fL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}.deb" -o /tmp/cloudflared.deb
  dpkg -i /tmp/cloudflared.deb
}
if [ -n "$TUNNEL_TOKEN" ]; then
  # way A: the token is base64 JSON {"a": account, "t": tunnel id, "s": secret}
  tok="$TUNNEL_TOKEN"; while [ $(( ${#tok} % 4 )) -ne 0 ]; do tok="$tok="; done
  TUNNEL_ID="$(printf '%s' "$tok" | base64 -d 2>/dev/null | grep -o '"t":"[0-9a-f-]*"' | cut -d'"' -f4 || true)"
  [ -n "$TUNNEL_ID" ] || die "TUNNEL_TOKEN is not a Cloudflare tunnel token (copy the long eyJ... value from the dashboard's install command). Nothing installed yet, no model touched."
  say "dashboard tunnel token for tunnel $TUNNEL_ID"
else
  mkdir -p "$HOME/.cloudflared"   # 'cloudflared login' writes its cert.pem here
  cloudflared tunnel list >/dev/null 2>&1 \
    || die "cloudflared is not authenticated. Either set TUNNEL_TOKEN (dashboard tunnel) or run 'cloudflared login' once (it prints a URL — open it in your browser and pick your domain's zone), then re-run this script. Nothing installed yet, no model touched."
fi

if ss -ltn "sport = :$MODEL_PORT" | grep -q LISTEN; then
  ss -ltnp "sport = :$MODEL_PORT" 2>/dev/null | grep -q 'ollama' \
    && say "re-run: the model server already listens on $MODEL_PORT" \
    || die "port $MODEL_PORT already in use — pick another MODEL_PORT"
fi

# ---- 1. the model server -----------------------------------------------------
# always (re)run the installer: it upgrades in place
curl -fsSL https://ollama.com/install.sh | sh
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/10-sg16.conf <<UNIT
[Service]
Environment="OLLAMA_HOST=127.0.0.1:$MODEL_PORT"
Environment="OLLAMA_CONTEXT_LENGTH=$CTX"
Environment="OLLAMA_KEEP_ALIVE=30m"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
UNIT
export OLLAMA_HOST="127.0.0.1:$MODEL_PORT"   # the CLI (pull/show/rm) must reach the daemon
systemctl daemon-reload && systemctl enable ollama && systemctl restart ollama
for _ in $(seq 1 30); do ollama list >/dev/null 2>&1 && break; sleep 1; done
ollama list >/dev/null 2>&1 || die "ollama did not start on 127.0.0.1:$MODEL_PORT"

# ---- 2. the one brain --------------------------------------------------------
say "pulling the brain: $MODEL_NAME (Q4_K_M, ~7.5 GB)"
ollama pull "$MODEL_NAME"
ollama show "$MODEL_NAME" >/dev/null || die "the brain did not install"
got_id="$(ollama list | awk -v n="$(lower "$MODEL_NAME")" 'NR>1 && tolower($1)==n { print $2; exit }')"
[ "$(lower "$got_id")" = "$(lower "$MODEL_ID")" ] \
  || die "installed $MODEL_NAME has id '$got_id', expected '$MODEL_ID' (the published Q4_K_M build). If the owner published a new build, re-run with MODEL_ID=<new id>."
say "brain installed: $MODEL_NAME, id $got_id"

# ---- 3. one brain only: remove every other model -----------------------------
if [ "$KEEP_OTHER_MODELS" != "1" ]; then
  ollama list | awk 'NR>1 { print $1 }' | while read -r other; do
    [ -n "$other" ] || continue
    [ "$(lower "$other")" = "$(lower "$MODEL_NAME")" ] && continue
    say "removing another model: $other"
    ollama rm "$other"
  done
fi
say "models now on this box:"; ollama list
say "model server: ollama on 127.0.0.1:$MODEL_PORT, ctx $CTX, one brain, /api/chat"

# ---- 4. cloudflare tunnel (cloudflared installed + authed in the preflight) --
if [ -n "$TUNNEL_TOKEN" ]; then
  # way A: the dashboard holds the routing; cloudflared only needs the token.
  # A re-run replaces the existing service so the newest token wins.
  if [ -f /etc/systemd/system/cloudflared.service ]; then
    say "replacing the existing cloudflared service"
    systemctl stop cloudflared 2>/dev/null || true
    cloudflared service uninstall 2>/dev/null || true
    rm -f /etc/systemd/system/cloudflared.service
    systemctl daemon-reload
  fi
  cloudflared service install "$TUNNEL_TOKEN" >/dev/null || die "cloudflared service install failed"
  chmod 600 /etc/systemd/system/cloudflared.service 2>/dev/null || true   # it holds the token
  systemctl daemon-reload
  systemctl enable cloudflared >/dev/null 2>&1 || true
  systemctl restart cloudflared
  say "waiting for the tunnel to connect to Cloudflare..."
  for _ in $(seq 1 30); do
    journalctl -u cloudflared --since "-2min" --no-pager 2>/dev/null | grep -q "Registered tunnel connection" && break
    sleep 2
  done
  journalctl -u cloudflared --since "-2min" --no-pager 2>/dev/null | grep -q "Registered tunnel connection" \
    || die "the tunnel did not connect. Check: systemctl status cloudflared ; journalctl -u cloudflared -n 50"
  say "tunnel $TUNNEL_ID connected (dashboard status: HEALTHY)"
else
cloudflared tunnel list 2>/dev/null | grep -q "$TUNNEL_NAME" || cloudflared tunnel create "$TUNNEL_NAME"

TUNNEL_ID="$(cloudflared tunnel list | awk -v n="$TUNNEL_NAME" '$2 == n { print $1; exit }')"
[ -n "$TUNNEL_ID" ] || die "could not read tunnel id"
cloudflared tunnel route dns "$TUNNEL_NAME" "$DOMAIN_INTERNAL" 2>/dev/null || true

mkdir -p /etc/cloudflared
# 'cloudflared tunnel create' writes the credentials JSON to ~/.cloudflared;
# the service config below reads it from /etc/cloudflared — copy it into place.
# A tunnel created elsewhere (e.g. the dashboard) has no local JSON: fetch it.
# Never delete the tunnel to get one — its DNS routes point at it.
if [ ! -f "$HOME/.cloudflared/$TUNNEL_ID.json" ]; then
  say "no local credentials for tunnel '$TUNNEL_NAME' — fetching them"
  cloudflared tunnel token --cred-file "$HOME/.cloudflared/$TUNNEL_ID.json" "$TUNNEL_NAME" \
    || die "could not fetch credentials for tunnel '$TUNNEL_NAME'. Do NOT delete the tunnel; send this output to the engineer."
fi
cp -f "$HOME/.cloudflared/$TUNNEL_ID.json" "/etc/cloudflared/$TUNNEL_ID.json" \
  || die "could not copy the credentials for tunnel '$TUNNEL_NAME' into /etc/cloudflared"
cat > /etc/cloudflared/config.yml <<EOF
tunnel: $TUNNEL_ID
credentials-file: /etc/cloudflared/$TUNNEL_ID.json
ingress:
  - hostname: $DOMAIN_INTERNAL
    service: http://127.0.0.1:$MODEL_PORT
    originRequest:
      # Ollama on 127.0.0.1 answers 403 to any other Host header
      httpHostHeader: localhost:$MODEL_PORT
  - service: http_status:404
EOF
# Our own unit, run from config.yml. ('cloudflared service install <arg>'
# treats <arg> as a dashboard token — passing the tunnel id there produces a
# unit reading a missing /etc/cloudflared/token, and the tunnel never starts.)
cat > /etc/systemd/system/cloudflared.service <<UNIT
[Unit]
Description=Cloudflare Tunnel client (SG16 model tunnel)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$(command -v cloudflared) --no-autoupdate --config /etc/cloudflared/config.yml tunnel run
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable cloudflared
systemctl restart cloudflared
fi

# ---- 5. local loop: prove the brain answers before anything else ------------
sleep 3
curl -s --max-time 300 "http://127.0.0.1:$MODEL_PORT/api/chat" -d "{\"model\":\"$MODEL_NAME\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"stream\":false,\"options\":{\"num_ctx\":$CTX}}" \
  | grep -q '"message"' && say "local inference OK (SG16 Brain Q4_K_M)" || die "local inference failed"

# tunnel check: prove the public hostname routes to the model server. Any HTTP
# status counts (200 = ollama answered; 403 = an Access app will guard it
# later); only a connection failure means the tunnel is broken. DNS can take
# a minute to propagate after 'route dns'.
say "checking the tunnel hostname (DNS can take a minute)..."
tunnel_code="000"
for _ in $(seq 1 12); do
  tunnel_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN_INTERNAL/api/tags" || true)"
  case "$tunnel_code" in
    200|401|403) break ;;
    *) sleep 5 ;;
  esac
done
case "$tunnel_code" in
  200|401|403) say "tunnel OK: https://$DOMAIN_INTERNAL answers (HTTP $tunnel_code; 403 = Cloudflare Access is guarding it)" ;;
  *) [ -n "$TUNNEL_TOKEN" ] && say "WARNING: https://$DOMAIN_INTERNAL does not answer yet (HTTP $tunnel_code). The brain and the tunnel are running; add the public hostname in the dashboard: Zero Trust -> Networks -> Tunnels -> this tunnel -> Public Hostname -> $DOMAIN_INTERNAL -> HTTP localhost:$MODEL_PORT, HTTP Host Header localhost:$MODEL_PORT." && exit 0
     die "https://$DOMAIN_INTERNAL does not route to the model server (last HTTP code: $tunnel_code). Check: systemctl status cloudflared ; cloudflared tunnel list ; cat /etc/cloudflared/config.yml" ;;
esac

cat <<NEXT

[vps-setup] DONE on the brain server. Now do these, in order, from your PC / dashboard:

 1. Cloudflare Zero Trust -> Access -> Applications: add a self-hosted app for
      $DOMAIN_INTERNAL
    policy action "Service Auth", include: your Service Token (nothing else).
 2. From your PC, set the Worker's secrets:
      cd brain-core
      npx wrangler secret put CF_ACCESS_CLIENT_ID      # paste the Client ID
      npx wrangler secret put CF_ACCESS_CLIENT_SECRET  # paste the Secret
      npx wrangler secret put MODEL_SHARED_SECRET      # any long random string
    There is NO third-party AI API secret — no backup route exists in this
    system. If the brain server is down, chat fails honestly with 502.
 3. Keep wrangler.jsonc in sync:
      MODEL_URL  = https://$DOMAIN_INTERNAL
      MODEL_NAME = $MODEL_NAME
 4. Chat returns 502 until BOTH this script and steps 1-2 are done. Then
    verify with your own eyes on the site's address (workers.dev or the domain).
 5. Zero open ports: run
      ufw default deny incoming && ufw allow outgoing && ufw enable
    and move SSH behind the tunnel (cloudflared access ssh) first — see
    docs/BRAIN-CORE-REBUILD.md, "Zero open ports".

NEXT
