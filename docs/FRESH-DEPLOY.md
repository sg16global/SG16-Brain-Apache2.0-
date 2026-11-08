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
| Worker | `brain-core/wrangler.jsonc` `name` | `sg16-brain-apache2-0` (a Worker created in the dashboard and connected to GitHub must use exactly this name) |
| Site address | `brain-core/wrangler.jsonc` `workers_dev: true` | the free `https://sg16-brain-apache2-0.<your-subdomain>.workers.dev`; custom domains mistralbrain.com and www |
| KV `KEYS`, D1 `LOGS` | `wrangler.jsonc` | created new by `scripts/fresh-setup.mjs` (no old ids in the file) |
| Brain | `MODEL_NAME` var | `saiftechglobal/sg16-brain:Q4_K_M` — the published 7.5 GB build (ID `f4b21a5d4668`) |
| Brain server | `/admin` → BRAIN SERVER (or the `MODEL_URL` var) | empty = brain shows "offline" until a server is connected; any server works, no redeploy needed to change it |
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

Then run it locally with the brain on this PC and open http://127.0.0.1:8787:

```
ollama pull saiftechglobal/sg16-brain:Q4_K_M   # 7.5 GB, once
ollama list                                    # its ID must read f4b21a5d4668
npx wrangler dev --local --var MODEL_URL:http://127.0.0.1:11434 \
  --var SG16_IDENTITY_SECRET:<any 32+ chars> --var SG16_ADMIN_PASSWORD:<a test password> \
  --var BILLING_SECRET:<any 32+ chars> --var SG16_PROJECT_KEY_SECRET:<any 32+ chars>
```

## 2. GitHub (new repository)

1. The project lives in `sg16global/SG16-Brain-Apache2.0-` (branch `main`).
2. In the repository: Settings → Secrets and variables → Actions, add
   `CLOUDFLARE_API_TOKEN` (a token of the **new** account with Workers Scripts:Edit,
   KV:Edit, D1:Edit) and `CLOUDFLARE_ACCOUNT_ID` (the **new** account id).
3. `.github/workflows/brain-core-deploy.yml` is **manual only** for now: a
   push never deploys. Deploy by hand (Actions -> "Deploy brain-core Worker"
   -> Run workflow) only after step 3 below. Turn automatic deploys back on
   (the `push:` trigger noted in the file) once the new setup is stable.

### Or: a Worker connected to GitHub (Workers Builds)

Cloudflare dashboard → Workers & Pages → Create → Import a repository:

| Setting | Value |
|---|---|
| Repository / branch | `sg16global/SG16-Brain-Apache2.0-` / `main` |
| Worker name | `sg16-brain-apache2-0` (must match `wrangler.jsonc`) |
| Root directory | `brain-core` |
| Build command | *(empty: `wrangler.jsonc` stages the site itself)* |
| Deploy command | `npx wrangler deploy` |

Then add the Worker's secrets (Settings → Variables and Secrets, type
**Secret**): the list in step 3 below.

## 3. Cloudflare (new account) — once

From `brain-core/`, logged in to the **new** account:

```
npx wrangler login
node scripts/fresh-setup.mjs          # shows which account; creates nothing
node scripts/fresh-setup.mjs --yes    # creates KV sg16-keys + D1 sg16_logs, writes ids, loads schema.sql
```

Commit the updated `wrangler.jsonc` (the ids are not secrets).

If the KV namespace and D1 database were created in the dashboard instead
(as on 2026-11-08: KV `SOVERIAN_KV`, D1 `soverian-sg16-brain`), their ids are
already in `wrangler.jsonc`; skip `fresh-setup.mjs` and load the tables once:

```
npx wrangler d1 execute soverian-sg16-brain --remote --file schema.sql
```

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
step waits for the domain. Then, on the server, as root, from a checkout of
this repository:

```
DOMAIN_INTERNAL=internal.your-domain.com bash brain-core/scripts/vps-setup-model.sh
```

With a tunnel created in the dashboard (Zero Trust → Networks → Tunnels), give
the script its install token instead of running `cloudflared login`:

```
read -rs TUNNEL_TOKEN && export TUNNEL_TOKEN      # paste the eyJ... token, Enter
DOMAIN_INTERNAL=internal.your-domain.com bash brain-core/scripts/vps-setup-model.sh
```

and set the tunnel's public hostname in the dashboard: `internal.your-domain.com`
→ HTTP `localhost:8081`, with HTTP Settings → HTTP Host Header `localhost:8081`
(Ollama refuses any other host name).

The script pulls `saiftechglobal/sg16-brain:Q4_K_M` from Ollama, refuses any
build whose ID is not `f4b21a5d4668`, removes every other model, binds Ollama
to 127.0.0.1 only and creates the tunnel.

Lock that hostname with Cloudflare Access (service token). Then connect it,
either way:

- **On `/admin` → BRAIN SERVER** (recommended, no redeploy): enter
  `https://internal.your-domain.com`, choose CLOUDFLARE SECRETS (after putting
  the token in the two `CF_ACCESS_*` secrets) or ENTER HERE (paste the token's
  client ID and secret; stored encrypted), TEST CONNECTION, SAVE & CONNECT.
- or set `MODEL_URL` in `wrangler.jsonc` and redeploy.

Moving to another server later is the same step on the new machine; the
setting on `/admin` always wins over `MODEL_URL`.

## 5. When the new domain exists

1. Add the domain to the new Cloudflare account.
2. `wrangler.jsonc`: add `"routes": [{ "pattern": "your-domain.com/*", "zone_name": "your-domain.com" }]`.
3. Email → Email Sending → onboard the domain (Workers Paid to send to any address);
   uncomment `"send_email": [{ "name": "EMAIL" }]` and set
   `"EMAIL_FROM": "SG16 Brain <signin@your-domain.com>"`. Until then nobody can
   sign up, so free chat is closed and only passes and API keys can chat.
4. Dodo Payments: add a webhook to `https://your-domain.com/api/dodo/webhook`
   (or the workers.dev address before that) and put its secret in `DODO_WEBHOOK_SECRET`.
