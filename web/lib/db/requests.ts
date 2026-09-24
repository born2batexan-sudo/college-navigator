import { exec, newId, nowIso, queryOne, queryRows, usingPostgres, withTransaction } from "./client";
import type { Institution } from "./types";
import { isStartTerm } from "@/lib/terms";

// Production schema comes only from versioned migrations. SQLite loads the
// canonical schema.sql for local/test compatibility.
export const REQUEST_DDL: string[] = [];
export const REQUEST_TABLES = ["school_directory", "school_research_jobs", "school_requests", "budget_ledger", "research_versions", "request_subject_states"] as const;
export const DEFAULT_MONTHLY_BUDGET_CENTS = 1600;
export const DEFAULT_JOB_ESTIMATE_CENTS = 800;
export const MAX_FAMILY_REQUESTS_PER_MONTH = 3;

function positiveIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return n;
}
function queueConfig() {
  const budget = positiveIntEnv("REQUEST_MONTHLY_BUDGET_CENTS", DEFAULT_MONTHLY_BUDGET_CENTS, 1, 10_000_000);
  const reservation = positiveIntEnv("REQUEST_JOB_ESTIMATE_CENTS", DEFAULT_JOB_ESTIMATE_CENTS, 1, 1_000_000);
  const leaseSeconds = positiveIntEnv("REQUEST_LEASE_SECONDS", 300, 300, 14400);
  if (reservation > budget) throw new Error("REQUEST_JOB_ESTIMATE_CENTS cannot exceed the monthly budget");
  return { budget, reservation, leaseSeconds };
}
function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const u = new URL(candidate);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (u.protocol !== "https:" || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) return null;
    return host;
  } catch { return null; }
}

export type DirectorySchool = { unitid: string; name: string; alias: string | null; city: string | null; state: string | null; website: string | null; domain: string | null; control: string | null; institutionId: string | null; updatedAt: string };
export type ResearchJob = { unitid: string; term: string; status: string; slug: string | null; attempts: number; attemptId: string | null; leaseExpiresAt: string | null; recheckDone: boolean; firstRequestedAt: string; startedAt: string | null; finishedAt: string | null; costCents: number; coveragePct: number | null; note: string | null; updatedAt: string };
export type SchoolRequest = { id: string; householdId: string; personId: string | null; unitid: string; term: string; createdAt: string; seenAt: string | null; notifiedAt: string | null; school: DirectorySchool; job: ResearchJob | null; institution: Pick<Institution,"id"|"name"|"slug"|"coverageStatus"|"coveragePct"> | null };

const toDirectory = (r: any): DirectorySchool => ({ unitid:String(r.unitid),name:r.name,alias:r.alias??null,city:r.city??null,state:r.state??null,website:r.website??null,domain:r.domain??null,control:r.control??null,institutionId:r.institution_id??null,updatedAt:r.updated_at });
const toJob = (r: any): ResearchJob => ({ unitid:String(r.unitid),term:String(r.term),status:r.status,slug:r.slug??null,attempts:Number(r.attempts??0),attemptId:r.attempt_id??null,leaseExpiresAt:r.lease_expires_at??null,recheckDone:!!r.recheck_done,firstRequestedAt:r.first_requested_at,startedAt:r.started_at??null,finishedAt:r.finished_at??null,costCents:Number(r.cost_cents??0),coveragePct:r.coverage_pct==null?null:Number(r.coverage_pct),note:r.note??null,updatedAt:r.updated_at });

export async function searchDirectory(query: string, limit=20): Promise<DirectorySchool[]> {
  const q=query.trim().toLowerCase().slice(0,100); if(q.length<2)return[];
  const rows=await queryRows<any>("SELECT unitid,name,alias,city,state,website,domain,control,institution_id,updated_at FROM school_directory WHERE search_text LIKE $1 ORDER BY name LIMIT $2",[`%${q}%`,Math.max(1,Math.min(50,Math.floor(limit)))]);
  return rows.map(toDirectory);
}
export async function getDirectorySchool(unitid:string):Promise<DirectorySchool|null>{const r=await queryOne<any>("SELECT * FROM school_directory WHERE unitid=$1",[unitid]);return r?toDirectory(r):null;}
export async function upsertDirectorySchool(input:{unitid:string;name:string;alias?:string|null;city?:string|null;state?:string|null;website?:string|null;domain?:string|null;control?:string|null}):Promise<void>{
  const unitid=String(input.unitid).trim(),name=String(input.name).trim().slice(0,240);if(!/^\d+$/.test(unitid)||!name)throw new Error("unitid and name are required");
  const domain=normalizeDomain(input.domain??input.website) ;
  const searchText=[name,input.alias,input.city,input.state,domain].filter(Boolean).join(" ").toLowerCase().slice(0,1000),now=nowIso();
  await exec(`INSERT INTO school_directory(unitid,name,alias,city,state,website,domain,control,search_text,institution_id,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10)
    ON CONFLICT(unitid) DO UPDATE SET name=$11,alias=$12,city=$13,state=$14,website=$15,domain=$16,control=$17,search_text=$18,updated_at=$19`,[unitid,name,input.alias??null,input.city??null,input.state??null,input.website??null,domain,input.control??null,searchText,now,name,input.alias??null,input.city??null,input.state??null,input.website??null,domain,input.control??null,searchText,now]);
}

