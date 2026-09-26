import { exec, nowIso, queryOne, queryRows, usingPostgres, withTransaction } from "./client";
import { ALL_CHECKPOINTS } from "../checkpoints";
import { Candidate, materialFingerprint, resolveAll, type Resolution } from "../request-evidence";

export function pipelineEnabled(): boolean { return process.env.REQUEST_PIPELINE_ENABLED === "1" && process.env.REQUEST_QUEUE_ENABLED === "1"; }
export async function ingestResearch(input: {unitid:string;term:string;attemptId:string;candidates:Candidate[]}): Promise<{changed:boolean; states:Resolution[]}> {
  if (!pipelineEnabled()) throw new Error("Research pipeline is disabled");
  if (!Array.isArray(input.candidates) || input.candidates.length > 288) throw new Error("Invalid subject batch");
  return withTransaction(async () => {
    if (usingPostgres) await exec("SELECT pg_advisory_xact_lock(hashtext($1))",[`research:${input.unitid}:${input.term}`]);
    const job = await queryOne<any>("SELECT * FROM school_research_jobs WHERE unitid=$1 AND term=$2",[input.unitid,input.term]);
    const school = await queryOne<any>("SELECT domain FROM school_directory WHERE unitid=$1",[input.unitid]);
    if (!job || !school?.domain || job.status !== "running" || job.attempt_id !== input.attemptId || !job.lease_expires_at || job.lease_expires_at < nowIso()) throw new Error("No active research lease");
    const states = resolveAll(input.candidates,input.term,school.domain), fingerprint = materialFingerprint(states);
    const previous = await queryRows<any>("SELECT code,state,source_url,evidence_quote,fingerprint FROM request_subject_states WHERE unitid=$1 AND term=$2 ORDER BY code",[input.unitid,input.term]);
    const previousMaterial = JSON.stringify(previous.map(r=>[r.code,r.state,r.source_url,r.evidence_quote,r.fingerprint]));
    const changed = previous.length !== ALL_CHECKPOINTS.length || previousMaterial !== JSON.stringify([...states].sort((a,b)=>a.code.localeCompare(b.code)).map(r=>[r.code,r.state,r.sourceUrl,r.quote,r.fingerprint]));
    const now=nowIso();
    for (const r of states) await exec(`INSERT INTO request_subject_states(unitid,term,code,state,source_url,evidence_quote,explanation,fingerprint,last_checked_at,next_check_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT(unitid,term,code) DO UPDATE SET state=$12,source_url=$13,evidence_quote=$14,explanation=$15,fingerprint=$16,last_checked_at=$17,next_check_at=$18,updated_at=$19`,
      [input.unitid,input.term,r.code,r.state,r.sourceUrl,r.quote,r.explanation,r.fingerprint,r.checkedAt,r.nextCheckAt,now,r.state,r.sourceUrl,r.quote,r.explanation,r.fingerprint,r.checkedAt,r.nextCheckAt,now]);
    const next = states.map(s=>s.nextCheckAt).sort()[0];
    await exec("UPDATE school_research_jobs SET last_checked_at=$1,next_check_at=$2,material_fingerprint=$3,publication_revision=publication_revision+$4,updated_at=$5 WHERE unitid=$6 AND term=$7 AND attempt_id=$8",[now,next,fingerprint,changed?1:0,now,input.unitid,input.term,input.attemptId]);
    return { changed, states };
  });
}
export async function listResearchExceptions(): Promise<{unitid:string;term:string;name:string;code:string;state:string;checkedAt:string}[]> {
  if (!pipelineEnabled()) return [];
  const rows=await queryRows<any>(`SELECT j.unitid,j.term,d.name,s.code,s.state,s.last_checked_at AS checked_at
    FROM school_research_jobs j JOIN school_directory d ON d.unitid=j.unitid
    LEFT JOIN request_subject_states s ON s.unitid=j.unitid AND s.term=j.term AND s.state IN ('conflicting','withheld')
    WHERE s.code IS NOT NULL OR (j.status='review' AND (j.next_check_at IS NULL OR j.last_report_outcome='failed'))
    ORDER BY j.updated_at DESC,s.code LIMIT 100`);
  return rows.map(r=>({unitid:r.unitid,term:r.term,name:r.name,code:r.code??'WORKER',state:r.state??'failed_or_blocked',checkedAt:r.checked_at??''}));
}
export async function familyResearchView(householdId:string, unitid:string, term:string): Promise<Resolution[] | null> {
  if (!pipelineEnabled()) return [];
  // The JOIN is the authorization: caller's selected household is never supplied by a URL.
  const owns = await queryOne("SELECT 1 AS ok FROM school_requests WHERE household_id=$1 AND unitid=$2 AND term=$3",[householdId,unitid,term]);
  if (!owns) return null;
  const rows=await queryRows<any>("SELECT code,state,source_url,evidence_quote,explanation,fingerprint,last_checked_at,next_check_at FROM request_subject_states WHERE unitid=$1 AND term=$2 ORDER BY code",[unitid,term]);
  return rows.map(r=>({code:r.code,state:r.state,sourceUrl:r.state==='verified'||r.state==='not_applicable'||r.state==='not_yet_published'?r.source_url:null,quote:r.state==='verified'||r.state==='not_applicable'||r.state==='not_yet_published'?r.evidence_quote:null,explanation:r.explanation,fingerprint:r.fingerprint,checkedAt:r.last_checked_at,nextCheckAt:r.next_check_at}));
}
