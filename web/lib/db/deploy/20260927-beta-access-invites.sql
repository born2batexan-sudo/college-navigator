-- REVIEW ONLY. Apply after demo-access and owner-foundations migrations, before release.
BEGIN;
CREATE TABLE IF NOT EXISTS beta_access_invites (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE REFERENCES demo_access_requests(id),
  token_hash TEXT NOT NULL UNIQUE,
  cycle TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('complimentary','founding_family')),
  authorized_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  accepted_by TEXT,
  accepted_email TEXT,
  accepted_household_id TEXT REFERENCES households(id) ON DELETE SET NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_beta_access_household ON beta_access_invites(accepted_household_id);
CREATE INDEX IF NOT EXISTS idx_beta_access_expiry ON beta_access_invites(expires_at);
ALTER TABLE beta_access_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE beta_access_invites FROM anon,authenticated;
COMMIT;
