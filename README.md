# College Navigator — Vertical Slice (Alabama)

This is a working build-out of the College Lifecycle Intelligence Platform described in the
Master Transfer Brief: a household dashboard, a Rules Engine, an Action Ledger, three
standalone AI agents, and a Chrome browser companion skeleton — built end to end for
**University of Alabama** first, per the "prove the loop on one school before replicating"
decision, with the other five pressure-test schools (Arkansas, Oklahoma, UT Austin, Texas
A&M, Arizona) present as institution shells ready for the same agents to fill in.

**Status, honestly:** Alabama is at 29/144 checkpoints (20.1%) independently verified against
real, fetched, dated official sources — which puts it at "Unsupported" under the platform's
own certification gate (Section 8 of the brief: <50% verified). That is correct and expected
for a first pass; it is not a bug to fix before reading further. The Institutional Research
Agent below is what closes the remaining 115 checkpoints, the same way it would for a human
analyst continuing this work.

## What's real vs. what's a stub

| Piece | Status |
|---|---|
| Data model (Household → Student → InstitutionRelationship → Rule → ActionInstance) | Fully implemented, matches Section 6 of the brief |
| Rules Engine (population + trigger + deadline → applicability + priority) | Fully implemented and tested |
| Action Ledger state machine | Fully implemented (Not Started → Started → Submitted → Received → Complete, plus Blocked/Waived/Missed/N-A) |
| Alabama's 144-point checklist | 29 checkpoints verified from 8 real official sources; 115 honestly marked "unverified — queued for research" |
| Household dashboard (Next.js) | Fully working — multi-school action queue, per-school 144-point tracker, action detail with WHAT/WHEN/WHY/HOW/CONSEQUENCE |
| Institutional Research Agent | Fully implemented, calls the real Anthropic API + web search; **not run against a real API key from this build environment** — you provide your own key |
| Guidance Generation Agent | Fully implemented, same caveat |
| Monitoring / Change-Detection Agent | Fully implemented; live fetches to university domains couldn't be exercised from this build environment's network policy — verified everything up to that call |
| Chrome browser companion | Real end-to-end loop (content script → observe endpoint → Action Ledger state change), verified with simulated page content. ASK mode (conversational assistant) is an explicit stub — TRACK and GUIDE are real |
| Live hosting | Not deployed anywhere — this is a repo you run locally or deploy yourself (see below) |

## Repo layout

```
college-navigator/
  web/         Next.js 14 app — dashboard, Rules Engine, Action Ledger, agent-facing API
  agents/      Three standalone Python scripts (call the Anthropic API + web/'s API)
  extension/   Chrome MV3 browser companion (ASK / GUIDE / TRACK side panel)
```

## Running the dashboard

```bash
cd web
npm install
npm run db:seed      # creates web/lib/db/dev.sqlite3 and seeds Alabama + the demo household
npm run dev          # http://localhost:3000
```

No external database, no API keys needed just to see the dashboard — it uses Node 22's
built-in `node:sqlite` (zero native dependencies; see "Why not Prisma" below).

`npm run db:reset` wipes and re-seeds from scratch if you want to start over.

## Why not Prisma

The original build used Prisma, but this environment's network policy blocks
`binaries.prisma.sh` (where Prisma downloads its query-engine binary), and that's a
deliberate organizational policy, not a bug to route around. The data layer was rewritten on
Node 22's built-in `node:sqlite` instead — zero external binaries, same schema
(`web/lib/db/schema.sql`, written as Postgres-compatible DDL). If you hit the same wall in
your own environment, or if you just don't like Prisma, this is why there's no `prisma/`
folder here. If your environment isn't blocked and you'd prefer Prisma or another ORM, the
whole data layer is isolated behind `web/lib/db/repo.ts` — swap `client.ts` and `repo.ts` and
nothing else changes.

## Deploying for real

This was intentionally built as a repo you own and deploy, not something built and hosted
inside this session (no hosting credentials were available here, and putting real family data
on infrastructure this session controls unilaterally would be the wrong call anyway). To take
it to Vercel + Supabase, which is a reasonable free-tier-to-start path:

1. **Database:** create a Supabase (or any Postgres) project. Port `web/lib/db/schema.sql` — it's
   already Postgres-compatible DDL (`TEXT`, `INTEGER`, `REAL` all exist as-is in Postgres; only
   `PRAGMA foreign_keys = ON` in `client.ts` is SQLite-specific and can be dropped). Swap
   `web/lib/db/client.ts` for a `pg` or `@supabase/supabase-js` client, and update
   `web/lib/db/repo.ts`'s SQL calls to use that client's query method instead of
   `db.prepare(...).run/get/all(...)` — the function signatures in `repo.ts` don't need to change,
   only their bodies, so nothing outside that one file needs to know.
2. **App:** push `web/` to a GitHub repo, import it into Vercel, set `DATABASE_URL` and a real
   (long, random) `AGENT_API_KEY` in Vercel's environment variables.
