-- REVIEW ONLY. Apply after the secure research-queue migration through a controlled release.
-- Keep the migration and migration-ledger entry atomic.
BEGIN;
CREATE TABLE IF NOT EXISTS request_subject_states (
  unitid TEXT NOT NULL, term TEXT NOT NULL, code TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('verified','not_applicable','not_yet_published','publication_date_unknown','not_publicly_available','not_found_official','conflicting','under_review','withheld')),
  source_url TEXT, evidence_quote TEXT, explanation TEXT NOT NULL,
  fingerprint TEXT, last_checked_at TEXT NOT NULL, next_check_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, PRIMARY KEY(unitid,term,code),
  FOREIGN KEY(unitid,term) REFERENCES school_research_jobs(unitid,term)
);
CREATE INDEX IF NOT EXISTS idx_request_subject_recheck ON request_subject_states(next_check_at);
ALTER TABLE school_research_jobs ADD COLUMN IF NOT EXISTS last_checked_at TEXT;
ALTER TABLE school_research_jobs ADD COLUMN IF NOT EXISTS next_check_at TEXT;
ALTER TABLE school_research_jobs ADD COLUMN IF NOT EXISTS material_fingerprint TEXT;
ALTER TABLE school_research_jobs ADD COLUMN IF NOT EXISTS publication_revision INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_school_research_recheck
  ON school_research_jobs(status,last_report_outcome,next_check_at);
ALTER TABLE request_subject_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE request_subject_states FROM anon,authenticated;
-- Keep existing status vocabulary: 'review' means an honest partial first view,
-- not an owner exception. Exception-only queue is represented by unsafe states.
COMMIT;
