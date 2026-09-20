import { exec, newId, nowIso, queryOne, queryRows } from "./client";
import type { Institution } from "./types";
import { isStartTerm, RESEARCHED_TERM } from "@/lib/terms";

/** Queue schema is deliberately kept in a separate module so the agent and the
 * signed-in app share the same idempotent DDL. accounts.ts includes these
 * statements in its first-sign-in bootstrap. */
export const REQUEST_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS school_directory (
  unitid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  alias TEXT,
  city TEXT,
  state TEXT,
  website TEXT,
  domain TEXT,
  control TEXT,
  search_text TEXT NOT NULL,
  institution_id TEXT REFERENCES institutions(id),
  updated_at TEXT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS school_research_jobs (
  unitid TEXT NOT NULL REFERENCES school_directory(unitid),
  term TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  slug TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  recheck_done INTEGER NOT NULL DEFAULT 0,
  first_requested_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  coverage_pct REAL,
  note TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (unitid, term)
)`,
  `CREATE TABLE IF NOT EXISTS school_requests (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  person_id TEXT REFERENCES people(id),
  unitid TEXT NOT NULL REFERENCES school_directory(unitid),
  term TEXT NOT NULL,
  created_at TEXT NOT NULL,
  seen_at TEXT,
  notified_at TEXT,
  UNIQUE(household_id, unitid, term)
)`,
  `CREATE TABLE IF NOT EXISTS budget_ledger (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL,
  cents INTEGER NOT NULL,
  kind TEXT NOT NULL,
  reference TEXT,
  created_at TEXT NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS idx_school_requests_household ON school_requests(household_id)`,
  `CREATE INDEX IF NOT EXISTS idx_school_directory_institution ON school_directory(institution_id)`,
  `CREATE INDEX IF NOT EXISTS idx_budget_ledger_month ON budget_ledger(month)`,
];

export const REQUEST_TABLES = ["school_directory", "school_research_jobs", "school_requests", "budget_ledger"] as const;
export const REQUEST_QUEUE_ENABLED = process.env.REQUEST_QUEUE_ENABLED === "1";
export const DEFAULT_MONTHLY_BUDGET_CENTS = 1600;
export const DEFAULT_JOB_ESTIMATE_CENTS = 800;
export const MAX_FAMILY_REQUESTS_PER_MONTH = 3;

export type DirectorySchool = {
  unitid: string; name: string; alias: string | null; city: string | null; state: string | null;
  website: string | null; domain: string | null; control: string | null; institutionId: string | null; updatedAt: string;
};
export type ResearchJob = {
  unitid: string; term: string; status: string; slug: string | null; attempts: number; recheckDone: boolean;
  firstRequestedAt: string; startedAt: string | null; finishedAt: string | null; costCents: number;
  coveragePct: number | null; note: string | null; updatedAt: string;
};
export type SchoolRequest = {
  id: string; householdId: string; personId: string | null; unitid: string; term: string; createdAt: string;
  seenAt: string | null; notifiedAt: string | null; school: DirectorySchool; job: ResearchJob | null;
  institution: Pick<Institution, "id" | "name" | "slug" | "coverageStatus" | "coveragePct"> | null;
};

const toDirectory = (r: any): DirectorySchool => ({
  unitid: String(r.unitid), name: r.name, alias: r.alias ?? null, city: r.city ?? null, state: r.state ?? null,
  website: r.website ?? null, domain: r.domain ?? null, control: r.control ?? null,
  institutionId: r.institution_id ?? null, updatedAt: r.updated_at,
});
const toJob = (r: any): ResearchJob => ({
  unitid: String(r.unitid), term: String(r.term), status: r.status, slug: r.slug ?? null, attempts: Number(r.attempts ?? 0),
  recheckDone: !!r.recheck_done, firstRequestedAt: r.first_requested_at, startedAt: r.started_at ?? null,
  finishedAt: r.finished_at ?? null, costCents: Number(r.cost_cents ?? 0), coveragePct: r.coverage_pct == null ? null : Number(r.coverage_pct),
  note: r.note ?? null, updatedAt: r.updated_at,
});

// The internal search_text column is intentionally not part of the public type.
export async function searchDirectory(query: string, limit = 20): Promise<DirectorySchool[]> {
  const q = query.trim().toLowerCase().slice(0, 100);
  if (q.length < 2) return [];
  const n = Math.max(1, Math.min(50, Math.floor(limit)));
  const rows = await queryRows<any>(
    "SELECT unitid,name,alias,city,state,website,domain,control,institution_id,updated_at FROM school_directory WHERE search_text LIKE $1 ORDER BY name LIMIT $2",
    [`%${q}%`, n]
  );
  return rows.map(toDirectory);
}

export async function getDirectorySchool(unitid: string): Promise<DirectorySchool | null> {
  const r = await queryOne<any>("SELECT * FROM school_directory WHERE unitid = $1", [unitid]);
  return r ? toDirectory(r) : null;
}

export async function upsertDirectorySchool(input: {
  unitid: string; name: string; alias?: string | null; city?: string | null; state?: string | null;
  website?: string | null; domain?: string | null; control?: string | null;
}): Promise<void> {
  const unitid = String(input.unitid).trim();
  const name = String(input.name).trim().slice(0, 240);
  if (!/^\d+$/.test(unitid) || !name) throw new Error("unitid and name are required");
  const searchText = [name, input.alias, input.city, input.state, input.domain].filter(Boolean).join(" ").toLowerCase().slice(0, 1000);
  const now = nowIso();
  await exec(
    `INSERT INTO school_directory (unitid,name,alias,city,state,website,domain,control,search_text,institution_id,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10)
     ON CONFLICT (unitid) DO UPDATE SET name=$11,alias=$12,city=$13,state=$14,website=$15,domain=$16,control=$17,search_text=$18,updated_at=$19`,
    [unitid, name, input.alias ?? null, input.city ?? null, input.state ?? null, input.website ?? null, input.domain ?? null, input.control ?? null, searchText, now,
      name, input.alias ?? null, input.city ?? null, input.state ?? null, input.website ?? null, input.domain ?? null, input.control ?? null, searchText, now]
  );
}

export async function createSchoolRequest(input: { householdId: string; personId?: string | null; unitid: string; term: string }): Promise<{ request: SchoolRequest; created: boolean }> {
  if (!isStartTerm(input.term)) throw new Error("Choose a valid start term before requesting a school.");
  const school = await getDirectorySchool(input.unitid);
  if (!school) throw new Error("That school is not in the directory");
  const old = await getFamilyRequest(input.householdId, input.unitid, input.term);
  if (old) return { request: old, created: false };
  const month = nowIso().slice(0, 7);
  const count = await queryOne<any>("SELECT COUNT(*) AS n FROM school_requests WHERE household_id=$1 AND substr(created_at,1,7)=$2", [input.householdId, month]);
  if (Number(count?.n ?? 0) >= MAX_FAMILY_REQUESTS_PER_MONTH) throw new Error("You can request up to three new schools per calendar month.");
  const now = nowIso();
  const id = newId("schoolreq");
  try {
    await exec("INSERT INTO school_requests (id,household_id,person_id,unitid,term,created_at,seen_at,notified_at) VALUES ($1,$2,$3,$4,$5,$6,NULL,NULL)", [id, input.householdId, input.personId ?? null, input.unitid, input.term, now]);
    await exec(
      `INSERT INTO school_research_jobs (unitid,term,status,slug,attempts,recheck_done,first_requested_at,started_at,finished_at,cost_cents,coverage_pct,note,updated_at)
       VALUES ($1,$2,'queued',NULL,0,0,$3,NULL,NULL,0,NULL,NULL,$4)
       ON CONFLICT (unitid,term) DO NOTHING`, [input.unitid, input.term, now, now]
    );
  } catch (e) {
    const duplicate = await getFamilyRequest(input.householdId, input.unitid, input.term);
    if (duplicate) return { request: duplicate, created: false };
    throw e;
  }
  return { request: (await getFamilyRequest(input.householdId, input.unitid, input.term))!, created: true };
}

async function mapRequest(r: any): Promise<SchoolRequest> {
  const school = toDirectory(r);
  const job = r.job_unitid ? toJob({ unitid: r.job_unitid, term: r.job_term, status: r.job_status, slug: r.job_slug, attempts: r.job_attempts, recheck_done: r.job_recheck_done, first_requested_at: r.job_first_requested_at, started_at: r.job_started_at, finished_at: r.job_finished_at, cost_cents: r.job_cost_cents, coverage_pct: r.job_coverage_pct, note: r.job_note, updated_at: r.job_updated_at }) : null;
  const institution = r.institution_id ? { id: r.institution_id, name: r.institution_name, slug: r.institution_slug, coverageStatus: r.coverage_status, coveragePct: Number(r.coverage_pct ?? 0) } : null;
  return { id: r.request_id, householdId: r.household_id, personId: r.person_id ?? null, unitid: r.unitid, term: r.term, createdAt: r.request_created_at, seenAt: r.seen_at ?? null, notifiedAt: r.notified_at ?? null, school, job, institution };
}
const REQUEST_SELECT = `SELECT r.id AS request_id,r.household_id,r.person_id,r.unitid,r.term,r.created_at AS request_created_at,r.seen_at,r.notified_at,
 d.name,d.alias,d.city,d.state,d.website,d.domain,d.control,d.institution_id,d.updated_at,
 j.unitid AS job_unitid,j.term AS job_term,j.status AS job_status,j.slug AS job_slug,j.attempts AS job_attempts,j.recheck_done AS job_recheck_done,
 j.first_requested_at AS job_first_requested_at,j.started_at AS job_started_at,j.finished_at AS job_finished_at,j.cost_cents AS job_cost_cents,j.coverage_pct AS job_coverage_pct,j.note AS job_note,j.updated_at AS job_updated_at,
 i.id AS institution_id,i.name AS institution_name,i.slug AS institution_slug,i.coverage_status,i.coverage_pct
 FROM school_requests r JOIN school_directory d ON d.unitid=r.unitid LEFT JOIN school_research_jobs j ON j.unitid=r.unitid AND j.term=r.term LEFT JOIN institutions i ON i.id=d.institution_id`;
export async function getFamilyRequest(householdId: string, unitid: string, term: string): Promise<SchoolRequest | null> {
  const r = await queryOne<any>(`${REQUEST_SELECT} WHERE r.household_id=$1 AND r.unitid=$2 AND r.term=$3`, [householdId, unitid, term]);
  return r ? mapRequest(r) : null;
}
export async function listFamilyRequests(householdId: string): Promise<SchoolRequest[]> {
  const rows = await queryRows<any>(`${REQUEST_SELECT} WHERE r.household_id=$1 ORDER BY r.created_at DESC`, [householdId]);
  return Promise.all(rows.map(mapRequest));
}

export async function claimNextResearchJob(): Promise<{ job: ResearchJob; school: DirectorySchool; requestCount: number } | null> {
  if (process.env.REQUEST_QUEUE_ENABLED !== "1") return null;
  const running = await queryOne<any>("SELECT unitid,term FROM school_research_jobs WHERE status='running' LIMIT 1");
  if (running) return null;
  const month = nowIso().slice(0, 7);
  const budget = Number(process.env.REQUEST_MONTHLY_BUDGET_CENTS ?? DEFAULT_MONTHLY_BUDGET_CENTS);
  const estimate = Number(process.env.REQUEST_JOB_ESTIMATE_CENTS ?? DEFAULT_JOB_ESTIMATE_CENTS);
  const spent = await queryOne<any>("SELECT COALESCE(SUM(cents),0) AS cents FROM budget_ledger WHERE month=$1", [month]);
  if (Number(spent?.cents ?? 0) + estimate > budget) return null;
  const candidate = await queryOne<any>(
    `SELECT j.*,d.name,d.alias,d.city,d.state,d.website,d.domain,d.control,d.institution_id,d.updated_at,
       COUNT(r.id) AS request_count
       FROM school_research_jobs j JOIN school_directory d ON d.unitid=j.unitid LEFT JOIN school_requests r ON r.unitid=j.unitid AND r.term=j.term
      WHERE j.status='queued' AND j.attempts < 3
      GROUP BY j.unitid,j.term,d.name,d.alias,d.city,d.state,d.website,d.domain,d.control,d.institution_id,d.updated_at,j.status,j.slug,j.attempts,j.recheck_done,j.first_requested_at,j.started_at,j.finished_at,j.cost_cents,j.coverage_pct,j.note,j.updated_at
      ORDER BY MIN(r.created_at), j.unitid, j.term LIMIT 1`
  );
  if (!candidate) return null;
  const now = nowIso();
  const attempt = Number(candidate.attempts) + 1;
  // The NOT EXISTS predicate makes the database re-check the single-running-job
  // guard at the claim write, not only at the earlier read. The workflow also
  // serializes runs, but this protects the endpoint from duplicate callers.
  const claimed = await queryOne<any>("UPDATE school_research_jobs SET status='running',attempts=$1,started_at=$2,updated_at=$3 WHERE unitid=$4 AND term=$5 AND status='queued' AND NOT EXISTS (SELECT 1 FROM school_research_jobs WHERE status='running') RETURNING *", [attempt, now, now, candidate.unitid, candidate.term]);
  if (!claimed) return null;
  await exec("INSERT INTO budget_ledger (id,month,cents,kind,reference,created_at) VALUES ($1,$2,$3,'job_estimate',$4,$5)", [newId("budget"), month, estimate, `${candidate.unitid}:${candidate.term}:${attempt}`, now]);
  return { job: toJob(claimed), school: toDirectory(candidate), requestCount: Number(candidate.request_count ?? 0) };
}

export async function reportResearchJob(input: { unitid: string; term: string; attempt: number; outcome: "recheck" | "certified" | "review" | "failed"; costCents?: number; coveragePct?: number | null; note?: string | null; slug?: string | null }): Promise<ResearchJob> {
  if (!isStartTerm(input.term)) throw new Error("Invalid research term");
  const row = await queryOne<any>("SELECT * FROM school_research_jobs WHERE unitid=$1 AND term=$2", [input.unitid, input.term]);
  if (!row || row.status !== "running" || Number(row.attempts) !== Number(input.attempt)) throw new Error("Job is not the active attempt");
  const reportedCost = Number(input.costCents ?? 0);
  const cost = Number.isFinite(reportedCost) ? Math.max(0, Math.min(100000, Math.round(reportedCost))) : 0;
  const reportedCoverage = input.coveragePct == null ? null : Number(input.coveragePct);
  const coverage = reportedCoverage != null && Number.isFinite(reportedCoverage) ? Math.max(0, Math.min(100, reportedCoverage)) : null;
  const now = nowIso();
  const ref = `${input.unitid}:${input.term}:${input.attempt}`;
  const month = now.slice(0, 7);
  const ledger = await queryOne<any>("SELECT id FROM budget_ledger WHERE reference=$1 AND kind='job_estimate'", [ref]);
  if (ledger) await exec("UPDATE budget_ledger SET cents=$1,kind='reported_cost' WHERE id=$2", [cost, ledger.id]);
  else await exec("INSERT INTO budget_ledger (id,month,cents,kind,reference,created_at) VALUES ($1,$2,$3,'reported_cost',$4,$5)", [newId("budget"), month, cost, ref, now]);
  if (input.outcome === "recheck") {
    if (row.recheck_done) throw new Error("Only one automatic re-check is allowed");
    await exec("UPDATE school_research_jobs SET recheck_done=1,cost_cents=$1,note=$2,slug=COALESCE($3,slug),updated_at=$4 WHERE unitid=$5 AND term=$6", [cost, input.note ?? null, input.slug ?? null, now, input.unitid, input.term]);
  } else {
    let status = input.outcome === "certified" ? "ready" : input.outcome === "review" || Number(row.attempts) >= 3 ? "review" : "queued";
    if (status === "ready") {
      if (input.term !== RESEARCHED_TERM) throw new Error("Term-specific certification is not enabled for this research cycle");
      const inst = await queryOne<any>("SELECT i.coverage_status FROM school_directory d JOIN institutions i ON i.id=d.institution_id WHERE d.unitid=$1", [input.unitid]);
      if (inst?.coverage_status !== "certified") throw new Error("Server certification gate rejected this result");
    }
    await exec("UPDATE school_research_jobs SET status=$1,cost_cents=$2,coverage_pct=$3,note=$4,slug=COALESCE($5,slug),finished_at=$6,updated_at=$7 WHERE unitid=$8 AND term=$9", [status, cost, coverage, input.note ?? null, input.slug ?? null, now, now, input.unitid, input.term]);
    if (status === "ready") await exec("UPDATE school_requests SET notified_at=$1 WHERE unitid=$2 AND term=$3 AND notified_at IS NULL", [now, input.unitid, input.term]);
  }
  return toJob((await queryOne<any>("SELECT * FROM school_research_jobs WHERE unitid=$1 AND term=$2", [input.unitid, input.term]))!);
}

export async function linkDirectoryInstitution(unitid: string, slug: string): Promise<void> {
  const institution = await queryOne<any>("SELECT id FROM institutions WHERE slug=$1", [slug]);
  if (!institution) throw new Error("Institution is not onboarded");
  await exec("UPDATE school_directory SET institution_id=$1,updated_at=$2 WHERE unitid=$3", [institution.id, nowIso(), unitid]);
}

export async function getResearchJob(unitid: string, term: string): Promise<ResearchJob | null> {
  const r = await queryOne<any>("SELECT * FROM school_research_jobs WHERE unitid=$1 AND term=$2", [unitid, term]);
  return r ? toJob(r) : null;
}

export async function queueOverview(): Promise<{ month: string; spentCents: number; budgetCents: number; queued: number; running: number; ready: number; review: number; demandByTerm: { term: string; requests: number }[] }> {
  const month = nowIso().slice(0, 7);
  const spent = await queryOne<any>("SELECT COALESCE(SUM(cents),0) AS cents FROM budget_ledger WHERE month=$1", [month]);
  const rows = await queryRows<any>("SELECT status,COUNT(*) AS n FROM school_research_jobs GROUP BY status");
  const demand = await queryRows<any>("SELECT term,COUNT(*) AS requests FROM school_requests GROUP BY term ORDER BY COUNT(*) DESC,term");
  const counts: Record<string, number> = {}; for (const r of rows) counts[r.status] = Number(r.n);
  return { month, spentCents: Number(spent?.cents ?? 0), budgetCents: Number(process.env.REQUEST_MONTHLY_BUDGET_CENTS ?? DEFAULT_MONTHLY_BUDGET_CENTS), queued: counts.queued ?? 0, running: counts.running ?? 0, ready: counts.ready ?? 0, review: counts.review ?? 0, demandByTerm: demand.map((r) => ({ term: String(r.term), requests: Number(r.requests) })) };
}
