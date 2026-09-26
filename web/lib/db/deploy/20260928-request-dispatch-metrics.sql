-- REVIEW ONLY. Apply after the request-queue migration and with the matching web release,
-- before enabling the research queue or request dispatch.
-- Durable, nullable timing markers: a wake-up alone is not a claim or a first view.
BEGIN;
ALTER TABLE school_requests ADD COLUMN IF NOT EXISTS dispatch_attempted_at TEXT;
ALTER TABLE school_requests ADD COLUMN IF NOT EXISTS dispatch_outcome TEXT;
ALTER TABLE school_requests ADD COLUMN IF NOT EXISTS first_claimed_at TEXT;
ALTER TABLE school_requests ADD COLUMN IF NOT EXISTS first_visible_at TEXT;
COMMIT;
