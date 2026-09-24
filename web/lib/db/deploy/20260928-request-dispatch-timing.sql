-- REVIEW ONLY. Apply after request-queue.sql and 20260926-request-pipeline.sql
-- through the controlled migration process, before enabling the event wake-up.
-- No public grants or RLS bypass. Existing rows remain unmeasured (NULL).
BEGIN;
ALTER TABLE school_requests ADD COLUMN IF NOT EXISTS dispatch_attempted_at TEXT;
ALTER TABLE school_requests ADD COLUMN IF NOT EXISTS dispatch_outcome TEXT;
ALTER TABLE school_requests ADD COLUMN IF NOT EXISTS first_claimed_at TEXT;
ALTER TABLE school_requests ADD COLUMN IF NOT EXISTS first_visible_at TEXT;
ALTER TABLE school_research_jobs ADD COLUMN IF NOT EXISTS first_evidence_committed_at TEXT;
COMMIT;
