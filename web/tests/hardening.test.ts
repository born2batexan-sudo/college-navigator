import { describe,it,before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const dir=mkdtempSync(path.join(tmpdir(),"cn-hardening-"));
process.env.DB_PATH=path.join(dir,"hardening.sqlite3");delete process.env.DATABASE_URL;process.env.REQUEST_QUEUE_ENABLED="1";process.env.REQUEST_PIPELINE_ENABLED="1";process.env.REQUEST_MONTHLY_BUDGET_CENTS="5000";process.env.REQUEST_JOB_ESTIMATE_CENTS="800";
let R:typeof import("../lib/db/repo"),Q:typeof import("../lib/db/requests"),A:typeof import("../lib/db/accounts"),D:typeof import("../lib/db/client"),C:typeof import("../lib/coverage"),M:typeof import("../lib/materialize");
describe("secure research and queue invariants",()=>{
 before(async()=>{R=await import("../lib/db/repo");Q=await import("../lib/db/requests");A=await import("../lib/db/accounts");D=await import("../lib/db/client");C=await import("../lib/coverage");M=await import("../lib/materialize");});

 it("keeps remote Postgres TLS verification enabled and accepts an explicit CA",async()=>{
  const source=await import("node:fs/promises").then(fs=>fs.readFile(new URL("../lib/db/client.ts",import.meta.url),"utf8"));
  assert.match(source,/DATABASE_CA_CERT/);
  assert.match(source,/rejectUnauthorized:\s*true/);
  assert.doesNotMatch(source,/rejectUnauthorized:\s*false/);
 });
 it("never substitutes a researched term when the student's term is unknown",async()=>{
  const dashboard=await import("node:fs/promises").then(fs=>fs.readFile(new URL("../app/dashboard/page.tsx",import.meta.url),"utf8"));
  assert.doesNotMatch(dashboard,/enteringTermFrom\(student\)\s*\?\?/);
  assert.match(dashboard,/enteringTerm \? await listActionInstancesForRelationship/);
  const { termNotice }=await import("../lib/terms");
  assert.match(termNotice(null) ?? "",/Choose an entering term/);
 });
 it("rejects source-less, foreign-source, and off-domain evidence and isolates terms",async()=>{
  const one=await R.upsertInstitution({name:"Evidence One",slug:"evidence-one",domains:["one.edu"]});
  const two=await R.upsertInstitution({name:"Evidence Two",slug:"evidence-two",domains:["two.edu"]});
  await assert.rejects(()=>R.createSource({institutionId:one.id,url:"http://one.edu/policy",label:"insecure"}),/HTTPS/);
  const source=await R.createSource({institutionId:one.id,url:"https://admissions.one.edu/policy",label:"Policy"});
  const base={institutionId:two.id,checkpointCode:"ADM-01",domain:"Admissions",title:"Apply",critical:true,requirement:"Apply by the deadline",status:"verified",confidence:"high",researchTerm:"Fall 2027",cycleState:"current" as const,applicability:"applies" as const,evidenceQuote:"Applications are due December 1."};
  await assert.rejects(()=>R.upsertRule({...base,sourceId:null}),/Evidence-backed/);
  await assert.rejects(()=>R.upsertRule({...base,sourceId:source.id}),/same institution/);
  const own=await R.createSource({institutionId:two.id,url:"https://www.two.edu/apply",label:"Apply"});
  await R.upsertRule({...base,sourceId:own.id});
  await R.upsertRule({...base,researchTerm:"Winter 2028",status:"unverified",sourceId:null,evidenceQuote:null,cycleState:"undated"});
  const fall=await C.recomputeCoverage(two.id,"Fall 2027"),winter=await C.recomputeCoverage(two.id,"Winter 2028");
  assert.ok(fall.pct>winter.pct);assert.equal(winter.status,"unsupported");
 });
 it("materializes and lists actions only for the student's exact entering term",async()=>{
  const inst=await R.upsertInstitution({name:"Term Actions",slug:"term-actions",domains:["terms.edu"]});
  const source=await R.createSource({institutionId:inst.id,url:"https://terms.edu/requirements",label:"Requirements"});
  const account=await A.provisionAccount({authUserId:"term-actions",email:"terms@example.com"});
  const student=await A.completeOnboarding(account,{studentName:"Term Student",role:"parent",enteringTerm:"Fall 2027"});
  const rel=await R.upsertRelationship({studentId:student.id,institutionId:inst.id});
  for (const researchTerm of ["Fall 2027","Winter 2028"]) await R.upsertRule({institutionId:inst.id,checkpointCode:"ADM-02",domain:"Admissions",title:"Submit records",critical:true,requirement:`Submit records for ${researchTerm}`,status:"verified",confidence:"high",researchTerm,cycleState:"current",applicability:"applies",evidenceQuote:`Official requirements for ${researchTerm}.`,sourceId:source.id});
  await R.upsertRule({institutionId:inst.id,checkpointCode:"ADM-03",domain:"Admissions",title:"Low confidence",critical:true,requirement:"Do not show this.",status:"verified",confidence:"low",researchTerm:"Fall 2027",cycleState:"current",applicability:"applies",evidenceQuote:"A weakly supported statement.",sourceId:source.id});
  await R.upsertRule({institutionId:inst.id,checkpointCode:"ADM-04",domain:"Admissions",title:"Unverified",critical:true,requirement:"Do not show this either.",status:"unverified",confidence:"medium",researchTerm:"Fall 2027",cycleState:"undated",applicability:"not_yet_published",evidenceQuote:"The current date has not been published.",sourceId:source.id});
  await D.exec("UPDATE students SET attributes=$1 WHERE id=$2",[JSON.stringify({enteringTerm:"Fall 2027"}),student.id]);
  await M.materializeActionsForRelationship(rel.id);
  const fall=await R.listActionInstancesForRelationship(rel.id,"Fall 2027");
  assert.equal(fall.length,1,"unverified and low-confidence research must not reach a family plan");assert.equal(fall[0].rule.researchTerm,"Fall 2027");
  await D.exec("UPDATE students SET attributes=$1 WHERE id=$2",[JSON.stringify({enteringTerm:"Winter 2028"}),student.id]);
  await M.materializeActionsForRelationship(rel.id);
  const winter=await R.listActionInstancesForRelationship(rel.id,"Winter 2028");
  assert.equal(winter.length,1);assert.equal(winter[0].rule.researchTerm,"Winter 2028");
  assert.equal((await R.listActionInstancesForRelationship(rel.id,"Summer 2028")).length,0);
 });
 it("denies guessed queue slugs before ready, across households, and across terms",async()=>{
  const inst=await R.upsertInstitution({name:"Private Queue",slug:"private-queue",domains:["private.edu"]});
  await Q.upsertDirectorySchool({unitid:"890",name:"Private Queue",domain:"private.edu"});await Q.linkDirectoryInstitution("890","private-queue");
  const owner=await A.provisionAccount({authUserId:"view-owner",email:"owner@example.com"}),other=await A.provisionAccount({authUserId:"view-other",email:"other@example.com"});
  await Q.createSchoolRequest({householdId:owner.household.id,unitid:"890",term:"Fall 2027"});
  assert.equal(await Q.canHouseholdViewInstitution(owner.household.id,inst.id,"Fall 2027"),false);
  await D.exec("INSERT INTO research_versions(institution_id,research_term,coverage_status,coverage_pct,critical_gaps,certified_at,updated_at) VALUES($1,'Fall 2027','certified',100,0,$2,$3) ON CONFLICT(institution_id,research_term) DO UPDATE SET coverage_status='certified',coverage_pct=100,critical_gaps=0",[inst.id,D.nowIso(),D.nowIso()]);
  await D.exec("UPDATE school_research_jobs SET status='ready' WHERE unitid='890' AND term='Fall 2027'");
  assert.equal(await Q.canHouseholdViewInstitution(owner.household.id,inst.id,"Fall 2027"),false,"legacy percentage and ready row cannot bypass reviewed publish gate");
  assert.equal(await Q.canHouseholdViewInstitution(other.household.id,inst.id,"Fall 2027"),false);
  assert.equal(await Q.canHouseholdViewInstitution(owner.household.id,inst.id,"Winter 2028"),false);
 });
 it("holds blank-domain work without a reservation",async()=>{
  await Q.upsertDirectorySchool({unitid:"900",name:"No Domain"});const hh=await A.provisionAccount({authUserId:"blank-domain",email:"blank@example.com"});await Q.createSchoolRequest({householdId:hh.household.id,unitid:"900",term:"Fall 2027"});
  assert.equal(await Q.claimNextResearchJob(),null);assert.equal((await Q.getResearchJob("900","Fall 2027"))?.status,"review");
  assert.equal(Number((await D.queryOne<any>("SELECT COUNT(*) AS n FROM budget_ledger"))?.n),0);
 });
 it("retains the conservative reservation when actual cost is unknown",async()=>{
  await Q.upsertDirectorySchool({unitid:"901",name:"Unknown Cost",domain:"cost.edu"});const hh=await A.provisionAccount({authUserId:"unknown-cost",email:"cost@example.com"});await Q.createSchoolRequest({householdId:hh.household.id,unitid:"901",term:"Fall 2027"});const claim=await Q.claimNextResearchJob();assert.ok(claim?.job.attemptId);
  await Q.reportResearchJob({unitid:"901",term:"Fall 2027",attempt:claim!.job.attempts,attemptId:claim!.job.attemptId!,outcome:"review"});
  assert.equal(Number((await D.queryOne<any>("SELECT SUM(cents) AS n FROM budget_ledger"))?.n),800);
 });
 it("recovers an expired lease with a fresh attempt while retaining its reservation",async()=>{
  await Q.upsertDirectorySchool({unitid:"902",name:"Lease College",domain:"lease.edu"});const hh=await A.provisionAccount({authUserId:"lease",email:"lease@example.com"});await Q.createSchoolRequest({householdId:hh.household.id,unitid:"902",term:"Fall 2027"});const first=await Q.claimNextResearchJob();assert.ok(first?.job.attemptId);await D.exec("UPDATE school_research_jobs SET lease_expires_at='2000-01-01T00:00:00.000Z' WHERE unitid='902'");const second=await Q.claimNextResearchJob();assert.ok(second);assert.equal(second!.job.attempts,2);assert.notEqual(second!.job.attemptId,first!.job.attemptId);
  await Q.reportResearchJob({unitid:"902",term:"Fall 2027",attempt:2,attemptId:second!.job.attemptId!,outcome:"review",costCents:0});
 });
 it("serializes concurrent household quota writes and deletes request-bearing households",async()=>{
  const hh=await A.provisionAccount({authUserId:"concurrent-quota",email:"quota@example.com"});for(let i=0;i<4;i++)await Q.upsertDirectorySchool({unitid:`91${i}`,name:`Quota ${i}`,domain:`q${i}.edu`});
  const results=await Promise.allSettled(Array.from({length:4},(_,i)=>Q.createSchoolRequest({householdId:hh.household.id,unitid:`91${i}`,term:"Fall 2027"})));
  assert.equal(results.filter(r=>r.status==="fulfilled").length,3);assert.equal(results.filter(r=>r.status==="rejected").length,1);
  await A.deleteHousehold(hh.household.id);assert.equal((await Q.listFamilyRequests(hh.household.id)).length,0);
 });
});

