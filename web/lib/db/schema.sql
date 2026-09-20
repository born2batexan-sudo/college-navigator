-- College Lifecycle Intelligence Platform — canonical data model.
-- Mirrors the entity model in the Master Transfer Brief (Section 6).
--
-- This runs on Node's built-in node:sqlite for local dev (zero external
-- dependencies — see lib/db/client.ts). To move to Postgres for production
-- (e.g. Supabase), port this DDL 1:1 (types map directly: TEXT, INTEGER,
-- REAL all exist in Postgres) and swap lib/db/client.ts's driver; every
-- other file in the app only calls the functions in lib/db/repo.ts, so the
-- migration is contained to those two files. See README.md.

CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  sub_state TEXT NOT NULL DEFAULT 'trial',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  consent_state TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  grad_year INTEGER NOT NULL,
  applicant_type TEXT NOT NULL DEFAULT 'freshman',
  residency TEXT NOT NULL DEFAULT 'unknown',
  attributes TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS institutions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  domains TEXT NOT NULL DEFAULT '[]',
  pathway TEXT NOT NULL DEFAULT 'both',
  coverage_status TEXT NOT NULL DEFAULT 'research',
  coverage_pct REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS institution_relationships (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  lifecycle_state TEXT NOT NULL DEFAULT 'considering',
  decision_date TEXT,
  commit_date TEXT,
  -- Per-school questionnaire answers (housing plan, Greek interest, bringing
  -- a car, disability accommodation) — same shape/convention as
  -- students.attributes, but scoped to this one school, since a family's
  -- answers legitimately differ school to school. See rules-engine.ts,
  -- which merges this over the student-level attributes as a fallback.
  attributes TEXT NOT NULL DEFAULT '{}',
  -- Soft-remove flag: when a household stops tracking a school it flips to
  -- 0 rather than deleting the row, so the underlying 144-point tracker and
  -- action history are preserved untouched and re-tracking resumes exactly
  -- where it left off. 1/0 (not a native boolean) to match this schema's
  -- existing convention (see rules.critical) so the same DDL runs
  -- unmodified on both SQLite (local dev) and Postgres (production).
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(student_id, institution_id)
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  url TEXT NOT NULL,
  label TEXT NOT NULL,
  authority_level TEXT NOT NULL DEFAULT 'official',
  owner TEXT,
  last_verified TEXT,
  fingerprint TEXT,
  last_content TEXT, -- extracted page text as of the last check, so the monitoring agent can diff old vs new, not just detect that something changed
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  checkpoint_code TEXT NOT NULL,
  domain TEXT NOT NULL,
  title TEXT NOT NULL,
  critical INTEGER NOT NULL DEFAULT 0,
  population TEXT NOT NULL DEFAULT 'all',
  requirement TEXT NOT NULL,
  trigger_state TEXT,
  depends_on_code TEXT,
  deadline_expr TEXT,
  actor TEXT NOT NULL DEFAULT 'student',
  cost_cents INTEGER,
  refundable TEXT NOT NULL DEFAULT 'unknown',
  consequence TEXT,
  status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('verified','unverified')),
  confidence TEXT NOT NULL DEFAULT 'low' CHECK (confidence IN ('high','medium','low')),
  research_term TEXT NOT NULL DEFAULT 'Fall 2027',
  cycle_state TEXT NOT NULL DEFAULT 'undated' CHECK (cycle_state IN ('current','prior','undated')),
  applicability TEXT NOT NULL DEFAULT 'applies' CHECK (applicability IN ('applies','not_applicable','not_yet_published')),
  evidence_quote TEXT,
  verified_at TEXT,
  source_id TEXT REFERENCES sources(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(institution_id, checkpoint_code, research_term)
);

-- Coverage is a property of an immutable research cycle, never of an
-- institution in the abstract. The legacy institution coverage columns are
-- retained only for curated data compatibility.
CREATE TABLE IF NOT EXISTS research_versions (
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  research_term TEXT NOT NULL,
  coverage_status TEXT NOT NULL CHECK (coverage_status IN ('certified','beta','research','unsupported')),
  coverage_pct REAL NOT NULL CHECK (coverage_pct >= 0 AND coverage_pct <= 100),
  critical_gaps INTEGER NOT NULL CHECK (critical_gaps >= 0),
  certified_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (institution_id, research_term)
);

