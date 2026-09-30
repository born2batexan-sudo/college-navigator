import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ALL_CHECKPOINTS } from "../lib/checkpoints";

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "request-first-useful-view-")), "test.sqlite3");
delete process.env.DATABASE_URL;
process.env.REQUEST_QUEUE_ENABLED = "1";
process.env.REQUEST_PIPELINE_ENABLED = "1";
process.env.REQUEST_EVENT_DISPATCH_ENABLED = "1";
process.env.REQUEST_MONTHLY_BUDGET_CENTS = "100000";
process.env.REQUEST_JOB_ESTIMATE_CENTS = "800";
process.env.REQUEST_DISPATCH_GITHUB_TOKEN = "test-only-token";
process.env.REQUEST_DISPATCH_REPOSITORY = "review-org/review-repo";
process.env.REQUEST_DISPATCH_REF = "main";

const term = "Fall 2027";
const originalFetch = globalThis.fetch;
let A: typeof import("../lib/db/accounts");
let Q: typeof import("../lib/db/requests");
let D: typeof import("../lib/request-dispatch");
let P: typeof import("../lib/db/request-pipeline");
let DB: typeof import("../lib/db/client");

before(async () => {
  A = await import("../lib/db/accounts");
  Q = await import("../lib/db/requests");
  D = await import("../lib/request-dispatch");
  P = await import("../lib/db/request-pipeline");
  DB = await import("../lib/db/client");
});
after(() => { globalThis.fetch = originalFetch; });

