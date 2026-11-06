#!/usr/bin/env bash
# =============================================================================
# SG16 BRAIN — inference-only VPS setup (run ON the brain server, 16 GB+ RAM, as root).
#
# ONE brain, nothing else: SG16 Brain, Q4_K_M weights (sg16-brain-Q4_K_M.gguf,
# ~7.5 GB, GGUF general.file_type 15). The weights are installed from the GGUF
# file you copy onto the box — nothing is downloaded from any model hub.
#
#   GGUF_PATH=/root/sg16-brain-Q4_K_M.gguf DOMAIN_INTERNAL=internal.your-domain.com #     bash scripts/vps-setup-model.sh
#
#   MODE=ollama   (default)  install/upgrade Ollama, register the brain as
#                            saiftechglobal/sg16-brain:q4_k_m (brain-core/model/Modelfile)
#   MODE=llamacpp            one llama.cpp server for the brain
#
# Every earlier brain (Qwen chat/coder, Devstral, Ministral, Mistral, any other
# sg16-brain tag) is REMOVED from Ollama by this script if present.
#
# What this script does:
#   1. binds the model server to 127.0.0.1 ONLY (never a public port)
#   2. installs cloudflared and creates the tunnel $DOMAIN_INTERNAL (a hostname on
#      the NEW Cloudflare account's domain) -> http://127.0.0.1:$MODEL_PORT
#   3. prints the exact Cloudflare Access + Worker secret steps you must run
#
# Context cap is enforced twice: OLLAMA_CONTEXT_LENGTH=8192 here, and
# options.num_ctx=8192 in every Worker request.
# KEEP_ALIVE stays a finite default (30m) — NEVER -1 (never pin models forever).
#
# FRESH DEPLOYMENT (2026-11-06): nothing here points at the old account; the
# tunnel hostname is always given explicitly (DOMAIN_INTERNAL).
# =============================================================================
set -euo pipefail

MODE="${MODE:-ollama}"
MODEL_PORT="${MODEL_PORT:-8081}"
# One level under the new domain only (e.g. internal.your-domain.com): the free
# Cloudflare certificate covers *.your-domain.com, not a.b.your-domain.com.
# If the tunnel is later managed from the dashboard, its remote config
# overrides the local config.yml written below.
DOMAIN_INTERNAL="${DOMAIN_INTERNAL:-}"
TUNNEL_NAME="${TUNNEL_NAME:-sg16-model}"
CTX="${CTX:-8192}"
# The one brain. Keep in sync with wrangler.jsonc MODEL_NAME.
MODEL_NAME="${MODEL_NAME:-saiftechglobal/sg16-brain:q4_k_m}"
GGUF_PATH="${GGUF_PATH:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODELFILE_SRC="$HERE/../model/Modelfile"
MODEL_DIR="/opt/sg16-model/models"
MODEL_GGUF="$MODEL_DIR/sg16-brain-Q4_K_M.gguf"
# every earlier brain — removed so the SG16 Brain Q4_K_M is the only model on the box
OLD_MODELS="${OLD_MODELS:-qwen3:4b-instruct-2507-q4_K_M qwen2.5-coder:7b-instruct-q8_0 qwen2.5:1.5b-instruct-fp16 devstral ministral-3:3b-instruct-2512-fp16 qwen2.5-coder:3b-instruct-fp16 mistral mistral:7b-instruct-v0.3-fp16 mistral:7b-instruct-v0.3-q8_0 saiftechglobal/sg16-brain:latest}"

