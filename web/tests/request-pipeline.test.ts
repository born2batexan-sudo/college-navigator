import { describe,it,before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ALL_CHECKPOINTS } from "../lib/checkpoints";
import { resolveAll, resolveCandidate, nextCheck } from "../lib/request-evidence";

process.env.DB_PATH=path.join(mkdtempSync(path.join(tmpdir(),"request-pipeline-")),"test.sqlite3");
delete process.env.DATABASE_URL;
process.env.REQUEST_QUEUE_ENABLED="1";
process.env.REQUEST_PIPELINE_ENABLED="1";
let A:typeof import("../lib/db/accounts"), Q:typeof import("../lib/db/requests"), P:typeof import("../lib/db/request-pipeline"), DB:typeof import("../lib/db/client");
before(async()=>{ A=await import("../lib/db/accounts");Q=await import("../lib/db/requests");P=await import("../lib/db/request-pipeline");DB=await import("../lib/db/client"); });
const term="Fall 2027",domain="example.edu",url=`https://${domain}/admission`;
const phrase=`Official ${term} first-year application is available`;
const candidate={code:"ADM-01",state:"verified" as const,sourceUrl:url,quote:phrase,pageText:`Welcome. ${phrase}.`};

describe("bounded first view evidence",()=>{
 it("fails closed when pipeline server flag is absent",async()=>{
  process.env.REQUEST_PIPELINE_ENABLED="0";
  try {
    assert.equal(P.pipelineEnabled(),false);
    assert.equal(await Q.claimNextResearchJob(),null);
    await assert.rejects(()=>P.ingestResearch({unitid:"1",term,attemptId:"x",candidates:[]}),/disabled/);
  } finally {process.env.REQUEST_PIPELINE_ENABLED="1";}
 });
 it("resolves all 144 subjects, never confuses target and prior terms, and withholds unsafe evidence",()=>{
  assert.equal(ALL_CHECKPOINTS.length,144);
  const rows=resolveAll([candidate],term,domain);
  assert.equal(rows.length,144); assert.equal(rows[0].state,"verified");
  assert.equal(rows.filter(r=>r.state==="under_review").length,143);
  assert.equal(resolveCandidate(candidate,"ADM-01","Fall 2028",domain).state,"withheld");
  assert.equal(resolveCandidate({...candidate,sourceUrl:"https://evil-example.edu/a"},"ADM-01",term,domain).state,"withheld");
  assert.equal(resolveCandidate({...candidate,quote:`Imagined ${term} answer`},"ADM-01",term,domain).state,"withheld");
  assert.equal(resolveCandidate({...candidate,code:"ADM-03"},"ADM-03",term,domain).state,"under_review");
  const dated={code:"ADM-03",state:"verified" as const,sourceUrl:url,quote:`${term} deadline is 2027-02-01`,pageText:`${term} deadline is 2027-02-01`,secondSourceUrl:`https://${domain}/calendar`,secondQuote:`${term} deadline is 2027-03-01`,secondPageText:`${term} deadline is 2027-03-01`};
  assert.equal(resolveCandidate(dated,"ADM-03",term,domain).state,"conflicting");
  assert.equal(resolveCandidate({...dated,secondQuote:`${term} deadline: 2027-02-01`,secondPageText:`${term} deadline: 2027-02-01`},"ADM-03",term,domain).state,"verified");
  assert.equal(resolveAll([candidate,candidate],term,domain)[0].state,"conflicting");
 });
 it("moves pending publication windows earlier and rechecks without notifications",()=>{
  const now=new Date("2026-09-23T10:00:00Z");
  assert.equal(nextCheck("not_yet_published",now,"2026-09-24"),"2026-09-24T00:00:00.000Z");
  assert.ok(nextCheck("conflicting",now)<nextCheck("verified",now));
  assert.ok(nextCheck("verified",new Date("2027-07-15T00:00:00Z"),undefined,"Fall 2027") < nextCheck("verified",new Date("2027-07-15T00:00:00Z")));
 });
 it("writes all states per term; unchanged revisit does not advance revision; isolates households",async()=>{
  await Q.upsertDirectorySchool({unitid:"800001",name:"Example University",domain});
  const a=await A.provisionAccount({authUserId:"pipeline-a",email:"pipeline-a@example.net"});
  const b=await A.provisionAccount({authUserId:"pipeline-b",email:"pipeline-b@example.net"});
  await Q.createSchoolRequest({householdId:a.household.id,unitid:"800001",term});
  const job=await Q.claimNextResearchJob(); assert.ok(job);
  const input={unitid:"800001",term,attemptId:job!.job.attemptId!,candidates:[candidate]};
  assert.equal((await P.ingestResearch(input)).changed,true);
  const firstCommit=await DB.queryOne<any>("SELECT first_evidence_committed_at FROM school_research_jobs WHERE unitid=$1 AND term=$2",["800001",term]);
  assert.ok(firstCommit?.first_evidence_committed_at);
  assert.equal((await P.ingestResearch(input)).changed,false);
  assert.equal((await DB.queryOne<any>("SELECT first_evidence_committed_at FROM school_research_jobs WHERE unitid=$1 AND term=$2",["800001",term]))?.first_evidence_committed_at,firstCommit.first_evidence_committed_at);
  const aView=await P.familyResearchView(a.household.id,"800001",term);
  assert.equal(aView?.length,144);
  assert.equal(aView?.find(r=>r.code==="ADM-01")?.quote,phrase);
  assert.equal(await P.familyResearchView(b.household.id,"800001",term),null);
  assert.equal(await P.familyResearchView(a.household.id,"800001","Fall 2028"),null);
  await assert.rejects(()=>Q.reportResearchJob({unitid:"800001",term,attempt:1,attemptId:job!.job.attemptId!,outcome:"certified",costCents:0}),/quarantined/);
  await Q.reportResearchJob({unitid:"800001",term,attempt:1,attemptId:job!.job.attemptId!,outcome:"review",costCents:120});
  assert.equal(await Q.claimNextResearchJob(),null,"a review is not eligible until its persisted next_check_at is due");
  await DB.exec("UPDATE school_research_jobs SET next_check_at=$1 WHERE unitid=$2 AND term=$3",["2020-01-01T00:00:00.000Z","800001",term]);
  const revisit=await Q.claimNextResearchJob(); assert.equal(revisit?.job.attempts,1);
  assert.equal(revisit?.job.attemptId===job!.job.attemptId,false);
  assert.equal((await P.ingestResearch({...input,attemptId:revisit!.job.attemptId!})).changed,false);
  const revision=await DB.queryOne<any>("SELECT publication_revision FROM school_research_jobs WHERE unitid=$1 AND term=$2",["800001",term]);
  assert.equal(Number(revision?.publication_revision),1);
  await Q.reportResearchJob({unitid:"800001",term,attempt:1,attemptId:revisit!.job.attemptId!,outcome:"review",costCents:20});
  const total=await DB.queryOne<any>("SELECT SUM(cents) AS n FROM budget_ledger WHERE month=$1",[new Date().toISOString().slice(0,7)]);
  assert.equal(Number(total?.n),140);
  await Q.upsertDirectorySchool({unitid:"800002",name:"Exception College",domain:"exception.edu"});
  await Q.createSchoolRequest({householdId:a.household.id,unitid:"800002",term});
  for(let n=1;n<=3;n++){
    const attempt=await Q.claimNextResearchJob(); assert.equal(attempt?.job.unitid,"800002");
    await Q.reportResearchJob({unitid:"800002",term,attempt:n,attemptId:attempt!.job.attemptId!,outcome:"failed",costCents:0});
  }
  await DB.exec("UPDATE school_research_jobs SET next_check_at=$1 WHERE unitid=$2",["2020-01-01T00:00:00.000Z","800002"]);
  assert.equal(await Q.claimNextResearchJob(),null,"exhausted failures require owner triage, not an automatic loop");
  assert.ok((await P.listResearchExceptions()).some(x=>x.unitid==="800002"));
 });
});
