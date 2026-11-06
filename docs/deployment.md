# Deploying SG16 BRAIN to mistralbrain.com

The host is a single self-contained Python process with **zero third-party
dependencies**, so deployment is either "put the directory on a machine and run
it" (air-gapped) or "put it behind a TLS reverse proxy" (online). Both run the
same mathematics.

## Online (mistralbrain.com)

```nginx
server {
    listen 443 ssl http2;
    server_name mistralbrain.com www.mistralbrain.com;

    ssl_certificate     /etc/letsencrypt/live/mistralbrain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mistralbrain.com/privkey.pem;

    # the sovereign host
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 30s;
        client_max_body_size 4m;   # matches config/brain.json max_body_bytes
    }
}
```

Run it as a service:

```ini
# /etc/systemd/system/sg16brain.service
[Unit]
Description=SG16 BRAIN sovereign host
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/Soverian-SG16-BRAIN
Environment=SG16_TRANSPORT=online
ExecStart=/usr/bin/python3 -m sg16.server 127.0.0.1 8080
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now sg16brain
certbot --nginx -d mistralbrain.com -d www.mistralbrain.com
```

## Air-gapped (offline)

```bash
SG16_TRANSPORT=offline python3 -m sg16.server 0.0.0.0 8080
```

No DNS, no certificate and no proxy are required. The transport label is
*declared, never probed*, and it never enters the mathematics: `GET /api/parity`
still returns byte-identical reasoning plans.

## Verifying a deployment

```bash
curl -s https://mistralbrain.com/api/health        # status: ready
curl -s https://mistralbrain.com/api/parity        # identical: true
curl -s -X POST https://mistralbrain.com/api/ingest \
     -H 'Content-Type: application/json' \
     -d '{"text":"hello","session_id":"smoke"}'
# -> reply: "Share your idea first."
```

## Tuning the gate

`config/brain.json` → `gate.threshold` (joint-risk cutoff) and `gate.veto_level`
(per-category saturation). Lower threshold = stricter door. The charter wording is
not configurable; it lives in `sg16/charter.py` and is asserted verbatim by tests.

## Enabling the Dodo Payments gateway (live MoR)

The subscription passes sell through Dodo Payments Merchant-of-Record once the
operator fills the `billing.dodo` section of `config/brain.json`
(or the `DODO_API_KEY` / `DODO_WEBHOOK_SECRET` environment variables, which
override the file):

```json
"billing": {
  "dodo": {
    "test_mode": false,
    "api_key": "<Dodo dashboard API key>",
    "webhook_secret": "<whsec_... from the Dodo webhook configuration>",
    "product_ids": {
      "day":   "<product for the $3 24-hour pass>",
      "week":  "<product for the $5 1-week pass>",
      "half":  "<product for the $8 15-day pass>",
      "month": "<product for the $15 1-month pass>"
    }
  }
}
```

Point a Dodo webhook at `https://mistralbrain.com/api/dodo/webhook` subscribed to
`payment.succeeded` and `checkout.session.completed`. The host verifies the
Standard Webhooks signature (`webhook-id` / `webhook-timestamp` /
`webhook-signature`, HMAC-SHA256 over `{id}.{timestamp}.{body}`, 5-minute replay
window) before signing anything. The checkout flow is then:

1. client → `POST /api/dodo/checkout` → host creates the Dodo session;
2. payer completes the Dodo-hosted checkout and returns to the app;
3. Dodo → `POST /api/dodo/webhook` (signature-verified) → the host signs a
   duration-locked pass token;
4. client → `POST /api/dodo/confirm` → receives the signed record for local
   caching and optional account binding after `/api/pass/verify`.

Without gateway credentials, paid checkout fails closed (`/api/billing`
reports the gateway disabled). A $0 humanitarian record is issued only when an
operator-trusted proxy authenticates geo headers. Pass, pending-checkout and
webhook replay state is in-memory in this process and is lost on restart — use
durable storage before relying on paid checkout in production. Reverse-proxy
and platform logs remain deployment concerns. The Dodo client lives inside
`sg16/server/` (enforced by `tests/test_isolation.py`).
