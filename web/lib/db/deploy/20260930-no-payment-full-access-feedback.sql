-- Apply only after the existing owner foundations, beta invitations and college coverage migrations.
-- Forward-only, staging-safe. App must fail closed until this migration and runtime RLS checks pass.
BEGIN;
CREATE TABLE IF NOT EXISTS self_service_access (
 household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
 cycle TEXT NOT NULL CHECK (cycle ~ '^Fall 20[0-9]{2}$'),
 auth_user_id TEXT NOT NULL,
 starts_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL,
 revoked_at TEXT,
 CHECK (expires_at > starts_at)
);
CREATE TABLE IF NOT EXISTS household_feedback (
 id TEXT PRIMARY KEY,
 household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
 auth_user_id TEXT NOT NULL,
 rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
 feedback_text TEXT NOT NULL CHECK (length(feedback_text) BETWEEN 1 AND 4000),
 follow_up_consent INTEGER NOT NULL DEFAULT 0 CHECK (follow_up_consent IN (0,1)),
 testimonial_consent INTEGER NOT NULL DEFAULT 0 CHECK (testimonial_consent IN (0,1)),
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_household_feedback_household ON household_feedback(household_id,created_at);
CREATE INDEX IF NOT EXISTS idx_household_feedback_created ON household_feedback(created_at);
ALTER TABLE self_service_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE self_service_access,household_feedback FROM PUBLIC,anon,authenticated;
COMMIT;
