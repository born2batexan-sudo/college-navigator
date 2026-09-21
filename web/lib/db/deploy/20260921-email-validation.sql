-- VERSIONED POSTGRES MIGRATION: paid, forwarding-first email validation.
-- Apply after the existing account/request/research and private-demo migrations.
-- Stores normalized evidence and keyed digests only; it does not retain raw
-- email payloads, subjects, bodies, attachments, or mailbox credentials.
-- Owner deletion removes evidence, matches, aliases, and entitlement. The
-- email_status_events ledger is intentionally append-only and retains only
-- deletion/control audit facts; deleted evidence/match references are nulled.

BEGIN;

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
  replay_hash TEXT NOT NULL,
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
-- Replay keys are provider-scoped only within a household. A provider may
-- legitimately reuse the same metadata across separate forwarding aliases.
-- Drop the first-draft single-column constraint if this migration was already
-- applied, then enforce the household-scoped uniqueness invariant.
DO $$
DECLARE
  replay_constraint text;
BEGIN
  SELECT con.conname INTO replay_constraint
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = current_schema()
    AND rel.relname = 'normalized_email_evidence'
    AND con.contype = 'u'
    AND array_length(con.conkey, 1) = 1
    AND EXISTS (
      SELECT 1
      FROM unnest(con.conkey) AS keynum(attnum)
      JOIN pg_attribute attr ON attr.attrelid = rel.oid AND attr.attnum = keynum.attnum
      WHERE attr.attname = 'replay_hash'
    );
  IF replay_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE normalized_email_evidence DROP CONSTRAINT %I', replay_constraint);
  END IF;
END $$;
-- A prior draft may have enforced the same legacy invariant with a standalone
-- unique index rather than a table constraint. Remove only single-column,
-- non-constraint unique indexes whose sole key is replay_hash.
DO $$
DECLARE
  replay_index text;
BEGIN
  FOR replay_index IN
    SELECT idx_rel.relname
    FROM pg_index idx
    JOIN pg_class rel ON rel.oid = idx.indrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_class idx_rel ON idx_rel.oid = idx.indexrelid
    JOIN pg_attribute attr
      ON attr.attrelid = rel.oid
     AND attr.attnum = (idx.indkey::smallint[])[0]
    WHERE nsp.nspname = current_schema()
      AND rel.relname = 'normalized_email_evidence'
      AND idx.indisunique
      AND idx.indnkeyatts = 1
      AND attr.attname = 'replay_hash'
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint con WHERE con.conindid = idx.indexrelid
      )
  LOOP
    EXECUTE format('DROP INDEX %I.%I', current_schema(), replay_index);
  END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_evidence_household_replay ON normalized_email_evidence(household_id, replay_hash);
CREATE INDEX IF NOT EXISTS idx_email_matches_household ON email_task_matches(household_id);
CREATE INDEX IF NOT EXISTS idx_email_status_events_household ON email_status_events(household_id);

ALTER TABLE email_validation_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution_sender_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE normalized_email_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_task_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_status_events ENABLE ROW LEVEL SECURITY;

-- Browser/REST clients receive no direct access. Server-side application roles
-- perform household-scoped authorization and paid-entitlement checks.
REVOKE ALL ON TABLE email_validation_entitlements,intake_aliases,institution_sender_policies,normalized_email_evidence,email_task_matches,email_status_events FROM anon,authenticated;

COMMIT;