const REQUEST_SELECT=`SELECT r.id AS request_id,r.household_id,r.person_id,r.unitid,r.term,r.created_at AS request_created_at,r.seen_at,r.notified_at,d.name,d.alias,d.city,d.state,d.website,d.domain,d.control,d.institution_id,d.updated_at,
 j.unitid AS job_unitid,j.term AS job_term,j.status AS job_status,j.slug AS job_slug,j.attempts AS job_attempts,j.attempt_id AS job_attempt_id,j.lease_expires_at AS job_lease_expires_at,j.recheck_done AS job_recheck_done,j.first_requested_at AS job_first_requested_at,j.started_at AS job_started_at,j.finished_at AS job_finished_at,j.cost_cents AS job_cost_cents,j.coverage_pct AS job_coverage_pct,j.note AS job_note,j.updated_at AS job_updated_at,
 i.id AS institution_id,i.name AS institution_name,i.slug AS institution_slug,COALESCE(v.coverage_status,i.coverage_status) AS coverage_status,COALESCE(v.coverage_pct,i.coverage_pct) AS coverage_pct
 FROM school_requests r JOIN school_directory d ON d.unitid=r.unitid LEFT JOIN school_research_jobs j ON j.unitid=r.unitid AND j.term=r.term LEFT JOIN institutions i ON i.id=d.institution_id LEFT JOIN research_versions v ON v.institution_id=i.id AND v.research_term=r.term`;
async function mapRequest(r:any):Promise<SchoolRequest>{const school=toDirectory(r);const job=r.job_unitid?toJob({unitid:r.job_unitid,term:r.job_term,status:r.job_status,slug:r.job_slug,attempts:r.job_attempts,attempt_id:r.job_attempt_id,lease_expires_at:r.job_lease_expires_at,recheck_done:r.job_recheck_done,first_requested_at:r.job_first_requested_at,started_at:r.job_started_at,finished_at:r.job_finished_at,cost_cents:r.job_cost_cents,coverage_pct:r.job_coverage_pct,note:r.job_note,updated_at:r.job_updated_at}):null;const institution=r.institution_id?{id:r.institution_id,name:r.institution_name,slug:r.institution_slug,coverageStatus:r.coverage_status,coveragePct:Number(r.coverage_pct??0)}:null;return{id:r.request_id,householdId:r.household_id,personId:r.person_id??null,unitid:r.unitid,term:r.term,createdAt:r.request_created_at,seenAt:r.seen_at??null,notifiedAt:r.notified_at??null,school,job,institution};}
export async function getFamilyRequest(householdId:string,unitid:string,term:string):Promise<SchoolRequest|null>{const r=await queryOne<any>(`${REQUEST_SELECT} WHERE r.household_id=$1 AND r.unitid=$2 AND r.term=$3`,[householdId,unitid,term]);return r?mapRequest(r):null;}
export async function listFamilyRequests(householdId:string):Promise<SchoolRequest[]>{return Promise.all((await queryRows<any>(`${REQUEST_SELECT} WHERE r.household_id=$1 ORDER BY r.created_at DESC`,[householdId])).map(mapRequest));}

