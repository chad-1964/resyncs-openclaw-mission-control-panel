# Virgin Install Test — Full Reset Runbook

Run this on the **test.resyncs.com** server to simulate a brand-new customer installation.
The goal: visit test.resyncs.com and see the **PHP installer (index.php)** — not the React wizard.

---

## Why This Is Needed

When index.php completes a previous install it:
1. Writes proxy rules into `.htaccess` — Apache then bypasses index.php entirely
2. Spawns `node dist/index.cjs` via `nohup` — survives across resets, invisible to PM2
3. Creates `.installed` — tells index.php to redirect straight to the Node app

All three must be cleared for a true virgin state.

---

## Full Reset Script (run on server)

```bash
cd ~/test.resyncs.com

# 1. Kill ALL stale node processes launched by previous PHP installs
#    (these are nohup processes not managed by PM2)
ps aux | grep 'test.resyncs.com' | grep -v grep | awk '{print $2}' \
  | while read pid; do kill -9 $pid 2>/dev/null; done

# 2. Also stop/delete PM2 entry if one exists from manual testing
pm2 stop mc-test-resyncs-com 2>/dev/null || true
pm2 delete mc-test-resyncs-com 2>/dev/null || true
pm2 save 2>/dev/null || true

# 3. Clear .htaccess proxy block — CRITICAL
#    index.php writes RewriteRule/ProxyPassReverse rules that intercept all
#    requests before PHP runs. Must be blank for index.php to be served.
echo '' > .htaccess

# 4. Remove the install lock file
rm -f .installed

# 5. Nuke the database (drops all tables + clears openclaw settings)
npm run reset-all:nuke

# 6. Hard-delete ~/.openclaw so install-openclaw seeds from openclaw-starter/
npm run reset-openclaw -- --hard

# 7. Pull latest code
GIT_SSH_COMMAND='ssh -i ~/.ssh/id_ed25519_github -o StrictHostKeyChecking=no' \
  git pull origin main

# 8. npm install (ensure dependencies match latest code)
npm install
```

After running: visit **https://test.resyncs.com** — you should see the PHP installer UI.

---

## What the PHP Installer Does (for reference)

1. Collects DB credentials → tests connection → writes `.env`
2. Runs `npm install`, `npm run migrate`, `npm run install-openclaw`, `npm run build`
3. Starts `nohup node dist/index.cjs` on a free port (finds one via `find_free_port()`)
4. Writes `.htaccess` proxy rules pointing to that port
5. Creates `.installed`
6. Redirects to `/?installer=1` → React wizard continues from Step 2 (Admin setup)

---

## What React Wizard Does (Step 2 onward)

1. Admin account details
2. AI provider + API key (OpenRouter, Anthropic, OpenAI, Ollama, etc.)
3. Domain / SSL config
4. Agent preset selection
5. On **Finish** → calls `/api/setup/complete` which:
   - Saves all settings to DB
   - Kicks off `npm run install-openclaw` in background (seeds `~/.openclaw` from `openclaw-starter/` if missing)
   - Calls `wireOpenClawProvider()` → writes `auth-profiles.json` + `models.json` + sets `agents.defaults.model`

---

## Quick One-Liner (after SSHing in)

```bash
cd ~/test.resyncs.com && \
  ps aux | grep 'test.resyncs.com' | grep -v grep | awk '{print $2}' | while read p; do kill -9 $p 2>/dev/null; done && \
  pm2 delete mc-test-resyncs-com 2>/dev/null; pm2 save 2>/dev/null; \
  echo '' > .htaccess && rm -f .installed && \
  npm run reset-all:nuke && \
  npm run reset-openclaw -- --hard && \
  GIT_SSH_COMMAND='ssh -i ~/.ssh/id_ed25519_github -o StrictHostKeyChecking=no' git pull origin main && \
  npm install && \
  echo "✅ Virgin state ready — visit https://test.resyncs.com"
```

---

## Checklist Before Calling It a Pass

- [ ] Visited test.resyncs.com → saw PHP installer (not React)
- [ ] PHP installer accepted DB credentials and connected
- [ ] Install completed → redirected to React wizard
- [ ] Completed wizard with OpenRouter key
- [ ] Settings page shows OpenClaw as installed
- [ ] CEO agent responds to a test message
- [ ] `~/.openclaw/agents/main/agent/auth-profiles.json` has the OpenRouter key
- [ ] `~/.openclaw/openclaw.json` has a fresh `oc_` token

---

## Server Details

| Item | Value |
|------|-------|
| Test URL | https://test.resyncs.com |
| App path | `~/test.resyncs.com/` |
| PM2 name | `mc-test-resyncs-com` |
| Port | 5010 (or next free port found by index.php) |
| DB | `resyncs_test` (MariaDB) |
| Production | `~/mc.resyncs.com/` — do NOT test on this |
