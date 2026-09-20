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
4. `web/lib/db/deploy/20260921-email-validation.sql` after the account/request/research release, exactly once through the migration ledger.

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

`.github/workflows/ci.yml` runs Node 22 install, tests, build, production dependency audit, and Python syntax checks without production secrets. The school-request workflow is intentionally `workflow_dispatch` only. Do not add a schedule until a protected GitHub Environment, reviewer approval, staging PostgreSQL tests, monitoring, and a supervised single-job smoke test are in place.

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