export async function createSchoolRequest(input:{householdId:string;personId?:string|null;unitid:string;term:string}):Promise<{request:SchoolRequest;created:boolean}>{
  if(!isStartTerm(input.term)||input.term==="Not sure yet")throw new Error("Choose a specific valid start term before requesting a school.");
  const created=await withTransaction(async()=>{
    if(usingPostgres)await exec("SELECT pg_advisory_xact_lock(hashtext($1))",[`request:${input.householdId}`]);
    if(!await getDirectorySchool(input.unitid))throw new Error("That school is not in the directory");
    const old=await queryOne<any>("SELECT id FROM school_requests WHERE household_id=$1 AND unitid=$2 AND term=$3",[input.householdId,input.unitid,input.term]);if(old)return false;
    if(input.personId){const owner=await queryOne("SELECT 1 AS ok FROM people WHERE id=$1 AND household_id=$2",[input.personId,input.householdId]);if(!owner)throw new Error("Requesting person does not belong to this household");}
    const month=nowIso().slice(0,7),count=await queryOne<any>("SELECT COUNT(*) AS n FROM school_requests WHERE household_id=$1 AND substr(created_at,1,7)=$2",[input.householdId,month]);if(Number(count?.n??0)>=MAX_FAMILY_REQUESTS_PER_MONTH)throw new Error("You can request up to three new schools per calendar month.");
    const now=nowIso();await exec("INSERT INTO school_requests(id,household_id,person_id,unitid,term,created_at,seen_at,notified_at) VALUES($1,$2,$3,$4,$5,$6,NULL,NULL)",[newId("schoolreq"),input.householdId,input.personId??null,input.unitid,input.term,now]);
    await exec(`INSERT INTO school_research_jobs(unitid,term,status,slug,attempts,attempt_id,lease_expires_at,heartbeat_at,last_report_outcome,recheck_done,first_requested_at,started_at,finished_at,cost_cents,coverage_pct,note,updated_at)
      VALUES($1,$2,'queued',NULL,0,NULL,NULL,NULL,NULL,0,$3,NULL,NULL,0,NULL,NULL,$4) ON CONFLICT(unitid,term) DO NOTHING`,[input.unitid,input.term,now,now]);return true;
  });
  const request=await getFamilyRequest(input.householdId,input.unitid,input.term);if(!request)throw new Error("Request transaction did not persist");return{request,created};
}

// These UTC timestamps are durable, non-identifying benchmark markers. An
// accepted dispatch is only a wake-up, never evidence of worker execution.
export async function recordRequestDispatch(requestId:string,outcome:"accepted"|"failed"):Promise<void>{
  await exec("UPDATE school_requests SET dispatch_attempted_at=$1,dispatch_outcome=$2 WHERE id=$3 AND dispatch_attempted_at IS NULL",[nowIso(),outcome,requestId]);
}
export async function markFamilyFirstView(householdId:string,requestId:string):Promise<void>{
  // The caller is the authenticated /request server page after reading all 144
  // states. A household cannot mark another household's request as visible.
  await exec(`UPDATE school_requests SET first_visible_at=$1 WHERE id=$2 AND household_id=$3 AND first_visible_at IS NULL
    AND (SELECT COUNT(*) FROM request_subject_states s WHERE s.unitid=school_requests.unitid AND s.term=school_requests.term)=144`,[nowIso(),requestId,householdId]);
}