3. **Agents:** run them anywhere with outbound internet and set `APP_BASE_URL` to your deployed
   URL and `AGENT_API_KEY` to the same value you set in Vercel. A cron job, a scheduled GitHub
   Action, or a small always-on box all work — see `agents/README` usage notes below for a sample
   crontab line.
4. **Extension:** update `extension/manifest.json`'s `host_permissions` to include your deployed
   domain instead of `http://localhost:3000`, and change the default `appBaseUrl` in
   `extension/background.js`.
5. Before onboarding a real family: replace the demo household/student in
   `web/lib/db/seed.ts` with a real signup flow, and add real authentication — none exists yet
   (see "What's explicitly not built" below).

## The three agents

All three are in `agents/`, talk to the Anthropic API directly, and read/write the app's
state only through `/api/agent/*` HTTP endpoints (bearer-token authenticated with
`AGENT_API_KEY`) — never touching the database file directly. That means they can run from
anywhere, independent of how or where the app itself is deployed.

```bash
cd agents
pip install -r requirements.txt
cp .env.example .env   # fill in ANTHROPIC_API_KEY, and match AGENT_API_KEY to web/.env
```

**Institutional Research Agent** (`research_agent.py`) — the one that actually grows
coverage. Give it an institution slug; it pulls that school's outstanding checkpoints,
researches each one with Claude's web search tool against official sources, and files a
Rule (status `verified` or an honest `unverified`) plus a Source for every one it touches.

```bash
python research_agent.py --institution arkansas --only-critical   # start with the 56 critical checkpoints
python research_agent.py --institution arkansas                   # then the rest
python research_agent.py --institution alabama --domain "Financial Aid"  # or fill remaining gaps in one Alabama domain
```

**Guidance Generation Agent** (`guidance_agent.py`) — turns verified Rules into the
WHAT/WHEN/WHY/HOW/CONSEQUENCE copy the dashboard shows. Only ever drafts from rules already
`status: verified`; run the research agent first.

```bash
python guidance_agent.py --institution alabama
```

**Monitoring / Change-Detection Agent** (`monitoring_agent.py`) — re-fetches every known
Source, fingerprints its content, and on a real change asks Claude to classify it as
`material` or `cosmetic`, logging a ChangeEvent to the review queue
(`GET /api/agent/change-events`). Run it on a schedule:

```bash
# crontab -e
0 6 * * * cd /path/to/college-navigator/agents && python monitoring_agent.py --institution alabama >> monitor.log 2>&1
```

All three respect the platform's protected admissions-content boundary by construction —
their prompts explicitly forbid reading, storing, or scoring essay/personal-statement content,
and none of them are given any field to put that content in even if they tried.

## The browser companion

`extension/` is a Manifest V3 Chrome extension. To try it locally:

1. Run the dashboard (`npm run dev` in `web/`, so `http://localhost:3000` is up).
2. In Chrome, go to `chrome://extensions`, enable Developer Mode, "Load unpacked", select the
   `extension/` folder.
3. Click the extension icon to open the side panel, then visit a matched Alabama page (anything
   under `admissions.ua.edu`, `housing.sl.ua.edu`, `mybama.ua.edu`, etc.).

TRACK shows the demo household's open Alabama actions; click one to see GUIDE's
WHAT/WHEN/WHY/HOW/CONSEQUENCE. The content script reads the page's own visible text (never
form fields — it cannot see anything typed, essays included, by construction) and reports it
to `/api/companion/observe`; if it matches a known signal (e.g. a housing confirmation page),
the matching ActionInstance's state advances automatically and TRACK refreshes. This is the
brief's own signature demo (Section 7) working for real, not simulated.

ASK is an explicit stub in this build — wiring a conversational assistant grounded in the same
verified Rule data is the natural next step, not done here.

## What's explicitly not built yet

Called out here rather than left implicit, per the brief's own "don't overclaim" instinct:

- **Authentication / multi-tenant accounts.** There's one demo household, seeded directly into
  the database. `lib/companion.ts` says so at the top of the file. Real signup, login, and
  matching a browser session to the right household is the next real engineering milestone
  before this could hold more than one family's data.
- **Email/inbox-based status detection** (the brief's alternative to logging into portals
  directly) — not built. The browser companion's page-observation approach is built instead;
  the two aren't mutually exclusive and the brief treats email reconciliation as a fast-follow.
- **Calendar/ICS export, payment rails, native mobile** — all explicitly out of MVP scope per
  the brief itself (Section 12); not built here either, correctly.
- **The other five pressure-test schools' actual research** — the institutions exist as shells;
  running the Research Agent against each is the immediate next step, not a redesign.

## Verifying this yourself

```bash
cd web && npm run build     # type-checks and builds cleanly
npm run db:seed && npm run dev
# then open http://localhost:3000, click through a few actions,
# and open http://localhost:3000/school/alabama to see the full 144-point tracker
```