say()  { echo "[vps-setup] $*"; }
die()  { echo "[vps-setup] ERROR: $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run as root"
[ -n "$DOMAIN_INTERNAL" ] || die "set DOMAIN_INTERNAL to the tunnel hostname on the NEW domain, e.g. DOMAIN_INTERNAL=internal.your-domain.com"
# a "16 GB" server reports a little under 16000 MiB; the brain needs ~9 GB (weights + 8K KV cache)
free -m | awk 'NR==2{ if ($2 < 15000) exit 1 }' || die "this box needs a 16 GB server for the 12B Q4_K_M brain + its 8K KV cache"

# Preflight: the weights must be the SG16 Brain Q4_K_M GGUF. Fail before
# anything is installed or removed.
if [ -z "$GGUF_PATH" ] && [ -f "$MODEL_GGUF" ]; then GGUF_PATH="$MODEL_GGUF"; fi
[ -n "$GGUF_PATH" ] || die "set GGUF_PATH to the sg16-brain-Q4_K_M.gguf you copied onto this box"
[ -f "$GGUF_PATH" ] || die "GGUF_PATH not found: $GGUF_PATH"
[ "$(head -c 4 "$GGUF_PATH")" = "GGUF" ] || die "$GGUF_PATH is not a GGUF file"
case "$(basename "$GGUF_PATH")" in
  *Q4_K_M*|*q4_k_m*) ;;
  *) die "$GGUF_PATH is not the Q4_K_M brain (expected sg16-brain-Q4_K_M.gguf)" ;;
esac
[ -f "$MODELFILE_SRC" ] || die "missing $MODELFILE_SRC (run from the repository checkout)"

# Preflight: cloudflared must be installed and authenticated BEFORE the brain
# is registered and before the old brains are removed — fail fast, not half-swapped.
command -v cloudflared >/dev/null 2>&1 || {
  arch="$(dpkg --print-architecture)"
  curl -fL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}.deb" -o /tmp/cloudflared.deb
  dpkg -i /tmp/cloudflared.deb
}
mkdir -p "$HOME/.cloudflared"   # 'cloudflared login' writes its cert.pem here
cloudflared tunnel list >/dev/null 2>&1 \
  || die "cloudflared is not authenticated. Run 'cloudflared login' once (it prints a URL — open it in your browser and pick the NEW domain's zone), then re-run this script. Nothing installed yet, old brains untouched."

if ss -ltn "sport = :$MODEL_PORT" | grep -q LISTEN; then
  ss -ltnp "sport = :$MODEL_PORT" 2>/dev/null | grep -Eq 'ollama|llama-server' \
    && say "re-run: the model server already listens on $MODEL_PORT" \
    || die "port $MODEL_PORT already in use — pick another MODEL_PORT"
fi

# ---- 1. the weights + the model server ---------------------------------------
mkdir -p "$MODEL_DIR"
if [ "$(readlink -f "$GGUF_PATH")" != "$(readlink -f "$MODEL_GGUF")" ]; then
  say "installing the brain weights -> $MODEL_GGUF"
  cp -f "$GGUF_PATH" "$MODEL_GGUF"
fi

if [ "$MODE" = "ollama" ]; then
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
  export OLLAMA_HOST="127.0.0.1:$MODEL_PORT"   # the CLI (create/show/rm) must reach the daemon
  systemctl daemon-reload && systemctl enable ollama && systemctl restart ollama
  sleep 2
  # the repository Modelfile, pointed at the installed weights
  sed "s|^FROM .*|FROM $MODEL_GGUF|" "$MODELFILE_SRC" > "$MODEL_DIR/Modelfile"
  say "registering the brain: $MODEL_NAME (Q4_K_M, ~7.5 GB)"
  ollama create "$MODEL_NAME" -f "$MODEL_DIR/Modelfile"
  ollama show "$MODEL_NAME" >/dev/null || die "the brain did not register"
  say "model server: ollama on 127.0.0.1:$MODEL_PORT, ctx $CTX, one brain, provider /api/chat"
else
  apt-get update && apt-get install -y git build-essential cmake curl
  mkdir -p /opt/sg16-model && cd /opt/sg16-model
  [ -d llama.cpp ] || git clone --depth 1 https://github.com/ggml-org/llama.cpp
  cmake -S llama.cpp -B llama.cpp/build -DGGML_CUDA=OFF -DLLAMA_CURL=OFF
  cmake --build llama.cpp/build --config Release -j"$(nproc)"
  # retire the old per-brain servers and their weights
  for unit in sg16-model-chat sg16-model-coder; do
    systemctl disable --now "$unit" 2>/dev/null || true
    rm -f "/etc/systemd/system/$unit.service"
  done
  rm -f "$MODEL_DIR"/chat.gguf "$MODEL_DIR"/coder.gguf "$MODEL_DIR"/devstral-small-q4km.gguf "$MODEL_DIR"/chat-fp16.gguf "$MODEL_DIR"/coder-fp16.gguf
  # llama-server applies the GGUF's own chat format (mistral-v3-tekken)
  cat > /etc/systemd/system/sg16-model.service <<UNIT