export async function claimNextResearchJob():Promise<{job:ResearchJob;school:DirectorySchool;requestCount:number}|null>{
  if(process.env.REQUEST_QUEUE_ENABLED!=="1" || process.env.REQUEST_PIPELINE_ENABLED!=="1")return null;const cfg=queueConfig();
  return withTransaction(async()=>{
    if(usingPostgres)await exec("SELECT pg_advisory_xact_lock(hashtext('school-research-queue'))");
    const now=nowIso();
    await exec("UPDATE school_research_jobs SET status=CASE WHEN attempts>=3 THEN 'review' ELSE 'queued' END,note='Worker lease expired; conservative reservation retained.',last_report_outcome='failed',attempt_id=NULL,lease_expires_at=NULL,updated_at=$1 WHERE status='running' AND lease_expires_at<$2",[now,now]);
    if(await queryOne("SELECT 1 AS ok FROM school_research_jobs WHERE status='running' LIMIT 1"))return null;
    const month=now.slice(0,7),spent=Number((await queryOne<any>("SELECT COALESCE(SUM(cents),0) AS cents FROM budget_ledger WHERE month=$1",[month]))?.cents??0);if(spent+cfg.reservation>cfg.budget)return null;
    const candidate=await queryOne<any>(`SELECT j.*,d.name,d.alias,d.city,d.state,d.website,d.domain,d.control,d.institution_id,d.updated_at,(SELECT COUNT(*) FROM school_requests r WHERE r.unitid=j.unitid AND r.term=j.term) AS request_count
      FROM school_research_jobs j JOIN school_directory d ON d.unitid=j.unitid WHERE (j.status='queued' AND j.attempts<3) OR (j.status='review' AND j.last_report_outcome='review' AND j.next_check_at IS NOT NULL AND j.next_check_at<=$1) ORDER BY j.first_requested_at,j.unitid,j.term LIMIT 1`,[now]);if(!candidate)return null;
    if(!normalizeDomain(candidate.domain)){await exec("UPDATE school_research_jobs SET status='review',note='No valid approved institutional domain; no research was started.',finished_at=$1,updated_at=$2 WHERE unitid=$3 AND term=$4 AND status='queued'",[now,now,candidate.unitid,candidate.term]);return null;}
    const attempt=candidate.status==='review'?1:Number(candidate.attempts)+1,attemptId=newId("attempt"),leaseExpiresAt=new Date(Date.now()+cfg.leaseSeconds*1000).toISOString();
    const claimed=await queryOne<any>("UPDATE school_research_jobs SET status='running',attempts=$1,attempt_id=$2,lease_expires_at=$3,heartbeat_at=$4,started_at=$5,updated_at=$6 WHERE unitid=$7 AND term=$8 AND status IN ('queued','review') RETURNING *",[attempt,attemptId,leaseExpiresAt,now,now,now,candidate.unitid,candidate.term]);if(!claimed)return null;
    await exec("INSERT INTO budget_ledger(id,month,cents,kind,reference,created_at) VALUES($1,$2,$3,'reservation',$4,$5)",[newId("budget"),month,cfg.reservation,attemptId,now]);
    await exec("UPDATE school_requests SET first_claimed_at=$1 WHERE unitid=$2 AND term=$3 AND first_claimed_at IS NULL AND created_at<=$4",[now,candidate.unitid,candidate.term,now]);
    return{job:toJob(claimed),school:toDirectory(candidate),requestCount:Number(candidate.request_count??0)};
  });
}

type ReportInput={unitid:string;term:string;attempt:number;attemptId:string;outcome:"recheck"|"certified"|"review"|"failed";costCents?:number|null;coveragePct?:number|null;note?:string|null;slug?:string|null};
export async function reportResearchJob(input:ReportInput):Promise<ResearchJob>{
  if(!isStartTerm(input.term))throw new Error("Invalid research term");if(!input.attemptId)throw new Error("attemptId is required");
  if(input.outcome==='certified')throw new Error("Automated certification is quarantined; use a partial evidence-state view");
  return withTransaction(async()=>{
    if(usingPostgres)await exec("SELECT pg_advisory_xact_lock(hashtext('school-research-queue'))");
    const row=await queryOne<any>("SELECT * FROM school_research_jobs WHERE unitid=$1 AND term=$2",[input.unitid,input.term]);if(!row)throw new Error("Unknown job");
    if(row.attempt_id===input.attemptId&&row.last_report_outcome===input.outcome&&(row.status!=="running"||input.outcome==="recheck"))return toJob(row);
    if(row.status!=="running"||Number(row.attempts)!==input.attempt||row.attempt_id!==input.attemptId)throw new Error("Job is not the active claimed attempt");
    const reservation=await queryOne<any>("SELECT cents,month FROM budget_ledger WHERE kind='reservation' AND reference=$1",[input.attemptId]);if(!reservation)throw new Error("Active attempt has no budget reservation");
    let cost:number|null=null;if(input.costCents!==undefined&&input.costCents!==null){const n=Number(input.costCents);if(!Number.isInteger(n)||n<0||n>Number(reservation.cents))throw new Error("Reported cost must be a nonnegative integer within the authorized reservation");cost=n;}
    const cov=input.coveragePct==null?null:Number(input.coveragePct);if(cov!=null&&(!Number.isFinite(cov)||cov<0||cov>100))throw new Error("Invalid coverage percentage");
    const now=nowIso();
    if(input.outcome==="recheck"){
      if(row.recheck_done)throw new Error("Only one automatic re-check is allowed");
      const leaseSeconds=queueConfig().leaseSeconds,lease=new Date(Date.now()+leaseSeconds*1000).toISOString();
      await exec("UPDATE school_research_jobs SET recheck_done=1,last_report_outcome='recheck',note=$1,slug=COALESCE($2,slug),lease_expires_at=$3,heartbeat_at=$4,updated_at=$5 WHERE unitid=$6 AND term=$7 AND status='running' AND attempt_id=$8",[input.note??null,input.slug??null,lease,now,now,input.unitid,input.term,input.attemptId]);
    }else{
      let status=input.outcome==="certified"?"ready":input.outcome==="review"||Number(row.attempts)>=3?"review":"queued";
      if(status==="ready"){
        const version=await queryOne<any>(`SELECT v.coverage_status FROM school_directory d JOIN research_versions v ON v.institution_id=d.institution_id AND v.research_term=$2 WHERE d.unitid=$1`,[input.unitid,input.term]);
        if(version?.coverage_status!=="certified")throw new Error("Server term-specific certification gate rejected this result");
      }
      if(cost!==null)await exec("INSERT INTO budget_ledger(id,month,cents,kind,reference,created_at) VALUES($1,$2,$3,'reconciliation',$4,$5) ON CONFLICT(kind,reference) DO NOTHING",[newId("budget"),reservation.month,cost-Number(reservation.cents),input.attemptId,now]);
      await exec(`UPDATE school_research_jobs SET status=$1,cost_cents=$2,coverage_pct=$3,note=$4,slug=COALESCE($5,slug),finished_at=$6,last_report_outcome=$7,lease_expires_at=NULL,heartbeat_at=NULL,updated_at=$8
        WHERE unitid=$9 AND term=$10 AND status='running' AND attempt_id=$11`,[status,Number(row.cost_cents??0)+(cost??Number(reservation.cents)),cov,input.note??null,input.slug??null,now,input.outcome,now,input.unitid,input.term,input.attemptId]);
    }
    const saved=await queryOne<any>("SELECT * FROM school_research_jobs WHERE unitid=$1 AND term=$2",[input.unitid,input.term]);if(!saved)throw new Error("Job disappeared");return toJob(saved);
  });
}

