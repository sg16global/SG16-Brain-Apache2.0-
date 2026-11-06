# The one-time perfect-server checklist

Every command here runs ON the VPS (`ssh root@169.58.12.24`), as root.
Read the whole page once before starting; the whole window takes about 30 minutes.

## 0. Snapshot

Take a Contabo snapshot of the VPS from the customer control panel. It is your undo button.

## 1. Updates + SSH hardening + kernel reboot (one session)

Keep a SECOND ssh window open during step 1c, just in case.

```bash
apt update && apt upgrade -y          # the 4 pending updates

# 1b. Harden ssh BEFORE rebooting. Key login is proven working, so this
# cannot lock you out. The edit MUST go into 50-cloud-init.conf: sshd uses
# the FIRST value it reads, so a 99-*.conf file would be ignored.
sed -i 's/^PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config.d/50-cloud-init.conf
sed -i 's/^PermitRootLogin yes/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sshd -T | grep -E 'passwordauthentication|permitrootlogin'
# must print: passwordauthentication no / permitrootlogin prohibit-password

reboot                                  # applies the new kernel 5.15.0-198
```

## 2. After the reboot, verify (from your PC)

```bash
ssh root@169.58.12.24 "systemctl is-active sg16-core sg16-web sg16-healthcheck.timer caddy"
# all four must print: active
ssh root@169.58.12.24 "sshd -T | grep passwordauthentication"
curl https://mistralbrain.com/api/health
# {"ok":true,"database":true,"brain":"online"}
curl -sI https://mistralbrain.com | grep -iE "strict-transport|x-frame|x-content-type"
# after the next deploy of the fixes branch these three headers appear
```

## 3. fail2ban (5 minutes)

```bash
apt install -y fail2ban
systemctl enable --now fail2ban
fail2ban-client status sshd
```

## 4. Off-host daily backup of what is irreplaceable

`/opt/sg16/state/` (issued passes), `/opt/sg16/.env`, and the Caddyfile.
From your own PC (Windows Task Scheduler daily):

```
scp root@169.58.12.24:/opt/sg16/state/passes.json*  D:\backups\sg16\
scp root@169.58.12.24:/opt/sg16/.env               D:\backups\sg16\
scp root@169.58.12.24:/etc/caddy/Caddyfile          D:\backups\sg16\
```

## 5. External uptime monitor

Point UptimeRobot (free) or a Cloudflare Health Check at
`https://mistralbrain.com/api/health` every 5 minutes. You learn about an
outage before a visitor does.

## 6. Money and operator checks (only you can do these)

- Buy one $3 day pass yourself and confirm the whole chain: checkout ->
  webhook -> confirm -> the pass validates on a second device.
- Sign in to the admin console once; mint one project key; check GET
  /api/admin shows database + brain online.

## 7. Optional

- ESM Apps security updates: `pro attach` (Ubuntu Pro, free for 5 machines).
- The code sandbox (/api/run) stays off until you install Docker and pull
  `python:3.12-alpine` and `node:22-alpine`; until then it correctly refuses.

## Housekeeping notes

- `pointoni/.env` on the server holds only the three Ollama variables; the
  systemd units load the real config from `/opt/sg16/.env`, which wins. Do
  not split future variables across both files.
- `/opt/sg16/.deploy-rollback/` is a leftover from the Sep 27 deploy; it can
  be deleted once you are happy with the current build (`rm -rf` is your call).