[Unit]
Description=SG16 inference-only model server (SG16 Brain Q4_K_M)
After=network.target

[Service]
ExecStart=/opt/sg16-model/llama.cpp/build/bin/llama-server \
  -m $MODEL_GGUF --alias $MODEL_NAME \
  --host 127.0.0.1 --port $MODEL_PORT -c $CTX -ngl 0 --parallel 1
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload && systemctl enable --now sg16-model
  say "model server: llama-server on 127.0.0.1:$MODEL_PORT, ctx $CTX, one brain"
fi

# ---- 2. remove every earlier brain -------------------------------------------
if [ "$MODE" = "ollama" ]; then
  for old in $OLD_MODELS; do
    [ "$old" = "$MODEL_NAME" ] && continue
    if ollama show "$old" >/dev/null 2>&1; then
      say "removing an earlier brain: $old"
      ollama rm "$old"
    fi
  done
  say "models now on this box:"; ollama list
fi

# ---- 3. cloudflare tunnel (cloudflared installed + authed in the preflight) --
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
  - service: http_status:404
EOF
# Our own unit, run from config.yml. ('cloudflared service install <arg>'
# treats <arg> as a dashboard token — passing the tunnel id there produced a
# unit reading a missing /etc/cloudflared/token, and the tunnel never started.)
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

# ---- 4. local loop: prove the brain answers before anything else ------------
sleep 3
if [ "$MODE" = "ollama" ]; then
  curl -s --max-time 300 "http://127.0.0.1:$MODEL_PORT/api/chat" -d "{\"model\":\"$MODEL_NAME\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"stream\":false,\"options\":{\"num_ctx\":$CTX}}" \
    | grep -q '"message"' && say "local inference OK (SG16 Brain Q4_K_M)" || die "local inference failed"
else
  curl -s "http://127.0.0.1:$MODEL_PORT/health" | grep -q '"status":"ok"' \
    && say "brain server OK" || die "brain server failed"
fi

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
  200|401|403) say "tunnel OK: https://$DOMAIN_INTERNAL routes to 127.0.0.1:$MODEL_PORT" ;;
  *) die "https://$DOMAIN_INTERNAL does not route to the model server (last HTTP code: $tunnel_code). Check: systemctl status cloudflared ; cloudflared tunnel list ; cat /etc/cloudflared/config.yml" ;;
esac

cat <<NEXT

[vps-setup] DONE on the VPS. Now do these, in order, from your PC / dashboard:

 1. Cloudflare Zero Trust -> Access -> Applications: add a self-hosted app for
      $DOMAIN_INTERNAL
    policy: deny all, EXCEPT a Service Token. Note the Client ID + Secret.
 2. Deploy the Worker if you have not already (it deploys automatically on
    push to main — see brain-core/README.md). From your PC, set its secrets:
      cd brain-core
      npx wrangler secret put CF_ACCESS_CLIENT_ID      # paste the Client ID
      npx wrangler secret put CF_ACCESS_CLIENT_SECRET  # paste the Secret
      npx wrangler secret put MODEL_SHARED_SECRET      # any long random string
    There is NO third-party AI API secret — no backup route exists in this
    system. If the VPS is down, chat fails honestly with 502.
 3. Keep wrangler.jsonc in sync (it already matches these defaults):
      MODEL_URL        = https://$DOMAIN_INTERNAL
      MODEL_NAME       = $MODEL_NAME
      MODEL_PROVIDER   = ollama   (MODE=llamacpp: llamacpp, with MODEL_HEALTH_PATH=/health)
 4. Chat returns 502 until BOTH this script and steps 1-2 are done. Then
    verify with your own eyes on the site's address (workers.dev or the new domain).
 5. Zero open ports: after the cutover retires the old stack, run
      ufw default deny incoming && ufw allow outgoing && ufw enable
    and move SSH behind the tunnel (cloudflared access ssh) — see
    docs/BRAIN-CORE-REBUILD.md, "Zero open ports".

NEXT
