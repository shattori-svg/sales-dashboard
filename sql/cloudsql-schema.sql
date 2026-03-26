-- Cloud SQL (PostgreSQL) schema for sales-dashboard
-- Target: production environment with DB_PROVIDER=postgres

CREATE TABLE IF NOT EXISTS reports (
  store_id TEXT NOT NULL DEFAULT 'default',
  business_date TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_final BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (store_id, business_date)
);

-- Migration: add is_final if upgrading from older schema
ALTER TABLE reports ADD COLUMN IF NOT EXISTS is_final BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS masters (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  preferred_store TEXT,
  preferred_department TEXT,
  preferred_currency TEXT,
  preferred_language TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_store_business_date ON reports (store_id, business_date DESC);
