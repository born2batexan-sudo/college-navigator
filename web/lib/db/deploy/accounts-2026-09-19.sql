-- VERSIONED POSTGRES MIGRATION. Apply through the reviewed database release
-- process; the app does not create PostgreSQL tables at request time.
-- ensureAccountSchema() validates the completed schema, RLS, and grants and
-- fails closed when the release is incomplete. Safe to run more than once.

CREATE TABLE IF NOT EXISTS auth_links (
  id TEXT PRIMARY KEY,
  auth_user_id TEXT NOT NULL UNIQUE,
  household_id TEXT NOT NULL REFERENCES households(id),
  person_id TEXT REFERENCES people(id),
  role TEXT NOT NULL DEFAULT 'member',
  email TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS household_invites (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  token_hash TEXT NOT NULL UNIQUE,
  invited_role TEXT NOT NULL DEFAULT 'parent',
  created_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  accepted_by TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_links_household ON auth_links(household_id);
CREATE INDEX IF NOT EXISTS idx_household_invites_household ON household_invites(household_id);

-- Supabase exposes every table in the public schema through its REST API to
-- anyone holding the project's public "anon" key. Turning on Row Level
-- Security with no policies closes that door. The app is unaffected because
-- it connects as the table owner, which bypasses RLS.
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE guidance_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE observation_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_invites ENABLE ROW LEVEL SECURITY;
