-- Add database-level parity with the local schema after
-- 20260928-request-dispatch-timing.sql. Safe on existing NULL rows.
BEGIN;
ALTER TABLE school_requests
  ADD CONSTRAINT school_requests_dispatch_outcome_check
  CHECK (dispatch_outcome IS NULL OR dispatch_outcome IN ('accepted', 'failed'));
COMMIT;
