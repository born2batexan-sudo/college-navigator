-- Versioned hardening migration. Apply with a deployment role before traffic.
BEGIN;
LOCK TABLE rules, school_research_jobs, school_requests, budget_ledger IN ACCESS EXCLUSIVE MODE;

ALTER TABLE rules ADD COLUMN IF NOT EXISTS research_term TEXT NOT NULL DEFAULT 'Fall 2027';
ALTER TABLE rules ADD COLUMN IF NOT EXISTS cycle_state TEXT NOT NULL DEFAULT 'undated';
ALTER TABLE rules ADD COLUMN IF NOT EXISTS applicability TEXT NOT NULL DEFAULT 'applies';
ALTER TABLE rules ADD COLUMN IF NOT EXISTS evidence_quote TEXT;
ALTER TABLE rules DROP CONSTRAINT IF EXISTS rules_institution_id_checkpoint_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS rules_institution_checkpoint_term_key ON rules(institution_id,checkpoint_code,research_term);
ALTER TABLE rules ADD CONSTRAINT rules_cycle_state_check CHECK(cycle_state IN('current','prior','undated')) NOT VALID;
ALTER TABLE rules ADD CONSTRAINT rules_applicability_check CHECK(applicability IN('applies','not_applicable','not_yet_published')) NOT VALID;

CREATE TABLE IF NOT EXISTS research_versions(
 institution_id TEXT NOT NULL REFERENCES institutions(id), research_term TEXT NOT NULL,
 coverage_status TEXT NOT NULL CHECK(coverage_status IN('certified','beta','research','unsupported')),
 coverage_pct REAL NOT NULL CHECK(coverage_pct BETWEEN 0 AND 100), critical_gaps INTEGER NOT NULL CHECK(critical_gaps>=0),
 certified_at TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(institution_id,research_term));

ALTER TABLE school_research_jobs ADD COLUMN IF NOT EXISTS attempt_id TEXT;
ALTER TABLE school_research_jobs ADD COLUMN IF NOT EXISTS lease_expires_at TEXT;
ALTER TABLE school_research_jobs ADD COLUMN IF NOT EXISTS heartbeat_at TEXT;
ALTER TABLE school_research_jobs ADD COLUMN IF NOT EXISTS last_report_outcome TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS school_research_active_attempt_key ON school_research_jobs(attempt_id) WHERE attempt_id IS NOT NULL;

-- Repair deletion semantics without deleting request history.
ALTER TABLE school_requests DROP CONSTRAINT IF EXISTS school_requests_household_id_fkey;
ALTER TABLE school_requests ADD CONSTRAINT school_requests_household_id_fkey FOREIGN KEY(household_id) REFERENCES households(id) ON DELETE CASCADE;
ALTER TABLE school_requests DROP CONSTRAINT IF EXISTS school_requests_person_id_fkey;
ALTER TABLE school_requests ADD CONSTRAINT school_requests_person_id_fkey FOREIGN KEY(person_id) REFERENCES people(id) ON DELETE SET NULL;

-- Replace mutable historical accounting with an append-only conservative
-- ledger. Legacy entries remain charged as reservations; no unknown spend is
-- silently released during migration.
ALTER TABLE budget_ledger RENAME TO budget_ledger_legacy_20260919;
-- PostgreSQL keeps index names when a table is renamed. Free the canonical
-- name before creating the replacement ledger's month index.
ALTER INDEX IF EXISTS idx_budget_ledger_month RENAME TO idx_budget_ledger_legacy_20260919_month;
CREATE TABLE budget_ledger(
 id TEXT PRIMARY KEY, month TEXT NOT NULL, cents INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('reservation','reconciliation')),
 reference TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(kind,reference));
INSERT INTO budget_ledger(id,month,cents,kind,reference,created_at)
 SELECT id,month,GREATEST(cents,0),'reservation',COALESCE(reference,id),created_at
 FROM budget_ledger_legacy_20260919 ON CONFLICT(kind,reference) DO NOTHING;
CREATE INDEX idx_budget_ledger_month ON budget_ledger(month);

-- Public API roles get no direct table access; the server role remains the
-- deliberate trusted boundary and performs household checks.
ALTER TABLE rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_research_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon,authenticated;

COMMIT;
