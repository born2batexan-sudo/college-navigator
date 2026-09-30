-- REVIEW CANDIDATE ONLY (staging). Additive; drops/rewrites nothing. Apply through the reviewed
-- migration process after 20260929-payment-test-mode-foundation.sql. NEVER apply to production
-- for this task. NOT EXECUTED against any database in the source-only gate: the Postgres-specific
-- parts (partial unique index, triggers using pg_trigger_depth()) must be verified in staging,
-- including a fictional-household DELETE cascade test, before any reliance.
--
-- Invariants enforced by the database itself (independent of application code):
--   * covered_units <= included_units(10) + purchased_units   (CHECK on the account row)
--   * one coverage row per (household, cycle, canonical college)   (PRIMARY KEY)
--   * a pending purchase can carry no payment/event/provisioned marks   (CHECK)
--   * one capacity grant per purchase   (UNIQUE reference 'addon:<purchase id>')
--   * one pending purchase per household-cycle   (partial unique index)
--   * coverage and capacity history are append-only   (triggers below)
BEGIN;
-- Durable household/cycle canonical-college coverage (review-only; see deploy/20260930-college-coverage.sql).
-- One account row per household-cycle is the lock + capacity anchor. Coverage rows are append-only.
CREATE TABLE IF NOT EXISTS college_coverage_accounts (
 household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
 cycle TEXT NOT NULL CHECK(length(cycle)=9 AND substr(cycle,1,7)='Fall 20'),
 included_units INTEGER NOT NULL DEFAULT 10 CHECK(included_units=10),
 purchased_units INTEGER NOT NULL DEFAULT 0 CHECK(purchased_units>=0 AND purchased_units<=1000),
 covered_units INTEGER NOT NULL DEFAULT 0 CHECK(covered_units>=0),
 addon_hold INTEGER NOT NULL DEFAULT 0 CHECK(addon_hold IN (0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(household_id,cycle),
 CHECK(covered_units<=included_units+purchased_units)
);
CREATE TABLE IF NOT EXISTS college_coverage_colleges (
 household_id TEXT NOT NULL, cycle TEXT NOT NULL,
 college_id TEXT NOT NULL CHECK(length(college_id)>=1 AND length(college_id)<=100),
 source TEXT NOT NULL CHECK(source IN ('included','addon')),
 first_person_id TEXT, first_covered_at TEXT NOT NULL,
 PRIMARY KEY(household_id,cycle,college_id),
 FOREIGN KEY(household_id,cycle) REFERENCES college_coverage_accounts(household_id,cycle) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS college_addon_purchases (
 id TEXT PRIMARY KEY, household_id TEXT REFERENCES households(id) ON DELETE SET NULL,
 cycle TEXT NOT NULL CHECK(length(cycle)=9 AND substr(cycle,1,7)='Fall 20'),
 entitlement_order_id TEXT REFERENCES cycle_orders(id),
 units INTEGER NOT NULL CHECK(units>=1 AND units<=50),
 amount_cents INTEGER NOT NULL CHECK(amount_cents=units*1900),
 currency TEXT NOT NULL DEFAULT 'usd' CHECK(currency='usd'),
 price_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','provisioned','refund_review','exception')),
 provider_session_id TEXT UNIQUE, provider_payment_id TEXT UNIQUE, provider_event_id TEXT UNIQUE,
 refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK(refunded_cents>=0 AND refunded_cents<=amount_cents),
 idempotency_key TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, provisioned_at TEXT,
 CHECK((status='pending' AND provider_payment_id IS NULL AND provider_event_id IS NULL AND provisioned_at IS NULL AND refunded_cents=0)
  OR (status IN ('provisioned','refund_review') AND provider_payment_id IS NOT NULL AND provider_event_id IS NOT NULL AND provisioned_at IS NOT NULL)
  OR status='exception')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_college_addon_one_pending ON college_addon_purchases(household_id,cycle) WHERE status='pending';
CREATE TABLE IF NOT EXISTS college_capacity_events (
 id TEXT PRIMARY KEY, household_id TEXT REFERENCES households(id) ON DELETE SET NULL,
 cycle TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('addon_grant','refund_review','review_release')),
 purchase_id TEXT REFERENCES college_addon_purchases(id),
 units INTEGER NOT NULL DEFAULT 0, amount_cents INTEGER NOT NULL DEFAULT 0,
 reference TEXT NOT NULL UNIQUE, actor TEXT NOT NULL, detail_code TEXT NOT NULL, created_at TEXT NOT NULL,
 CHECK((kind='addon_grant' AND units>0 AND amount_cents>0) OR (kind<>'addon_grant' AND units=0))
);

-- Append-only history. Direct UPDATE/DELETE is refused. pg_trigger_depth() > 1 permits only the
-- referential-action cascades that already exist for household deletion / de-identification.
CREATE OR REPLACE FUNCTION college_coverage_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'college coverage history is append-only (%.%)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'integrity_constraint_violation';
END $fn$;
DROP TRIGGER IF EXISTS college_coverage_colleges_append_only ON college_coverage_colleges;
CREATE TRIGGER college_coverage_colleges_append_only BEFORE UPDATE OR DELETE ON college_coverage_colleges
  FOR EACH ROW EXECUTE FUNCTION college_coverage_append_only();
DROP TRIGGER IF EXISTS college_capacity_events_append_only ON college_capacity_events;
CREATE TRIGGER college_capacity_events_append_only BEFORE UPDATE OR DELETE ON college_capacity_events
  FOR EACH ROW EXECUTE FUNCTION college_coverage_append_only();
REVOKE ALL ON FUNCTION college_coverage_append_only() FROM PUBLIC, anon, authenticated;

ALTER TABLE college_coverage_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE college_coverage_colleges ENABLE ROW LEVEL SECURITY;
ALTER TABLE college_addon_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE college_capacity_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE college_coverage_accounts,college_coverage_colleges,college_addon_purchases,college_capacity_events FROM anon,authenticated;
COMMIT;

