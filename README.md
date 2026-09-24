# College Navigator

A Next.js application for household-scoped college process, timing, cost, and logistics. The protected-content boundary is unchanged: the application and agents must never read, store, quote, generate, rewrite, or score admissions essays or other substantively evaluated application content.

## Current status

This branch is a **review candidate, not a production-ready release**. It has local SQLite tests and build validation, but production enablement still requires applying and validating the PostgreSQL migrations, RLS/grants, Supabase authentication, and the queue against disposable/staging services. The request worker is manual-only and the server-side `REQUEST_QUEUE_ENABLED=1` kill switch remains required.

## Local development

Use Node 22 and Python 3.12:

```bash
cd web
npm ci
npm test
npm run build
npm run db:seed
npm run dev
```

Without `DATABASE_URL`, local development uses Node's `node:sqlite` and `web/lib/db/schema.sql`. PostgreSQL is the only supported production database.

## Database release process

The application uses a server-only PostgreSQL connection for data and Supabase only for authentication. Do not grant browser roles (`anon` or `authenticated`) direct table access, do not add client-facing RLS policies for the current architecture, and do not give the runtime role DDL privileges. `ensureAccountSchema()` verifies the completed release and fails closed; it never creates PostgreSQL tables.

`web/lib/db/schema.sql` is the canonical SQLite development schema. `web/lib/db/deploy/supabase-setup.sql` is a legacy baseline/seed snapshot and must never be applied by itself or treated as the current security baseline. For the existing production baseline, apply reviewed migrations in this order:

1. `web/lib/db/deploy/accounts-2026-09-19.sql` if the account tables are not already present;
2. `web/lib/db/deploy/request-queue.sql` if the request queue is not already present;
3. `web/lib/db/deploy/20260919-secure-research-queue.sql` last, exactly once through the migration ledger;
4. `web/lib/db/deploy/20260920-private-demo-invites.sql` for the existing private-demo invitation tables, exactly once through the migration ledger;
5. `web/lib/db/deploy/20260921-email-validation.sql` after the account/request/research release, exactly once through the migration ledger;
6. `web/lib/db/deploy/20260922-demo-access-requests.sql` after the private-demo invitation migration, exactly once through the migration ledger;
7. `web/lib/db/deploy/20260923-reminder-foundation.sql` after the account/demo/request release, exactly once through the migration ledger.

Reminder delivery is provider-neutral and dry-run by default. The reminder foundation
stores no message body and performs no network delivery. A future reviewed adapter
must additionally require `REMINDER_PRODUCTION_DELIVERY_ENABLED=1`; leaving that
variable unset (the default) rejects non-dry-run recipient mode. Applying the
migration alone does not enable delivery or create a provider account.

For a brand-new production database, first generate and review a current baseline from the canonical schema and seed requirements; do not improvise from the legacy snapshot. Before traffic, verify every expected table exists, RLS is enabled, `anon`/`authenticated` have no grants, the server runtime role can perform required queries, and two-household isolation passes against PostgreSQL. The staging migration and integrity checks have been exercised; production remains intentionally unmigrated while this pull request is a draft.

## Authentication and machine credentials

Supabase Auth provides household sign-in. Agent credentials are deliberately split:

- `AGENT_API_KEY`: general monitoring/guidance endpoints;
- `RESEARCH_WRITER_API_KEY`: institution/source/rule research writes;
- `QUEUE_AGENT_API_KEY`: queue claim/report only;
- `DIRECTORY_IMPORT_API_KEY`: IPEDS directory import/search only.

Set distinct long random values in the web runtime and the relevant worker environment. Also configure `DATABASE_URL`, Supabase values, and conservative queue settings documented in `web/.env.example`. A research attempt receives an opaque attempt id, a lease, and a maximum dollar reservation. Unknown actual cost keeps the full reservation charged.

## Research integrity

Research records are keyed by institution, checkpoint, and entering term. Verified and structured waiting/not-applicable states require:

- a source owned by the same institution;
- an HTTPS source host on the institution's approved domain allow-list;
- a supporting evidence quote;
- explicit cycle and applicability state.

Coverage and queue readiness are computed from the exact term version. Queue-created school routes remain unavailable unless the signed-in household requested that exact term and the matching job and research version are both ready/certified.

## Workflows

`.github/workflows/ci.yml` runs Node 22 install, tests, build, production dependency audit, and Python syntax checks without production secrets. The school-request workflow now includes a default-off five-minute recovery poll and a default-off server-side event wake-up for new committed requests. Neither has been activated or exercised. Review the protected GitHub Environment, Actions-write dispatch credential, migrations, staging PostgreSQL tests, monitoring, and a supervised single-job smoke test before enabling; see `REQUEST_PIPELINE.md`. No first-view SLA is promised.

## Browser companion

The unauthenticated demo companion routes are disabled in production and are no longer public middleware exceptions. Extension authentication remains future work.

## Agents

```bash
cd agents
python -m pip install -r requirements.txt
cp .env.example .env
python research_agent.py --institution example --domains example.edu --term "Fall 2027"
```

