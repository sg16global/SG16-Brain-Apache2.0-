#!/usr/bin/env bash
# ============================================================
# SG16 SOVEREIGN VPS KIT — one command, full brain on your own host
# Target: fresh Ubuntu 22.04/24.04 (Debian 11+ also fine)
# Run on the VPS itself as a sudo user:
#   curl -fsSL https://raw.githubusercontent.com/sg16global/Soverian-SG16-BRAIN/<branch>/scripts/vps-setup.sh | sudo bash -s -- YOURDOMAIN.com
#   → or: sudo bash scripts/vps-setup.sh YOURDOMAIN.com
# It installs Node 20 + Python, clones the brain, builds pointoni,
# launches core (:8080) + platform (:3000) under systemd, and (if a
# domain is passed) puts Caddy in front with automatic HTTPS.
# NO secrets are asked or echoed. .env is created empty for the owner.
# ============================================================
set -euo pipefail

DOMAIN="${1:-}"                 # optional: e.g. mistralbrain.com
REPO="https://github.com/sg16global/Soverian-SG16-BRAIN.git"
BRANCH="${SG16_BRANCH:-main}"   # override with SG16_BRANCH
APP=/opt/sg16
CORE_PORT=8080
WEB_PORT=3000

echo "== SG16 VPS KIT :: (1/7) system bones =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git python3 python3-venv python3-pip ufw >/dev/null

if ! command -v node >/dev/null || [ "$(node -v | sed 's/v//;s/\..*//')" -lt 20 ]; then
  echo "== (2/7) Node.js 20 =="
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
else
  echo "== (2/7) Node.js already $(node -v) =="
fi

echo "== (3/7) brain tissue: clone/pull =="
mkdir -p "$APP"
if [ ! -d "$APP/.git" ]; then
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$APP"
else
  git -C "$APP" fetch --depth 1 origin "$BRANCH"
  git -C "$APP" checkout "$BRANCH" && git -C "$APP" pull --ff-only
fi

echo "== (4/7) python core (sg16 runtime) =="
python3 -m venv "$APP/.venv"
"$APP/.venv/bin/pip" install -q --upgrade pip
[ -f "$APP/requirements.txt" ] && "$APP/.venv/bin/pip" install -q -r "$APP/requirements.txt" || true

echo "== (5/7) platform build =="
cd "$APP/pointoni"
npm install --ignore-scripts --no-audit --no-fund
npx next build

echo "== (6/7) engines under systemd (self-healing) =="
# With a domain, Caddy is the only thing that talks to the platform, so it (and
# the core, which only the platform talks to) listen on loopback only.
if [ -n "$DOMAIN" ]; then WEB_BIND=127.0.0.1; else WEB_BIND=0.0.0.0; fi

