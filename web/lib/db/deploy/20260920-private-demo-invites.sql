-- VERSIONED POSTGRES MIGRATION: private preview invitations.
-- Run through the reviewed release process, never from application requests.
BEGIN;

CREATE TABLE IF NOT EXISTS demo_invites (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  template_household_id TEXT NOT NULL REFERENCES households(id),
  created_by TEXT NOT NULL,
  created_email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT,
  revoked_email TEXT,
  accepted_at TEXT,
  accepted_by TEXT,
  accepted_email TEXT,
  accepted_household_id TEXT REFERENCES households(id),
  created_at TEXT NOT NULL,
  CHECK (NOT (accepted_at IS NOT NULL AND revoked_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS demo_households (
  household_id TEXT PRIMARY KEY REFERENCES households(id),
  invite_id TEXT NOT NULL UNIQUE REFERENCES demo_invites(id),
  template_household_id TEXT NOT NULL REFERENCES households(id),
  cloned_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_demo_invites_template ON demo_invites(template_household_id);
CREATE INDEX IF NOT EXISTS idx_demo_invites_status ON demo_invites(expires_at, revoked_at, accepted_at);
CREATE INDEX IF NOT EXISTS idx_demo_households_template ON demo_households(template_household_id);

ALTER TABLE demo_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_households ENABLE ROW LEVEL SECURITY;

-- Direct browser/REST access is never part of this feature. Application
-- database credentials bypass RLS; anon/authenticated roles receive nothing.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

COMMIT;