The research agent refuses an empty domain allow-list and writes term/cycle/applicability/evidence fields through the scoped API. Paid agent calls were not made during this hardening work.

## Paid forwarding-first email validation (closed loop)

Email validation is intentionally forwarding-first and provider-neutral. There
is no OAuth, IMAP, mailbox credential, inbox search, or public unauthenticated
intake route. A household owner must explicitly consent while the household is
in an active `trial` or `paid` entitlement. The app can then issue one private
revocable/rotatable forwarding alias; only a SHA-256 alias digest is persisted.
Configure only the non-secret `EMAIL_FORWARDING_DOMAIN` and keep
`EMAIL_VALIDATION_REPLAY_SECRET` in the deployment secret store.

A future inbound adapter passes normalized evidence and authentication results
through `web/lib/db/email-validation.ts`. Curated institution sender policies
are exact hostnames under the institution's approved domains; generic `.edu`
matching is never used. Only authenticated-original evidence with an exact
institution, applicant, entering-term, checkpoint, and unique action match may
make the legal monotonic `submitted -> received` or `received -> complete`
transition. Forward/ARC evidence creates a suggestion. Quoted, unauthenticated,
domain-mismatched, ambiguous, unsupported, or illegal evidence is quarantined
with an append-only decision event. No deadline/payment/research record is
changed, and demo/template households are excluded.

The reviewed PostgreSQL migration is
`web/lib/db/deploy/20260921-email-validation.sql`; apply it only through the
reviewed release process after the existing migrations. Local SQLite picks up
the matching definitions from `web/lib/db/schema.sql`. The library also
provides pause, revoke, rotation, deletion, and dry-run normalized-ingestion
controls. Raw message material and sender local-parts are deliberately not
part of the schema.

## Public marketing and approved access (not deployed)

`/`, `/sample-plan`, `/login`, and `/request-access` stay public, including for
signed-in users. `/request-access` accepts a name, email, and explicit consent
and returns a generic acknowledgement for valid, duplicate, and throttled
submissions. Every product page and server action checks fresh server-side
access: the authenticated `DEMO_OWNER_EMAIL`, an unexpired and unrevoked
household `cycle_entitlements` row, or an accepted, still-approved private
preview invitation claimed by the exact request email and auth user. A signed-in
user without access is sent to `/request-access`; JSON product endpoints return
403. Invitation acceptance is a narrow exception so an unapproved user can
claim an approved invitation. The seven-day private-preview invitation expiry
also ends that preview's product access, even after claim; owner revocation
ends it immediately. Complimentary grants retain their own expiration and
revocation; no payment, inbox capture, Ask model, or research integration is
enabled by this access gate. Agent routes use independent machine keys and normally return 404 in
production. Only scoped queue routes can be enabled by all three reviewed
server flags (`REQUEST_QUEUE_ENABLED`, `REQUEST_PIPELINE_ENABLED`,
`RESEARCH_API_ENABLED`); other research routes remain unavailable.

Required for the production access boundary: `DATABASE_URL` (server-only
PostgreSQL connection), `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase auth), `APP_ORIGIN` (exact canonical
HTTPS origin with no trailing slash, registered in Supabase redirect allowlist),
`DEMO_OWNER_EMAIL` (the owner's verified sign-in email),
`DEMO_TEMPLATE_HOUSEHOLD_ID` (existing immutable, onboarded template
household), and `REQUEST_ACCESS_HASH_SECRET` (unique random secret, at least
32 bytes). Set `ACCESS_CYCLE="Fall 2027"` when using the owner-only
complimentary grant controls; each student's `enteringTerm` must match.
Local-only `AUTH_DEV_LOGIN=1` cannot be used in production. For reviewed
outbound mail, set both `RESEND_API_KEY` and `DEMO_EMAIL_FROM` to a verified
sender; optionally set `DEMO_EMAIL_REPLY_TO`. Without both, messages remain
`queued_no_provider`; the owner must securely share the one-time invitation
URL shown at approval. Approval tokens are never stored in the outbox, so a
failed delivery cannot be retried from the queue without a new issuance flow.
All generated callback, invitation and notification URLs use `APP_ORIGIN`,
never forwarded Host headers. Configure production secrets in the deployment
secret manager, not in source control.

Apply the reviewed `20260924-multi-student-safety.sql` and
`20260924-owner-foundations.sql` migrations after the earlier numbered
migrations, then verify Postgres RLS/grants and auth/entitlement behavior on
staging before any traffic. The local SQLite schema already contains the
required tables; this slice adds no migration. Do not switch on
`STRIPE_REVIEW_ENABLED`, `ASSISTANT_MODEL_ENABLED`, inbound mail adapters, or
research workers as part of this release.

## Net-new request research (subsequent review-only work)

See [REQUEST_PIPELINE.md](REQUEST_PIPELINE.md) for the default-off 12-lane
first-view design, exact-term evidence states, separate
`20260926-request-pipeline.sql` migration, security/cost controls, and the
unperformed 60-school live-provider benchmark. The new partial view is not
certification; no migrations or enablement were performed here.