# Restart=always brings a crashed service back after RestartSec. The start limit
# (10 starts in 5 minutes) stops a hot crash loop from burning the CPU; the
# watchdog below clears that state and restarts the unit if it ever trips.
cat > /etc/systemd/system/sg16-core.service <<UNIT
[Unit]
Description=SG16 Core Brain (sg16 python runtime)
After=network.target
StartLimitIntervalSec=300
StartLimitBurst=10
[Service]
WorkingDirectory=$APP
ExecStart=$APP/.venv/bin/python $APP/scripts/serve.py 127.0.0.1 $CORE_PORT
Restart=always
RestartSec=5
TimeoutStopSec=20
LimitNOFILE=65535
Environment=SG16_TRANSPORT=online
EnvironmentFile=-$APP/.env
[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/sg16-web.service <<UNIT
[Unit]
Description=SG16 Platform (pointoni/next)
After=network.target sg16-core.service
StartLimitIntervalSec=300
StartLimitBurst=10
[Service]
WorkingDirectory=$APP/pointoni
ExecStart=/usr/bin/npx next start -p $WEB_PORT -H $WEB_BIND
Restart=always
RestartSec=5
TimeoutStopSec=20
LimitNOFILE=65535
Environment=NODE_ENV=production
EnvironmentFile=-$APP/.env
[Install]
WantedBy=multi-user.target
UNIT

# Watchdog: every minute, curl the core and the platform (--max-time inside the
# script); after 3 consecutive failures of one service, restart just that one.
# Logs go to the journal:  journalctl -u sg16-healthcheck
# Optional alert: put  SG16_ALERT_CMD=/path/to/your/script  in /etc/sg16/healthcheck.env
cat > /etc/systemd/system/sg16-healthcheck.service <<UNIT
[Unit]
Description=SG16 watchdog (core + platform health)
[Service]
Type=oneshot
ExecStart=$APP/scripts/healthcheck.sh
RuntimeDirectory=sg16-healthcheck
RuntimeDirectoryPreserve=yes
EnvironmentFile=-/etc/sg16/healthcheck.env
TimeoutStartSec=60
UNIT

cat > /etc/systemd/system/sg16-healthcheck.timer <<UNIT
[Unit]
Description=Run the SG16 watchdog every minute
[Timer]
OnBootSec=2min
OnUnitActiveSec=60s
AccuracySec=5s
[Install]
WantedBy=timers.target
UNIT
chmod +x "$APP/scripts/healthcheck.sh"

# .env owned by root, never printed; owner fills SG16_IDENTITY_SECRET etc.
if [ ! -f "$APP/.env" ]; then
  install -m 600 /dev/null "$APP/.env"
  cat > "$APP/.env" <<EOF
# SG16 platform secrets — owner fills these on the VPS (never in chat, never in git)
SG16_IDENTITY_SECRET=change-me-$(date +%s)
SG16_BRAIN_URL=http://127.0.0.1:$CORE_PORT
# Optional — see docs/OPERATIONS.md:
# SG16_RATE_PER_MINUTE=8
# SG16_RATE_PER_HOUR=60
# SG16_RATE_GLOBAL_PER_MINUTE=300
# TURNSTILE_SECRET_KEY=
# TURNSTILE_SITE_KEY=
# SG16_METRICS_LOG=1
EOF
fi

# Shared secret that proves a request came through OUR proxy. Without it the
# platform ignores forwarding headers (they can be forged) and per-visitor rate
# limits stay off. Generated here, written to .env and the Caddyfile, never printed.
if ! grep -q '^SG16_PROXY_AUTH_SECRET=' "$APP/.env"; then
  PROXY_SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  printf '\nSG16_PROXY_AUTH_SECRET=%s\n' "$PROXY_SECRET" >> "$APP/.env"
fi
PROXY_SECRET="$(grep '^SG16_PROXY_AUTH_SECRET=' "$APP/.env" | tail -1 | cut -d= -f2-)"

systemctl daemon-reload
systemctl enable --now sg16-core sg16-web
systemctl enable --now sg16-healthcheck.timer

if [ -n "$DOMAIN" ]; then
  echo "== (7/7) Caddy front door + auto-HTTPS for $DOMAIN =="
  if ! command -v caddy >/dev/null; then
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq && apt-get install -y -qq caddy >/dev/null
  fi
  # Real client address for per-visitor rate limits. If the site sits behind
  # Cloudflare, Caddy must trust Cloudflare's ranges so it can read the visitor
  # from CF-Connecting-IP; otherwise every visitor looks like one Cloudflare
  # address. The platform only believes the address when the request carries the
  # shared secret below.
  CF_RANGES="$(curl -fsS --max-time 10 https://www.cloudflare.com/ips-v4 2>/dev/null; echo; curl -fsS --max-time 10 https://www.cloudflare.com/ips-v6 2>/dev/null || true)"
  CF_RANGES="$(echo "$CF_RANGES" | tr '\n' ' ' | sed 's/  */ /g;s/^ //;s/ $//')"
  CADDY_TRUST=""
  if [ -n "$CF_RANGES" ]; then
    CADDY_TRUST="{
    servers {
        trusted_proxies static $CF_RANGES
        client_ip_headers CF-Connecting-IP X-Forwarded-For
    }
}"
  fi
  [ -f /etc/caddy/Caddyfile ] && cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.sg16-backup
  umask 027
  cat > /etc/caddy/Caddyfile <<CADDY
$CADDY_TRUST
$DOMAIN {
    encode zstd gzip
    reverse_proxy 127.0.0.1:$WEB_PORT {
        # overwrite anything the client sent with the address Caddy resolved
        header_up CF-Connecting-IP {client_ip}
        header_up X-SG16-Proxy-Auth $PROXY_SECRET
    }
}
CADDY
  chgrp caddy /etc/caddy/Caddyfile 2>/dev/null || true
  # never leave the front door broken: fall back to the plain config if this one does not validate
  if ! caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
    echo "WARNING: generated Caddyfile did not validate; using the plain config (no per-visitor rate limiting)"
    cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
    encode zstd gzip
    reverse_proxy 127.0.0.1:$WEB_PORT
}
CADDY
  fi
  systemctl reload caddy || systemctl restart caddy
fi

ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 80,443/tcp >/dev/null 2>&1 || true
yes | ufw enable >/dev/null 2>&1 || true

echo
echo "============================================================"
echo " SG16 BRAIN LIVES ON ${DOMAIN:-http://<vps-ip>:$WEB_PORT}"
echo " core  : systemctl status sg16-core   (port $CORE_PORT)"
echo " web   : systemctl status sg16-web    (port $WEB_PORT)"
echo " logs  : journalctl -u sg16-core -f   |   -u sg16-web -f"
echo " next  : edit $APP/.env (SG16_IDENTITY_SECRET), then"
echo "         systemctl restart sg16-web"
echo " NO SECRETS WERE ASKED OR PRINTED — that is by law."
echo "============================================================"