CREATE TABLE IF NOT EXISTS guidance_assets (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL UNIQUE REFERENCES rules(id),
  what TEXT NOT NULL,
  when_text TEXT NOT NULL,
  why TEXT NOT NULL,
  how TEXT NOT NULL,
  consequence TEXT NOT NULL,
  deep_link TEXT,
  generated_by TEXT NOT NULL DEFAULT 'guidance_agent',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS observation_patterns (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  workflow TEXT NOT NULL,
  url_pattern TEXT NOT NULL,
  signal TEXT NOT NULL,
  implies_state TEXT NOT NULL,
  related_checkpoint_code TEXT, -- which Rule this signal is evidence for, so an observed match can advance a specific ActionInstance
  confidence_threshold REAL NOT NULL DEFAULT 0.7,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS action_instances (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL REFERENCES institution_relationships(id),
  rule_id TEXT NOT NULL REFERENCES rules(id),
  due_at TEXT,
  applicability_reason TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  state TEXT NOT NULL DEFAULT 'not_started',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(relationship_id, rule_id)
);

CREATE TABLE IF NOT EXISTS action_events (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL REFERENCES action_instances(id),
  event_type TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  actor_type TEXT NOT NULL DEFAULT 'system',
  evidence_ref TEXT,
  observed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS change_events (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  detected_at TEXT NOT NULL,
  materiality TEXT NOT NULL DEFAULT 'unclassified',
  old_fingerprint TEXT,
  new_fingerprint TEXT,
  summary TEXT,
  review_state TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_rules_institution ON rules(institution_id);
CREATE INDEX IF NOT EXISTS idx_action_instances_relationship ON action_instances(relationship_id);
CREATE INDEX IF NOT EXISTS idx_action_events_action ON action_events(action_id);
CREATE INDEX IF NOT EXISTS idx_sources_institution ON sources(institution_id);

-- ---------------------------------------------------------------------
-- Accounts (added 2026-09-19, workstream W1: real sign-in).
-- auth_links ties one signed-in identity (a Supabase Auth user id, or a
-- local dev id) to exactly one household. Every household-scoped read in
-- the app starts from this table; see lib/db/accounts.ts.
-- These two tables are also created automatically on first sign-in
-- (ensureAccountSchema) so production needs no manual SQL step.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- Request a school queue (W4). The directory is keyed by federal UnitID;
-- research is shared by families but requests remain household-scoped.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS school_directory (
  unitid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  alias TEXT,
  city TEXT,
  state TEXT,
  website TEXT,
  domain TEXT,
  control TEXT,
  search_text TEXT NOT NULL,
  institution_id TEXT REFERENCES institutions(id),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS school_research_jobs (
  unitid TEXT NOT NULL REFERENCES school_directory(unitid),
  term TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','ready','review')),
  slug TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 3),
  attempt_id TEXT,
  lease_expires_at TEXT,
  heartbeat_at TEXT,
  last_report_outcome TEXT,
  recheck_done INTEGER NOT NULL DEFAULT 0 CHECK (recheck_done IN (0,1)),
  first_requested_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  coverage_pct REAL,
  note TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (unitid, term)
);

CREATE TABLE IF NOT EXISTS school_requests (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  unitid TEXT NOT NULL REFERENCES school_directory(unitid),
  term TEXT NOT NULL,
  created_at TEXT NOT NULL,
  seen_at TEXT,
  notified_at TEXT,
  UNIQUE(household_id, unitid, term)
);

-- Append-only accounting. A positive reservation is always written before
-- work. A terminal reconciliation may only reduce it; unknown actual cost
-- deliberately leaves the full conservative reservation charged.
CREATE TABLE IF NOT EXISTS budget_ledger (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL,
  cents INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('reservation','reconciliation')),
  reference TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(kind, reference)
);

CREATE INDEX IF NOT EXISTS idx_school_requests_household ON school_requests(household_id);
CREATE INDEX IF NOT EXISTS idx_school_requests_person ON school_requests(person_id);
CREATE INDEX IF NOT EXISTS idx_school_requests_unitid ON school_requests(unitid);
CREATE INDEX IF NOT EXISTS idx_school_directory_institution ON school_directory(institution_id);
CREATE INDEX IF NOT EXISTS idx_budget_ledger_month ON budget_ledger(month);

