-- REVIEW ONLY. Apply after 20260924-owner-foundations.sql through controlled migration.
-- No credentials or enabled feature flag included.
BEGIN;
CREATE TABLE IF NOT EXISTS mail_oauth_attempts (
 state_hash TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
 actor_id TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider IN ('gmail','microsoft')),
 encrypted_verifier TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_oauth_expiry ON mail_oauth_attempts(expires_at);
ALTER TABLE mail_connections ADD COLUMN IF NOT EXISTS retry_after TEXT;
ALTER TABLE mail_oauth_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE mail_oauth_attempts FROM anon,authenticated;
COMMIT;
