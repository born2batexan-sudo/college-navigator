-- College Lifecycle Intelligence Platform — canonical data model.
-- Mirrors the entity model in the Master Transfer Brief (Section 6).
--
-- This is the canonical local-development schema for Node's built-in
-- node:sqlite (see lib/db/client.ts). Production already uses PostgreSQL and
-- must be changed only through reviewed files in lib/db/deploy; do not apply
-- this SQLite bootstrap directly to Supabase. See README.md.

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
-- PostgreSQL receives these tables through reviewed migrations.
-- ensureAccountSchema validates the release at runtime and fails closed.
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

-- Private-preview access is server-issued only. The raw bearer secret is
-- deliberately never stored: token_hash is SHA-256(token).
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
  access_request_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS demo_households (
  household_id TEXT PRIMARY KEY REFERENCES households(id),
  invite_id TEXT NOT NULL UNIQUE REFERENCES demo_invites(id),
  template_household_id TEXT NOT NULL REFERENCES households(id),
  cloned_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_demo_invites_template ON demo_invites(template_household_id);
CREATE INDEX IF NOT EXISTS idx_demo_invites_access_request ON demo_invites(access_request_id);

-- ---------------------------------------------------------------------
-- Private demo access requests. Raw request details are server-only; the
-- browser receives only a generic acknowledgement. Invitation bearer tokens
-- remain hash-only and are never stored in the notification queue.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo_access_requests (
  id TEXT PRIMARY KEY,
  requester_name TEXT NOT NULL,
  requester_email TEXT NOT NULL,
  requester_email_hash TEXT NOT NULL,
  requester_ip_hash TEXT,
  consent_version TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','revoked')),
  invite_id TEXT REFERENCES demo_invites(id),
  decided_at TEXT,
  decided_by TEXT,
  decided_email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_demo_access_active_email
  ON demo_access_requests(requester_email_hash) WHERE status IN ('pending','approved');
CREATE INDEX IF NOT EXISTS idx_demo_access_requests_status
  ON demo_access_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_demo_access_requests_ip
  ON demo_access_requests(requester_ip_hash, created_at);

CREATE TABLE IF NOT EXISTS demo_access_audit_events (
  id TEXT PRIMARY KEY,
  request_id TEXT REFERENCES demo_access_requests(id),
  event_type TEXT NOT NULL,
  detail_code TEXT NOT NULL,
  actor_id TEXT,
  actor_email TEXT,
  email_hash TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_demo_access_audit_request
  ON demo_access_audit_events(request_id, created_at);

CREATE TABLE IF NOT EXISTS demo_access_notifications (
  id TEXT PRIMARY KEY,
  request_id TEXT REFERENCES demo_access_requests(id),
  invite_id TEXT REFERENCES demo_invites(id),
  kind TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  delivery_state TEXT NOT NULL DEFAULT 'queued_no_provider' CHECK (delivery_state IN ('queued_no_provider','queued','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE(request_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_demo_access_notifications_state
  ON demo_access_notifications(delivery_state, created_at);

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

-- ---------------------------------------------------------------------
-- Paid, forwarding-first email validation. Only normalized evidence and
-- keyed digests are retained; the schema has no unneeded payload fields.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_validation_entitlements (
  household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  entitlement_state TEXT NOT NULL DEFAULT 'trial' CHECK (entitlement_state IN ('trial','paid','inactive','past_due')),
  owner_consent INTEGER NOT NULL DEFAULT 0 CHECK (owner_consent IN (0,1)),
  consented_by TEXT,
  consented_at TEXT,
  paused_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS intake_aliases (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  alias_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','rotated')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT
);

CREATE TABLE IF NOT EXISTS institution_sender_policies (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  sender_domain TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  curated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE(institution_id, sender_domain)
);

CREATE TABLE IF NOT EXISTS normalized_email_evidence (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  alias_id TEXT REFERENCES intake_aliases(id) ON DELETE SET NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  applicant_id TEXT,
  entering_term TEXT NOT NULL,
  checkpoint_code TEXT NOT NULL,
  sender_domain TEXT NOT NULL,
  provenance_class TEXT NOT NULL CHECK (provenance_class IN ('authenticated_original','forwarded_arc','quoted_sender','unknown')),
  authentication_result TEXT NOT NULL CHECK (authentication_result IN ('authenticated','failed','unknown')),
  signal TEXT NOT NULL CHECK (signal IN ('received','complete','other')),
  replay_hash TEXT NOT NULL UNIQUE,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_task_matches (
  id TEXT PRIMARY KEY,
  evidence_id TEXT NOT NULL UNIQUE REFERENCES normalized_email_evidence(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  action_id TEXT REFERENCES action_instances(id) ON DELETE SET NULL,
  match_status TEXT NOT NULL CHECK (match_status IN ('applied','suggestion','quarantined','replay_suppressed')),
  reason_code TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_status_events (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  evidence_id TEXT REFERENCES normalized_email_evidence(id) ON DELETE SET NULL,
  match_id TEXT REFERENCES email_task_matches(id) ON DELETE SET NULL,
  action_id TEXT REFERENCES action_instances(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  observed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_intake_aliases_household ON intake_aliases(household_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_intake_alias ON intake_aliases(household_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_sender_policies_institution ON institution_sender_policies(institution_id);
CREATE INDEX IF NOT EXISTS idx_email_evidence_household ON normalized_email_evidence(household_id);
CREATE INDEX IF NOT EXISTS idx_email_matches_household ON email_task_matches(household_id);
CREATE INDEX IF NOT EXISTS idx_email_status_events_household ON email_status_events(household_id);

-- ---------------------------------------------------------------------
-- Provider-neutral reminder foundation (staging only; no message body or
-- provider credentials are stored here). Outbox rows are retained and their
-- delivery state is accompanied by an append-only event ledger.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS household_reminder_preferences (
  household_id TEXT PRIMARY KEY REFERENCES households(id),
  reminders_enabled INTEGER NOT NULL DEFAULT 1 CHECK (reminders_enabled IN (0, 1)),
  quiet_hours_start TEXT NOT NULL DEFAULT '21:00',
  quiet_hours_end TEXT NOT NULL DEFAULT '08:00',
  delivery_mode TEXT NOT NULL DEFAULT 'staging_dry_run' CHECK (delivery_mode IN ('staging_dry_run', 'approved_recipient')),
  staging_dry_run INTEGER NOT NULL DEFAULT 1 CHECK (staging_dry_run IN (0, 1)),
  approved_recipient TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminder_outbox (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  action_instance_id TEXT NOT NULL REFERENCES action_instances(id),
  rule_id TEXT NOT NULL REFERENCES rules(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  recipient_address TEXT,
  delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('staging_dry_run', 'approved_recipient')),
  staging_dry_run INTEGER NOT NULL CHECK (staging_dry_run IN (0, 1)),
  approved_recipient TEXT,
  timezone TEXT NOT NULL,
  scheduled_for_local TEXT NOT NULL,
  due_at TEXT NOT NULL,
  direct_action_path TEXT NOT NULL,
  delivery_state TEXT NOT NULL DEFAULT 'queued' CHECK (delivery_state IN ('queued', 'sent', 'delivered', 'bounced', 'complained', 'suppressed', 'failed', 'canceled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  next_attempt_at TEXT,
  last_error TEXT,
  cancellation_reason TEXT,
  action_due_at_snapshot TEXT,
  rule_updated_at_snapshot TEXT NOT NULL,
  research_term_snapshot TEXT NOT NULL,
  source_id_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminder_outbox_due ON reminder_outbox(delivery_state, due_at);
CREATE INDEX IF NOT EXISTS idx_reminder_outbox_household ON reminder_outbox(household_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reminder_outbox_action ON reminder_outbox(action_instance_id, delivery_state);

CREATE TABLE IF NOT EXISTS reminder_delivery_events (
  id TEXT PRIMARY KEY,
  reminder_outbox_id TEXT NOT NULL REFERENCES reminder_outbox(id),
  event_state TEXT NOT NULL CHECK (event_state IN ('queued', 'sent', 'delivered', 'bounced', 'complained', 'suppressed', 'failed', 'canceled')),
  attempt_number INTEGER NOT NULL DEFAULT 0 CHECK (attempt_number >= 0),
  provider_event_id TEXT,
  detail_code TEXT,
  occurred_at TEXT NOT NULL,
  UNIQUE(reminder_outbox_id, provider_event_id)
);
CREATE INDEX IF NOT EXISTS idx_reminder_delivery_events_outbox ON reminder_delivery_events(reminder_outbox_id, occurred_at);

