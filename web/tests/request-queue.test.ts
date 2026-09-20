import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "cn-queue-"));
process.env.DB_PATH = path.join(dir, "queue.sqlite3");
delete process.env.DATABASE_URL;
process.env.REQUEST_QUEUE_ENABLED = "1";
process.env.REQUEST_MONTHLY_BUDGET_CENTS = "1600";

let A: typeof import("../lib/db/accounts");
let Q: typeof import("../lib/db/requests");

describe("school request queue", () => {
  before(async () => { A = await import("../lib/db/accounts"); Q = await import("../lib/db/requests"); });

  it("searches an idempotent directory and deduplicates a family request", async () => {
    await Q.upsertDirectorySchool({ unitid: "100", name: "Example University", city: "Austin", state: "TX", website: "https://example.edu" });
    await Q.upsertDirectorySchool({ unitid: "100", name: "Example University", city: "Austin", state: "TX", website: "https://example.edu" });
    assert.equal((await Q.searchDirectory("austin")).length, 1);
    const ctx = await A.provisionAccount({ authUserId: "queue-user", email: "queue@example.com" });
    await A.completeOnboarding(ctx, { studentName: "Queue Student", role: "parent" });
    const first = await Q.createSchoolRequest({ householdId: ctx.household.id, unitid: "100", term: "Fall 2027" });
    const again = await Q.createSchoolRequest({ householdId: ctx.household.id, unitid: "100", term: "Fall 2027" });
    assert.equal(first.created, true); assert.equal(again.created, false); assert.equal(first.request.id, again.request.id);
  });

  it("deduplicates by school and start term and reports term demand", async () => {
    const ctx = await A.provisionAccount({ authUserId: "queue-user-terms", email: "terms@example.com" });
    await Q.upsertDirectorySchool({ unitid: "105", name: "Term College" });
    const fall = await Q.createSchoolRequest({ householdId: ctx.household.id, unitid: "105", term: "Fall 2027" });
    const winter = await Q.createSchoolRequest({ householdId: ctx.household.id, unitid: "105", term: "Winter 2028" });
    assert.equal(fall.created, true);
    assert.equal(winter.created, true);
    assert.notEqual(fall.request.job?.term, winter.request.job?.term);
    const overview = await Q.queueOverview();
    assert.ok(overview.demandByTerm.some((row) => row.term === "Fall 2027" && row.requests >= 1));
    assert.ok(overview.demandByTerm.some((row) => row.term === "Winter 2028" && row.requests >= 1));
  });

  it("enforces three new requests per UTC calendar month and one active claim", async () => {
    const ctx = await A.provisionAccount({ authUserId: "queue-user-2", email: "queue2@example.com" });
    const schools = [["101", "One College"], ["102", "Two College"], ["103", "Three College"]] as const;
    for (const [unitid, name] of schools) {
      await Q.upsertDirectorySchool({ unitid, name });
      await Q.createSchoolRequest({ householdId: ctx.household.id, unitid, term: "Fall 2027" });
    }
    await Q.upsertDirectorySchool({ unitid: "104", name: "Four College" });
    await assert.rejects(() => Q.createSchoolRequest({ householdId: ctx.household.id, unitid: "104", term: "Fall 2027" }), /three new schools/);
    const claim = await Q.claimNextResearchJob();
    assert.ok(claim); assert.equal(claim?.job.attempts, 1);
    assert.equal(await Q.claimNextResearchJob(), null);
    const reviewed = await Q.reportResearchJob({ unitid: claim!.job.unitid, term: claim!.job.term, attempt: 1, outcome: "review", costCents: 0, note: "test hold" });
    assert.equal(reviewed.status, "review");
  });
});
