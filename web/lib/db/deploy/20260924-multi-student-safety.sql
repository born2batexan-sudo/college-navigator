-- Reviewed PostgreSQL migration: multi-student household attestation and
-- respectful human-review hooks. Staging only until owner release approval.
-- No surname, protected-trait, automatic denial, or automatic suspension logic.
BEGIN;

CREATE TABLE IF NOT EXISTS household_purchaser_attestations (
  household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  statement_version TEXT NOT NULL,
  attested_by TEXT NOT NULL,
  attested_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS household_review_flags (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  signal_code TEXT NOT NULL,
  review_state TEXT NOT NULL DEFAULT 'pending' CHECK (review_state IN ('pending','cleared','no_action')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_household_review_flags_queue ON household_review_flags(review_state, created_at);

ALTER TABLE household_purchaser_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_review_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE household_purchaser_attestations, household_review_flags FROM anon, authenticated;

COMMIT;
