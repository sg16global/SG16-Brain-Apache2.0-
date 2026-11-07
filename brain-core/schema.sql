-- D1: logs and history for the brain core. Real events only; no synthetic rows.
-- Content of user messages/answers is NOT stored — only digests, engine and
-- verification outcome.

CREATE TABLE IF NOT EXISTS requests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,              -- unix ms
  key_id     TEXT    NOT NULL,             -- key record id (never the raw key)
  user_id    INTEGER NOT NULL,             -- owner = 1, same system for everyone
  project    TEXT    NOT NULL,
  kind       TEXT    NOT NULL,             -- chat | compute | state | health
  engine     TEXT    NOT NULL,             -- model-vps | core | none
  http       INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  queue_ms   INTEGER NOT NULL DEFAULT 0,
  verified   INTEGER NOT NULL DEFAULT 0,
  err_code   TEXT,
  script     TEXT                          -- detected dominant Unicode script
);
CREATE INDEX IF NOT EXISTS idx_requests_ts ON requests(ts);
CREATE INDEX IF NOT EXISTS idx_requests_key ON requests(key_id, ts);

CREATE TABLE IF NOT EXISTS history (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ts               INTEGER NOT NULL,
  key_id           TEXT    NOT NULL,
  project          TEXT    NOT NULL,
  request_digest   TEXT    NOT NULL,       -- sha256 of the user text
  response_digest  TEXT    NOT NULL,       -- sha256 of the accepted answer
  engine           TEXT    NOT NULL,
  verified         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_history_key ON history(key_id, ts);

-- Payment pipeline (Dodo Payments MoR). checkouts = in-flight checkout
-- sessions; passes = issued pass records (the signed record itself is
-- stateless, the row is for pickup/admin and legacy 64-hex tokens);
-- webhook_events = replay dedupe.
CREATE TABLE IF NOT EXISTS checkouts (
  ref                 TEXT PRIMARY KEY,    -- host checkout ref
  pass_id             TEXT NOT NULL,
  region              TEXT,
  status              TEXT NOT NULL,       -- pending | paid | expired
  opened_at           INTEGER NOT NULL,    -- unix s
  gateway_session_id  TEXT,
  record_token        TEXT
);
CREATE INDEX IF NOT EXISTS idx_checkouts_gateway ON checkouts(gateway_session_id);

CREATE TABLE IF NOT EXISTS passes (
  token      TEXT PRIMARY KEY,
  record     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  webhook_id TEXT PRIMARY KEY,
  seen_at    INTEGER NOT NULL
);

-- Visitor accounts (src/accounts.ts, 2026-11-06). The Worker creates these
-- two tables itself on first use; they are listed here for the record.
-- accounts: email, when created / last signed in, and the account's pass
-- (the X-SG16-Pass value). login_codes: one live sign-in code per email,
-- stored as an HMAC (never the code), with its expiry and limits.
CREATE TABLE IF NOT EXISTS accounts (
  email         TEXT PRIMARY KEY,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL,
  pass          TEXT
);

CREATE TABLE IF NOT EXISTS login_codes (
  email      TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  sent_at    INTEGER NOT NULL,
  sends_hour INTEGER NOT NULL DEFAULT 1,
  hour_start INTEGER NOT NULL
);
