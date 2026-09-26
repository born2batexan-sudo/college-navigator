// Private demo access-request tables. These statements are mirrored in
// schema.sql for local SQLite and in the reviewed PostgreSQL migration.
// They are server-only: browser roles receive no grants.
export const DEMO_ACCESS_TABLES = [
  "demo_access_requests",
  "demo_access_audit_events",
  "demo_access_notifications",
  "beta_access_invites",
] as const;

export const DEMO_ACCESS_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS beta_access_invites (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE REFERENCES demo_access_requests(id),
  token_hash TEXT NOT NULL UNIQUE,
  cycle TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('complimentary','founding_family')),
  authorized_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  accepted_by TEXT,
  accepted_email TEXT,
  accepted_household_id TEXT REFERENCES households(id) ON DELETE SET NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS demo_access_requests (
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
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_demo_access_active_email
    ON demo_access_requests(requester_email_hash) WHERE status IN ('pending','approved')`,
  `CREATE INDEX IF NOT EXISTS idx_demo_access_requests_status
    ON demo_access_requests(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_demo_access_requests_ip
    ON demo_access_requests(requester_ip_hash, created_at)`,
  `CREATE TABLE IF NOT EXISTS demo_access_audit_events (
  id TEXT PRIMARY KEY,
  request_id TEXT REFERENCES demo_access_requests(id),
  event_type TEXT NOT NULL,
  detail_code TEXT NOT NULL,
  actor_id TEXT,
  actor_email TEXT,
  email_hash TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS idx_demo_access_audit_request
    ON demo_access_audit_events(request_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS demo_access_notifications (
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
)`,
  `CREATE INDEX IF NOT EXISTS idx_demo_access_notifications_state
    ON demo_access_notifications(delivery_state, created_at)`,
];
