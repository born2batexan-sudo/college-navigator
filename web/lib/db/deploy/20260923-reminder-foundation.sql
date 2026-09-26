-- Reviewed PostgreSQL migration: provider-neutral reminder foundation.
-- Staging/dry-run only. No provider account, network delivery, or message body
-- is created by this migration. Apply after the existing account/demo tables.
BEGIN;

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

ALTER TABLE household_reminder_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_delivery_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE household_reminder_preferences, reminder_outbox, reminder_delivery_events FROM anon, authenticated;

COMMIT;
