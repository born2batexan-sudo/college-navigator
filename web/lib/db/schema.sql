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
  status TEXT NOT NULL DEFAULT 'unverified',
  confidence TEXT NOT NULL DEFAULT 'low',
  verified_at TEXT,
  source_id TEXT REFERENCES sources(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(institution_id, checkpoint_code)
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