export async function linkDirectoryInstitution(unitid:string,slug:string):Promise<void>{const i=await queryOne<any>("SELECT id,domains FROM institutions WHERE slug=$1",[slug]);if(!i)throw new Error("Institution is not onboarded");const d=await getDirectorySchool(unitid);if(!d?.domain)throw new Error("Directory school has no approved domain");let domains:string[]=[];try{domains=JSON.parse(i.domains)}catch{}const approved=domains.map((x)=>normalizeDomain(String(x))).filter(Boolean);if(approved.length!==1||approved[0]!==normalizeDomain(d.domain))throw new Error("Queue institution allow-list must exactly match the approved directory domain");await exec("UPDATE school_directory SET institution_id=$1,updated_at=$2 WHERE unitid=$3",[i.id,nowIso(),unitid]);}
export async function getResearchJob(unitid:string,term:string):Promise<ResearchJob|null>{const r=await queryOne<any>("SELECT * FROM school_research_jobs WHERE unitid=$1 AND term=$2",[unitid,term]);return r?toJob(r):null;}
export async function canHouseholdViewInstitution(householdId:string,institutionId:string,term:string):Promise<boolean>{
  const queued=await queryOne("SELECT 1 AS ok FROM school_directory WHERE institution_id=$1 LIMIT 1",[institutionId]);if(!queued)return true;
  // Legacy 90%-complete rows are not a reviewed certification protocol.
  // A requested school only has the partial evidence view until a separately
  // audited publish gate is implemented; do not infer access from old ready rows.
  void householdId; void term;
  return false;
}
export async function queueOverview(){const cfg=queueConfig(),month=nowIso().slice(0,7),spent=await queryOne<any>("SELECT COALESCE(SUM(cents),0) AS cents FROM budget_ledger WHERE month=$1",[month]),rows=await queryRows<any>("SELECT status,COUNT(*) AS n FROM school_research_jobs GROUP BY status"),demand=await queryRows<any>("SELECT term,COUNT(*) AS requests FROM school_requests GROUP BY term ORDER BY COUNT(*) DESC,term"),counts:Record<string,number>={};for(const r of rows)counts[r.status]=Number(r.n);return{month,spentCents:Number(spent?.cents??0),budgetCents:cfg.budget,queued:counts.queued??0,running:counts.running??0,ready:counts.ready??0,review:counts.review??0,demandByTerm:demand.map(r=>({term:String(r.term),requests:Number(r.requests)}))};}