async function createRequest(unitid: string, domain: string) {
  await Q.upsertDirectorySchool({ unitid, name: `Timing College ${unitid}`, domain });
  const owner = await A.provisionAccount({ authUserId: `timing-owner-${unitid}`, email: `timing-${unitid}@example.org` });
  const result = await Q.createSchoolRequest({ householdId: owner.household.id, unitid, term });
  return { ...result, householdId: owner.household.id };
}
async function metrics(requestId: string) {
  return DB.queryOne<any>(`SELECT r.created_at,r.dispatch_attempted_at,r.dispatch_outcome,r.first_claimed_at,r.first_visible_at,
      j.status,j.attempts,j.attempt_id,j.started_at,j.first_evidence_committed_at,j.finished_at
    FROM school_requests r JOIN school_research_jobs j ON j.unitid=r.unitid AND j.term=r.term WHERE r.id=$1`, [requestId]);
}
function candidate(domain: string) {
  const quote = `${term} first-year students may apply through the official application.`;
  return { code: "ADM-01", state: "verified" as const, sourceUrl: `https://${domain}/admissions`, quote, pageText: `Admissions information. ${quote}` };
}
function assertOrdered(...timestamps: string[]) {
  const values = timestamps.map((value) => Date.parse(value));
  assert.ok(values.every(Number.isFinite), `all stage timestamps are present: ${timestamps.join(", ")}`);
  for (let i = 1; i < values.length; i++) assert.ok(values[i] >= values[i - 1], `timestamp ${timestamps[i]} precedes ${timestamps[i - 1]}`);
}

 describe("durable request-to-first-useful-view lifecycle", () => {
  it("records committed request, dispatch, claim/start, useful evidence persistence, worker completion, and authenticated view in order", async () => {
    const unitid = "92001", domain = "timing.example.edu";
    const created = await createRequest(unitid, domain);
    assert.equal(created.created, true);
    let dispatchCalls = 0;
    globalThis.fetch = async () => { dispatchCalls++; return new Response(null, { status: 204 }); };
    try { await D.wakeSchoolRequest(created); } finally { globalThis.fetch = originalFetch; }
    assert.equal(dispatchCalls, 1);

    const afterDispatch = await metrics(created.request.id);
    assert.equal(afterDispatch?.dispatch_outcome, "accepted");
    assert.ok(afterDispatch?.created_at);
    assert.ok(afterDispatch?.dispatch_attempted_at);
    assert.equal(afterDispatch?.first_claimed_at, null, "accepted dispatch is not a worker claim");
    assert.equal(afterDispatch?.first_visible_at, null);

    const claim = await Q.claimNextResearchJob();
    assert.equal(claim?.job.unitid, unitid);
    assert.equal(claim?.job.term, term);
    assert.ok(claim?.job.attemptId);
    const afterClaim = await metrics(created.request.id);
    assert.ok(afterClaim?.first_claimed_at);
    assert.ok(afterClaim?.started_at);
    assert.equal(afterClaim?.first_evidence_committed_at, null);
    assert.equal(afterClaim?.first_visible_at, null);

    const ingested = await P.ingestResearch({ unitid, term, attemptId: claim!.job.attemptId!, candidates: [candidate(domain)] });
    assert.equal(ingested.states.length, ALL_CHECKPOINTS.length);
    assert.equal(ingested.states.filter((row) => row.state === "verified").length, 1, "the useful view has a sourced finding, not zero findings");
    const afterPersistence = await metrics(created.request.id);
    assert.ok(afterPersistence?.first_evidence_committed_at);
    assert.equal(afterPersistence?.first_visible_at, null, "evidence persistence alone is not a displayed view");

    const finished = await Q.reportResearchJob({ unitid, term, attempt: claim!.job.attempts, attemptId: claim!.job.attemptId!, outcome: "review", costCents: 0, note: "bounded fixture completed" });
    assert.equal(finished.status, "review");
    const view = await P.familyResearchView(created.householdId, unitid, term);
    assert.equal(view?.length, ALL_CHECKPOINTS.length);
    assert.equal(view?.filter((row) => row.state === "verified" && !!row.sourceUrl && !!row.quote).length, 1);
    assert.equal((await P.familyResearchView("other-household", unitid, term)), null, "view remains household-authorized");

    await Q.markFamilyFirstView("other-household", created.request.id);
    assert.equal((await metrics(created.request.id))?.first_visible_at, null);
    await Q.markFamilyFirstView(created.householdId, created.request.id);
    const complete = await metrics(created.request.id);
    assert.ok(complete?.first_visible_at);
    assertOrdered(complete!.created_at, complete!.dispatch_attempted_at, complete!.first_claimed_at, complete!.started_at,
      complete!.first_evidence_committed_at, complete!.finished_at, complete!.first_visible_at);
  });

  it("keeps dispatch/worker failures committed and unmarked, then lets the scheduled queue recover them", async () => {
    const unitid = "92002", domain = "recovery.example.edu";
    const created = await createRequest(unitid, domain);
    globalThis.fetch = async () => { throw new Error("simulated dispatch transport failure"); };
    try { await D.wakeSchoolRequest(created); } finally { globalThis.fetch = originalFetch; }

    let row = await metrics(created.request.id);
    assert.equal(row?.dispatch_outcome, "failed");
    assert.ok(row?.dispatch_attempted_at);
    assert.equal(row?.status, "queued");
    assert.equal(row?.first_claimed_at, null);
    assert.equal(row?.first_evidence_committed_at, null);
    assert.equal(row?.first_visible_at, null);
    const duplicate = await Q.createSchoolRequest({ householdId: created.householdId, unitid, term });
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.request.id, created.request.id, "failure does not undo or duplicate the committed request");

    const failedAttempt = await Q.claimNextResearchJob();
    assert.equal(failedAttempt?.job.unitid, unitid, "the scheduled poll can claim a request despite failed immediate dispatch");
    await Q.markFamilyFirstView(created.householdId, created.request.id);
    assert.equal((await metrics(created.request.id))?.first_visible_at, null, "no worker result means no useful view");
    await Q.reportResearchJob({ unitid, term, attempt: failedAttempt!.job.attempts, attemptId: failedAttempt!.job.attemptId!, outcome: "failed", costCents: 0, note: "simulated transient worker failure" });
    row = await metrics(created.request.id);
    assert.equal(row?.status, "queued", "a transient failure remains retryable");
    assert.equal(row?.attempts, 1);
    assert.ok(row?.first_claimed_at);
    assert.equal(row?.first_evidence_committed_at, null);
    assert.equal(row?.first_visible_at, null);

    const retry = await Q.claimNextResearchJob();
    assert.equal(retry?.job.unitid, unitid);
    assert.equal(retry?.job.attempts, 2);
    assert.notEqual(retry?.job.attemptId, failedAttempt?.job.attemptId);
    await P.ingestResearch({ unitid, term, attemptId: retry!.job.attemptId!, candidates: [candidate(domain)] });
    await Q.reportResearchJob({ unitid, term, attempt: retry!.job.attempts, attemptId: retry!.job.attemptId!, outcome: "review", costCents: 0, note: "successful recovery fixture" });
    assert.equal((await P.familyResearchView(created.householdId, unitid, term))?.length, ALL_CHECKPOINTS.length);
    await Q.markFamilyFirstView(created.householdId, created.request.id);
    row = await metrics(created.request.id);
    assert.ok(row?.first_evidence_committed_at);
    assert.ok(row?.finished_at);
    assert.ok(row?.first_visible_at, "first-useful-view is recorded only after the recovered cited evidence is persisted and retrievable");
  });
});
