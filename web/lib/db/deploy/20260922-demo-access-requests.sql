-- VERSIONED POSTGRES MIGRATION: private CampusPassage demo access requests.
-- Apply after 20260920-private-demo-invites.sql and before enabling the public
-- request page. This migration creates no browser-facing grants or policies.
BEGIN;

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

-- Existing invitation rows remain hash-only. The nullable link lets the
-- owner audit which invitation resulted from an access request.
ALTER TABLE demo_invites ADD COLUMN IF NOT EXISTS access_request_id TEXT REFERENCES demo_access_requests(id);
CREATE INDEX IF NOT EXISTS idx_demo_invites_access_request ON demo_invites(access_request_id);

ALTER TABLE demo_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_access_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_access_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

COMMIT;
