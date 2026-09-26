-- REVIEW ONLY. Apply through reviewed migration process after 20260923.
-- Server role only; no browser/REST grants. Existing rows are not rewritten.
BEGIN;
CREATE TABLE IF NOT EXISTS cycle_orders (
 id TEXT PRIMARY KEY, household_id TEXT REFERENCES households(id) ON DELETE SET NULL, cycle TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('paid','complimentary')),
 price_id TEXT, currency TEXT NOT NULL DEFAULT 'usd', amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
 status TEXT NOT NULL CHECK(status IN ('pending','paid','complimentary','refunded','exception')),
 provider_session_id TEXT UNIQUE, provider_payment_id TEXT UNIQUE, idempotency_key TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK((kind='complimentary' AND amount_cents=0 AND price_id IS NULL) OR kind='paid')
);
CREATE TABLE IF NOT EXISTS cycle_entitlements (
 id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE, cycle TEXT NOT NULL,
 order_id TEXT NOT NULL UNIQUE REFERENCES cycle_orders(id), kind TEXT NOT NULL CHECK(kind IN ('paid','complimentary')),
 starts_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, revoked_by TEXT, reason TEXT,
 authorized_by TEXT NOT NULL, UNIQUE(household_id,cycle)
);
CREATE TABLE IF NOT EXISTS complimentary_invites (
 id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE, cycle TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('complimentary','founding_family')),
 reason TEXT NOT NULL, authorized_by TEXT NOT NULL, expires_at TEXT NOT NULL,
 claimed_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL,
 UNIQUE(household_id,cycle)
);
CREATE TABLE IF NOT EXISTS cycle_accounting_events (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES cycle_orders(id),
 kind TEXT NOT NULL CHECK(kind IN ('payment','refund','discount','complimentary','provider_fee','net_cash','exception')),
 cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'usd', reference TEXT NOT NULL UNIQUE,
 reason TEXT, actor TEXT NOT NULL, created_at TEXT NOT NULL,
 CHECK((kind IN ('payment','provider_fee','discount') AND cents>=0) OR (kind='refund' AND cents<=0) OR (kind='complimentary' AND cents=0) OR kind IN ('net_cash','exception'))
);
CREATE TABLE IF NOT EXISTS cycle_audit_events (
 id TEXT PRIMARY KEY, order_id TEXT REFERENCES cycle_orders(id), household_id TEXT REFERENCES households(id) ON DELETE SET NULL,
 event_type TEXT NOT NULL, reference TEXT NOT NULL UNIQUE, actor TEXT NOT NULL, detail_code TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
 event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('processed','exception')),
 detail_code TEXT NOT NULL, received_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_connections (
 id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
 provider TEXT NOT NULL CHECK(provider IN ('gmail','microsoft')), account_hash TEXT NOT NULL,
 encrypted_tokens TEXT NOT NULL, key_version TEXT NOT NULL, consent_version TEXT NOT NULL,
 consented_by TEXT NOT NULL, consented_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','reconsent','failed','revoked')),
 checkpoint TEXT, last_sync_at TEXT, revoked_at TEXT, delete_after TEXT,
 UNIQUE(household_id,provider,account_hash)
);
CREATE TABLE IF NOT EXISTS mail_sync_events (
 id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES mail_connections(id) ON DELETE CASCADE,
 event_type TEXT NOT NULL, detail_code TEXT NOT NULL, message_digest TEXT,
 created_at TEXT NOT NULL, UNIQUE(connection_id,message_digest)
);
CREATE TABLE IF NOT EXISTS mail_control_audit (
 id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
 event_type TEXT NOT NULL, actor TEXT NOT NULL, detail_code TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS verified_mail_senders (
 id TEXT PRIMARY KEY, institution_id TEXT NOT NULL REFERENCES institutions(id), domain TEXT NOT NULL,
 source_id TEXT NOT NULL REFERENCES sources(id), verified_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
 UNIQUE(institution_id,domain)
);
CREATE TABLE IF NOT EXISTS connected_mail_evidence (
 id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES mail_connections(id) ON DELETE CASCADE,
 household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
 institution_id TEXT NOT NULL REFERENCES institutions(id), sender_domain TEXT NOT NULL,
 message_digest TEXT NOT NULL, observed_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('approved','quarantined')),
 UNIQUE(connection_id,message_digest)
);
CREATE TABLE IF NOT EXISTS assistant_usage (
 id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE, actor_id TEXT NOT NULL,
 created_at TEXT NOT NULL, evidence_count INTEGER NOT NULL, response_code TEXT NOT NULL,
 model_cost_cents INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cycle_orders_household ON cycle_orders(household_id,cycle);
CREATE INDEX IF NOT EXISTS idx_cycle_entitlements_household ON cycle_entitlements(household_id,cycle);
CREATE INDEX IF NOT EXISTS idx_mail_connections_household ON mail_connections(household_id);
CREATE INDEX IF NOT EXISTS idx_assistant_usage_household ON assistant_usage(household_id,created_at);
ALTER TABLE cycle_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycle_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE complimentary_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycle_accounting_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycle_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_control_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE verified_mail_senders ENABLE ROW LEVEL SECURITY;
ALTER TABLE connected_mail_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cycle_orders,cycle_entitlements,complimentary_invites,cycle_accounting_events,cycle_audit_events,stripe_webhook_events,mail_connections,mail_sync_events,mail_control_audit,verified_mail_senders,connected_mail_evidence,assistant_usage FROM anon,authenticated;
COMMIT;
