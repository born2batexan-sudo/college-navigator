import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "request-dispatch-")), "test.sqlite3");
delete process.env.DATABASE_URL;
process.env.REQUEST_QUEUE_ENABLED = "1";
process.env.REQUEST_PIPELINE_ENABLED = "1";
process.env.REQUEST_EVENT_DISPATCH_ENABLED = "0";
let A: typeof import("../lib/db/accounts"), Q: typeof import("../lib/db/requests"), D: typeof import("../lib/request-dispatch"), DB: typeof import("../lib/db/client");
const term = "Fall 2027";
const originalFetch = globalThis.fetch;

before(async () => {
  A = await import("../lib/db/accounts"); Q = await import("../lib/db/requests");
  D = await import("../lib/request-dispatch"); DB = await import("../lib/db/client");
});
async function create(unitid: string) {
  await Q.upsertDirectorySchool({unitid,name:`School ${unitid}`,domain:`school${unitid}.edu`});
  const owner=await A.provisionAccount({authUserId:`dispatch-${unitid}`,email:`dispatch-${unitid}@example.org`});
  return Q.createSchoolRequest({householdId:owner.household.id,unitid,term});
}
async function metrics(id:string) { return DB.queryOne<any>("SELECT created_at,dispatch_attempted_at,dispatch_outcome,first_claimed_at,first_visible_at FROM school_requests WHERE id=$1",[id]); }

