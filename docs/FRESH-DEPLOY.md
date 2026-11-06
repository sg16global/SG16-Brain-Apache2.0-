# SG16 Brain — fresh deployment (new Cloudflare account, new GitHub, new server)

Written 2026-11-06. The fresh deployment shares **nothing** with the old setup:
no old Cloudflare zone, Worker, KV, D1, tunnel, GitHub repository or server is
used, read or changed. The only thing carried over is the Dodo Payments
product list (same Dodo account, owner decision).

Order matters: **check everything locally first, then GitHub, then Cloudflare.**

---

## 0. What the code expects (nothing old is built in)

| Setting | Where | Fresh value |
|---|---|---|
| Site address | `brain-core/wrangler.jsonc` `workers_dev: true` | the free `https://sg16-brain-core.<your-subdomain>.workers.dev` until a domain is added |
| KV `KEYS`, D1 `LOGS` | `wrangler.jsonc` | created new by `scripts/fresh-setup.mjs` (no old ids in the file) |
| Brain server | `MODEL_URL` var | empty = brain shows "offline" until the new server's tunnel exists |
| Sign-in email | `send_email` binding + `EMAIL_FROM` | commented out until the new domain is on Email Sending |
| Payment return page | — | the site's own address is always allowed |
| Dodo products | `DODO_PRODUCT_IDS` | the same four products as before |

## 1. Local check (this PC) — before GitHub

From `brain-core/`:

```
npm install
npm test                      # all tests must pass
npx tsc --noEmit -p .         # type check
node scripts/sync-web.mjs
npx wrangler deploy --dry-run # builds the Worker, contacts nobody
```

Then run it locally with the brain on this PC (Ollama with
`saiftechglobal/sg16-brain:q4_k_m`) and open http://127.0.0.1:8787:

```
npx wrangler dev --local --var MODEL_URL:http://127.0.0.1:11434 \
  --var SG16_IDENTITY_SECRET:<any 32+ chars> --var SG16_ADMIN_PASSWORD:<a test password> \
  --var BILLING_SECRET:<any 32+ chars> --var SG16_PROJECT_KEY_SECRET:<any 32+ chars>
```

## 2. GitHub (new repository)

1. Push this project to the new repository `sg16global/SG16-Brain-Apache2.0-`.
2. In the repository: Settings → Secrets and variables → Actions, add
   `CLOUDFLARE_API_TOKEN` (a token of the **new** account with Workers Scripts:Edit,
   KV:Edit, D1:Edit) and `CLOUDFLARE_ACCOUNT_ID` (the **new** account id).
3. `.github/workflows/brain-core-deploy.yml` is **manual only** for now: a
   push never deploys. Deploy by hand (Actions -> "Deploy brain-core Worker"
   -> Run workflow) only after step 3 below. Turn automatic deploys back on
   (the `push:` trigger noted in the file) once the new setup is stable.

## 3. Cloudflare (new account) — once

From `brain-core/`, logged in to the **new** account:

```
npx wrangler login
node scripts/fresh-setup.mjs          # shows which account; creates nothing
node scripts/fresh-setup.mjs --yes    # creates KV sg16-keys + D1 sg16_logs, writes ids, loads schema.sql
```

Commit the updated `wrangler.jsonc` (the ids are not secrets).

Secrets (each command asks for the value; use new random values, 32+ characters,
except the passwords and the Dodo values):

```
npx wrangler secret put SG16_IDENTITY_SECRET      # signs sign-in tokens
npx wrangler secret put SG16_ADMIN_PASSWORD       # the admin password for sg16global@gmail.com
npx wrangler secret put SG16_PROJECT_KEY_SECRET   # signs API project keys
npx wrangler secret put BILLING_SECRET            # signs passes
npx wrangler secret put DODO_API_KEY              # Dodo Payments API key
npx wrangler secret put DODO_WEBHOOK_SECRET       # from the new Dodo webhook (step 5)
npx wrangler secret put MODEL_SHARED_SECRET       # only if the brain server checks a bearer token
npx wrangler secret put CF_ACCESS_CLIENT_ID       # Access service token for the tunnel (step 4)
npx wrangler secret put CF_ACCESS_CLIENT_SECRET
```

Note: new secrets mean API keys and passes issued by the old site do not
work on the new one.

First deploy: `npm run deploy`. Open the workers.dev address it prints.

## 4. The brain server (new OVH server)

The tunnel needs a hostname on a domain in the new Cloudflare account, so this
step waits for the domain. Then, on the server, as root, with the GGUF copied over:

```
GGUF_PATH=/root/sg16-brain-Q4_K_M.gguf DOMAIN_INTERNAL=internal.your-domain.com \
  bash brain-core/scripts/vps-setup-model.sh
```

Then set `MODEL_URL` in `wrangler.jsonc` to `https://internal.your-domain.com`
and lock that hostname with Cloudflare Access (service token → the two
`CF_ACCESS_*` secrets).

## 5. When the new domain exists

1. Add the domain to the new Cloudflare account.
2. `wrangler.jsonc`: add `"routes": [{ "pattern": "your-domain.com/*", "zone_name": "your-domain.com" }]`.
3. Email → Email Sending → onboard the domain (Workers Paid to send to any address);
   uncomment `"send_email": [{ "name": "EMAIL" }]` and set
   `"EMAIL_FROM": "SG16 Brain <signin@your-domain.com>"`. Until then nobody can
   sign up, so free chat is closed and only passes and API keys can chat.
4. Dodo Payments: add a webhook to `https://your-domain.com/api/dodo/webhook`
   (or the workers.dev address before that) and put its secret in `DODO_WEBHOOK_SECRET`.
