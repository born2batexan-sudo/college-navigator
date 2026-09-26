-- W4 deployment migration for an existing Supabase/Postgres database.
-- The app also self-creates these idempotently through ensureAccountSchema,
-- but applying this once before enabling the queue makes the state explicit.
CREATE TABLE IF NOT EXISTS school_directory (
  unitid TEXT PRIMARY KEY, name TEXT NOT NULL, alias TEXT, city TEXT, state TEXT,
  website TEXT, domain TEXT, control TEXT, search_text TEXT NOT NULL,
  institution_id TEXT REFERENCES institutions(id), updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS school_research_jobs (
  unitid TEXT NOT NULL REFERENCES school_directory(unitid), term TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', slug TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  recheck_done INTEGER NOT NULL DEFAULT 0, first_requested_at TEXT NOT NULL,
  started_at TEXT, finished_at TEXT, cost_cents INTEGER NOT NULL DEFAULT 0,
  coverage_pct REAL, note TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (unitid, term)
);
CREATE TABLE IF NOT EXISTS school_requests (
  id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
  person_id TEXT REFERENCES people(id), unitid TEXT NOT NULL REFERENCES school_directory(unitid),
  term TEXT NOT NULL, created_at TEXT NOT NULL, seen_at TEXT, notified_at TEXT,
  UNIQUE(household_id, unitid, term)
);
CREATE TABLE IF NOT EXISTS budget_ledger (
  id TEXT PRIMARY KEY, month TEXT NOT NULL, cents INTEGER NOT NULL, kind TEXT NOT NULL,
  reference TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_school_requests_household ON school_requests(household_id);
CREATE INDEX IF NOT EXISTS idx_school_requests_person ON school_requests(person_id);
CREATE INDEX IF NOT EXISTS idx_school_requests_unitid ON school_requests(unitid);
CREATE INDEX IF NOT EXISTS idx_school_directory_institution ON school_directory(institution_id);
CREATE INDEX IF NOT EXISTS idx_budget_ledger_month ON budget_ledger(month);
ALTER TABLE school_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_research_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_ledger ENABLE ROW LEVEL SECURITY;