describe("post-commit request dispatch and durable first-view timing", () => {
  it("is default off even with provider credentials, and a duplicate never wakes",async()=>{
    const result=await create("81001");
    globalThis.fetch=async()=>{throw new Error("disabled dispatch unexpectedly reached network")};
    try {
      await D.wakeSchoolRequest(result);
      assert.equal((await metrics(result.request.id))?.dispatch_attempted_at,null);
      process.env.REQUEST_EVENT_DISPATCH_ENABLED="1";
      await D.wakeSchoolRequest({...result,created:false});
      assert.equal((await metrics(result.request.id))?.dispatch_attempted_at,null);
      process.env.REQUEST_PIPELINE_ENABLED="0";
      await D.wakeSchoolRequest(result);
      assert.equal((await metrics(result.request.id))?.dispatch_attempted_at,null);
    } finally {process.env.REQUEST_PIPELINE_ENABLED="1";globalThis.fetch=originalFetch;}
  });
  it("accepts only a fixed server-to-GitHub workflow wake-up, not a claim",async()=>{
    process.env.REQUEST_EVENT_DISPATCH_ENABLED="1";
    const result=await create("81002");
    process.env.REQUEST_DISPATCH_GITHUB_TOKEN="private-test-token";
    process.env.REQUEST_DISPATCH_REPOSITORY="review-org/review-repo";
    process.env.REQUEST_DISPATCH_REF="main";
    let calls=0;
    globalThis.fetch=async (url,init)=>{
      calls++;
      assert.equal(url,"https://api.github.com/repos/review-org/review-repo/actions/workflows/school-requests.yml/dispatches");
      assert.equal(init?.method,"POST");
      assert.equal((init?.headers as Record<string,string>).Authorization,"Bearer private-test-token");
      assert.deepEqual(JSON.parse(String(init?.body)),{ref:"main",inputs:{task:"process the next requested school"}});
      assert.ok(init?.signal);return new Response(null,{status:204});
    };
    try {
      await D.wakeSchoolRequest(result);
      assert.equal(calls,1);
      assert.equal((await metrics(result.request.id))?.dispatch_outcome,"accepted");
      assert.equal((await metrics(result.request.id))?.first_claimed_at,null);
      const claim=await Q.claimNextResearchJob();
      // Earlier pending school can be claimed first; accepted dispatch alone never claims.
      assert.ok(claim); assert.ok((await metrics(result.request.id))?.created_at);
    } finally {globalThis.fetch=originalFetch;}
  });
  it("preserves a committed request on transport failure and rejects unsafe target config",async()=>{
    process.env.REQUEST_EVENT_DISPATCH_ENABLED="1";
    const result=await create("81003");
    globalThis.fetch=async()=>{throw new Error("network offline")};
    try {
      await D.wakeSchoolRequest(result);
      assert.equal((await metrics(result.request.id))?.dispatch_outcome,"failed");
      const duplicate=await Q.createSchoolRequest({householdId:result.request.householdId,unitid:"81003",term});
      assert.equal(duplicate.created,false);
      assert.equal(duplicate.request.id,result.request.id);
      process.env.REQUEST_DISPATCH_REPOSITORY="review-org/../../evil";
      const unsafe=await create("81004");
      await D.wakeSchoolRequest(unsafe);
      assert.equal((await metrics(unsafe.request.id))?.dispatch_outcome,"failed");
    } finally {globalThis.fetch=originalFetch;process.env.REQUEST_DISPATCH_REPOSITORY="review-org/review-repo";}
  });
  it("records first claim/visible once, only on authorized full evidence, and leaves missing observations NULL",async()=>{
    const result=await create("81005");
    assert.equal((await metrics(result.request.id))?.first_claimed_at,null);
    await Q.markFamilyFirstView("wrong-household",result.request.id);
    await Q.markFamilyFirstView(result.request.householdId,result.request.id);
    assert.equal((await metrics(result.request.id))?.first_visible_at,null);
    // The initial claim above is active; finish it so this request can be claimed.
    const running=await DB.queryOne<any>("SELECT * FROM school_research_jobs WHERE status='running' LIMIT 1");
    if(running) await Q.reportResearchJob({unitid:running.unitid,term:running.term,attempt:Number(running.attempts),attemptId:running.attempt_id,outcome:"review",costCents:0});
    // Other queued jobs may be ahead: claim until this unitid, reporting prior jobs.
    for(let n=0;n<6;n++){
      const claim=await Q.claimNextResearchJob();assert.ok(claim);
      if(claim.job.unitid==="81005")break;
      await Q.reportResearchJob({unitid:claim.job.unitid,term,attempt:claim.job.attempts,attemptId:claim.job.attemptId!,outcome:"review",costCents:0});
    }
    const first=await metrics(result.request.id);
    assert.ok(first?.first_claimed_at >= first?.created_at);
    const states=await import("../lib/request-evidence");
    const {ALL_CHECKPOINTS}=await import("../lib/checkpoints");
    const now=new Date().toISOString();
    const rows=states.resolveAll([],term,"school81005.edu");
    assert.equal(rows.length,ALL_CHECKPOINTS.length);
    for(const row of rows.slice(0,-1)) await DB.exec("INSERT INTO request_subject_states(unitid,term,code,state,explanation,last_checked_at,next_check_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",["81005",term,row.code,row.state,row.explanation,now,row.nextCheckAt,now]);
    await Q.markFamilyFirstView(result.request.householdId,result.request.id);
    assert.equal((await metrics(result.request.id))?.first_visible_at,null,"143 states are not a complete first view");
    const last=rows.at(-1)!;
    await DB.exec("INSERT INTO request_subject_states(unitid,term,code,state,explanation,last_checked_at,next_check_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",["81005",term,last.code,last.state,last.explanation,now,last.nextCheckAt,now]);
    await Q.markFamilyFirstView("wrong-household",result.request.id);
    assert.equal((await metrics(result.request.id))?.first_visible_at,null);
    await Q.markFamilyFirstView(result.request.householdId,result.request.id);
    const visible=(await metrics(result.request.id))?.first_visible_at;
    assert.ok(visible >= first.first_claimed_at);
    await Q.markFamilyFirstView(result.request.householdId,result.request.id);
    assert.equal((await metrics(result.request.id))?.first_visible_at,visible);
  });
});
