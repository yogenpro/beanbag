PRAGMA foreign_keys = ON;

CREATE TABLE ledger_meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
INSERT INTO ledger_meta(id, revision) VALUES(1, 0);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL UNIQUE CHECK (role IN ('joint_checking', 'joint_brokerage')),
  label TEXT NOT NULL,
  mask TEXT NOT NULL
);
CREATE TABLE plaid_connections (
  id TEXT PRIMARY KEY,
  encrypted_token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected',
  created_at TEXT NOT NULL
);
CREATE TABLE source_records (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('bank', 'investment')),
  provider_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  event_date TEXT NOT NULL,
  revision TEXT NOT NULL,
  record_json TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  removed INTEGER NOT NULL DEFAULT 0,
  UNIQUE(source_kind, provider_id)
);
CREATE INDEX source_date ON source_records(event_date, source_kind);
CREATE TABLE financial_events (
  id TEXT PRIMARY KEY REFERENCES source_records(id),
  event_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'needs_review', 'pending', 'removed')),
  amount_cents INTEGER,
  event_json TEXT NOT NULL
);
CREATE INDEX event_period ON financial_events(event_date, status, kind);
CREATE TABLE event_overrides (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  event_id TEXT NOT NULL REFERENCES source_records(id),
  override_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX override_latest ON event_overrides(event_id, sequence DESC);
CREATE TABLE historical_prices (
  event_id TEXT PRIMARY KEY REFERENCES source_records(id),
  valuation_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE sync_state (
  product TEXT PRIMARY KEY CHECK(product IN ('checking', 'investments')),
  cursor TEXT,
  coverage_json TEXT NOT NULL,
  lease_id TEXT,
  lease_until TEXT
);
CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY,
  product TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  error_code TEXT
);
CREATE TABLE webhook_receipts (
  digest TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE sync_jobs (
  id TEXT PRIMARY KEY,
  product TEXT NOT NULL CHECK(product IN ('checking', 'investments')),
  requested_at TEXT NOT NULL,
  UNIQUE(product)
);
CREATE TABLE mutation_limits (
  identity TEXT PRIMARY KEY,
  window INTEGER NOT NULL,
  hits INTEGER NOT NULL
);
