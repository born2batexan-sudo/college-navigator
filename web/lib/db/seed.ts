/**
 * Seed script.
 *
 * Populates the full 144-point checkpoint index (Appendix A of the Master
 * Transfer Brief) for the University of Alabama as the golden-master
 * institution, with ~25 checkpoints filled in from real, fetched, dated
 * official sources (research performed 2026-09-07) and the remainder left
 * as explicit "unverified / queued for research" stubs. This is
 * deliberately honest about coverage rather than fabricated — the
 * Institutional Research Agent (agents/research_agent.py) is what closes
 * the remaining gaps, the same way it would for a human analyst picking up
 * where this seed leaves off.
 *
 * The other five pressure-test schools are created as Institutions with
 * no rules yet (coverageStatus "unsupported", coveragePct 0) so the
 * multi-school household model is real from day one, per the vertical
 * slice decision: Alabama is fully modeled first, the rest are next.
 *
 * Run with: npm run db:seed
 */

import {
  upsertInstitution,
  createSource,
  findSourceByUrl,
  upsertRule,
  upsertGuidance,
  createObservationPattern,
  listObservationPatternsForInstitution,
  upsertHousehold,
  createPerson,
  listPeopleForHousehold,
  upsertStudent,
  upsertRelationship,
  getRuleByCode,
  updateActionInstance,
  createActionEvent,
  findActionInstance,
} from "./repo";
import { materializeActionsForRelationship } from "../materialize";
import { ALL_CHECKPOINTS } from "../checkpoints";
import { recomputeCoverage } from "../coverage";

// ---------------------------------------------------------------------
// 0. Small idempotency helpers, local to this file.
//
// upsertInstitution / upsertRule / upsertGuidance / upsertRelationship /
// upsertStudent are already find-or-create by a stable natural key, so
// re-running this seed against an existing database is safe for them.
// createPerson, createSource, and createObservationPattern are plain
// inserts everywhere else they're used (e.g. real account provisioning
// always wants a brand-new row), so this seed — which is the one caller
// that must tolerate being re-run against a shared dev/staging database —
// guards each of its own calls with its own find-before-create check
// instead of changing that shared, intentionally-always-new behavior.
// ---------------------------------------------------------------------

async function ensureDemoPerson(input: { householdId: string; name: string; role: string; email: string; consentState?: string }) {
  const existing = (await listPeopleForHousehold(input.householdId)).find((p) => p.email === input.email);
  if (existing) return existing;
  return createPerson(input);
}

async function ensureSource(input: { institutionId: string; url: string; label: string; owner?: string; lastVerified?: string }) {
  const existing = await findSourceByUrl(input.institutionId, input.url);
  if (existing) return existing;
  return createSource(input);
}

async function ensureObservationPattern(input: {
  institutionId: string;
  workflow: string;
  urlPattern: string;
  signal: string;
  impliesState: string;
  relatedCheckpointCode?: string | null;
}) {
  const existing = (await listObservationPatternsForInstitution(input.institutionId)).find(
    (p) => p.workflow === input.workflow && p.urlPattern === input.urlPattern && p.relatedCheckpointCode === (input.relatedCheckpointCode ?? null)
  );
  if (existing) return existing;
  return createObservationPattern(input);
}

const RESEARCH_DATE = "2026-09-07T00:00:00.000Z";

// ---------------------------------------------------------------------
// 1. The full 144-point checkpoint index (shared with the agent API)
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// 2. Sources actually fetched and read during research (2026-09-07)
// ---------------------------------------------------------------------

const SOURCES = {
  steps: { url: "https://admissions.ua.edu/freshman/steps/", label: "Freshman Steps to Enrollment", owner: "Undergraduate Admissions" },
  deposit: { url: "https://admissions.ua.edu/freshman/deposit/", label: "Freshman Enrollment Deposit", owner: "Undergraduate Admissions" },
  aidTimeline: { url: "https://afford.ua.edu/timeline/", label: "Financial Aid Timeline", owner: "Office of Student Financial Aid (Afford)" },
  housingGuide: { url: "https://housing.sl.ua.edu/posts/guides/2025/2026-27-housing-application-guide/", label: "2026-27 Housing Application Guide", owner: "Housing and Residential Communities" },
  immunization: { url: "https://cchs.ua.edu/shc/immunization/", label: "Immunization Requirements", owner: "Student Health Center" },
  panhellenic: { url: "https://www.uapanhellenic.com/fall-primary-recruitment", label: "Fall Primary Recruitment", owner: "UA Panhellenic Association" },
  paymentMethods: { url: "https://studentaccounts.ua.edu/payment-methods/", label: "Student Account Services - Payment Methods", owner: "Student Account Services" },
  actionCard: { url: "https://catalog.ua.edu/undergraduate/about/support-programs/action-card/", label: "Action Card", owner: "Action Card Office" },
} as const;

type SourceKey = keyof typeof SOURCES;

// ---------------------------------------------------------------------
// 3. Researched overrides — real facts, real sources, real dates.
//    Anything not listed here stays an honest "unverified" stub.
// ---------------------------------------------------------------------

type Override = {
  requirement: string;
  trigger?: string;
  population?: string;
  deadlineExpr?: string;
  costCents?: number;
  refundable?: "yes" | "no" | "partial" | "unknown";
  consequence?: string;
  status: "verified" | "unverified";
  confidence: "high" | "medium" | "low";
  sourceKey: SourceKey;
  dependsOnCode?: string;
};

const OVERRIDES: Record<string, Override> = {
  "ADM-03": {
    requirement:
      "Priority deadline for Summer/Fall 2027 freshman admission is December 4 (2026). Priority deadline for Spring 2027 admission and the final deadline for automatic merit/competitive scholarships is November 2 (2026).",
    deadlineExpr: "2026-12-04",
    consequence: "Applications after the priority date are still reviewed but may lose scholarship eligibility and lose housing/orientation positioning.",
    status: "verified",
    confidence: "high",
    sourceKey: "steps",
  },
  "ENR-01": {
    requirement: "Intent to enroll is expressed by submitting the $200 Freshman Enrollment Deposit through myBama (Admissions/Scholarships section).",
    trigger: "admitted",
    status: "verified",
    confidence: "high",
    sourceKey: "deposit",
  },
  "ENR-02": {
    requirement: "Freshman Enrollment Deposit is $200.",
    trigger: "admitted",
    costCents: 20000,
    refundable: "no",
    status: "verified",
    confidence: "high",
    sourceKey: "deposit",
  },
  "ENR-03": {
    requirement:
      "No single published calendar deadline; in practice the deposit must be paid before the student can apply for housing (opens ~Oct 1) or register for Bama Bound orientation, which functions as the operative deadline pressure.",
    trigger: "admitted",
    consequence: "Delays housing application eligibility and orientation registration, both of which have their own priority cutoffs.",
    status: "verified",
    confidence: "medium",
    sourceKey: "deposit",
  },
  "ENR-05": {
    requirement: "Deposit is nonrefundable; it is applied toward the student's first semester tuition.",
    trigger: "admitted",
    refundable: "no",
    status: "verified",
    confidence: "high",
    sourceKey: "deposit",
  },
  "ENR-07": {
    requirement:
      "The Freshman Steps to Enrollment page (admissions.ua.edu/freshman/steps) is the official admitted-student checklist: deposit, housing, orientation, medical history/immunization, and move-in prep.",
    trigger: "admitted",
    status: "verified",
    confidence: "high",
    sourceKey: "steps",
  },
  "AID-01": {
    requirement: "FAFSA applies to all students seeking need-based aid; FAFSA opens in October for Summer/Fall applicants. Spring applicants should file as soon as possible after applying.",
    status: "verified",
    confidence: "high",
    sourceKey: "aidTimeline",
  },
  "AID-03": {
    requirement: "Priority financial aid deadline for first-time freshmen entering Fall 2027 is December 4 (2026), matching the admissions priority deadline.",
    trigger: "admitted",
    deadlineExpr: "2026-12-04",
    consequence: "Filing after the priority date can delay or reduce need-based aid packaging.",
    status: "verified",
    confidence: "high",
    sourceKey: "aidTimeline",
  },
  "AID-06": {
    requirement: "Award notifications go out in February (competitive scholarships) and April (departmental awards) for freshmen.",
    trigger: "admitted",
    status: "verified",
    confidence: "high",
    sourceKey: "aidTimeline",
  },
  "BIL-04": {
    requirement:
      "Monthly payment plans available: 4, 3, or 2 payments depending on term. Enrollment requires a $30 processing fee plus the first installment, and must be re-enrolled each term. Fall 4-payment signup deadline July 31; 3-payment deadline September 21 (dates shift slightly each year but follow this pattern).",
    trigger: "admitted",
    costCents: 3000,
    deadlineExpr: "30 days after admission",
    status: "verified",
    confidence: "high",
    sourceKey: "paymentMethods",
  },
  "BIL-06": {
    requirement: "Accepted payment methods: free electronic check (24/7), credit/debit card (3.0% convenience fee, $3 minimum; 4.25% international), wire transfer, and paper check.",
    status: "verified",
    confidence: "high",
    sourceKey: "paymentMethods",
  },
  "BIL-07": {
    requirement: "529 plan and prepaid tuition payments are submitted electronically through the university's Backpack portal, which integrates directly with the Cashier's Office and is free to use.",
    status: "verified",
    confidence: "high",
    sourceKey: "paymentMethods",
  },
  "BIL-08": {
    requirement:
      "Backpack provides immediate notification when a 529 transfer is initiated; the university encourages families to use Backpack rather than requesting a paper check directly from the 529 plan administrator to avoid posting delays.",
    status: "verified",
    confidence: "medium",
    sourceKey: "paymentMethods",
  },
  "BIL-11": {
    requirement: "Late fees may apply if a payment plan installment is not made by its due date; the exact fee amount is not published on this page and needs a follow-up source.",
    status: "verified",
    confidence: "medium",
    sourceKey: "paymentMethods",
  },
  "HOU-02": {
    requirement: "Housing applications for 2026-27 open October 1, 2026.",
    trigger: "admitted",
    deadlineExpr: "2026-10-01",
    status: "verified",
    confidence: "high",
    sourceKey: "steps",
  },
  "HOU-03": {
    requirement: "Housing Deposit is $175 total: a $140 prepayment (credited toward the housing contract) plus a $35 non-refundable application fee.",
    trigger: "admitted",
    costCents: 17500,
    refundable: "partial",
    status: "verified",
    confidence: "high",
    sourceKey: "housingGuide",
  },
  "HOU-04": {
    requirement:
      "Incoming freshmen who submit the housing application by February 2 (2027) are eligible to participate in online room selection; later applicants receive staff-assigned rooms instead.",
    trigger: "admitted",
    deadlineExpr: "2027-02-02",
    consequence: "Missing the cutoff removes the student's ability to choose their own room/roommate; a room is assigned instead.",
    status: "verified",
    confidence: "high",
    sourceKey: "housingGuide",
  },
  "HOU-05": {
    requirement: "Students must be accepted to UA and have paid the Freshman Enrollment Deposit before they can submit a housing application.",
    trigger: "admitted",
    dependsOnCode: "ENR-02",
    status: "verified",
    confidence: "high",
    sourceKey: "housingGuide",
  },
  "HOU-07": {
    requirement: "Room selection eligibility and timing follow the same February 2 priority cutoff as HOU-04 (self-select online vs. staff assignment).",
    trigger: "admitted",
    status: "verified",
    confidence: "medium",
    sourceKey: "housingGuide",
  },
  "HOU-08": {
    requirement:
      "Students may cancel a housing application before the applicable deadline for a refund of the $140 prepayment; the $35 application fee is explicitly non-refundable in all cases. Exact cancellation deadlines by term were not published on this page.",
    trigger: "admitted",
    refundable: "partial",
    status: "verified",
    confidence: "medium",
    sourceKey: "housingGuide",
  },
  "HLT-01": {
    requirement:
      "Required immunizations: MenACWY (meningitis, one dose after age 16) for students under 21 or in campus housing; MMR (2 doses or proof of immunity); Varicella (2 doses or proof of immunity); Tdap (within 10 years); TB risk-assessment screening. Distance learners are exempt.",
    trigger: "admitted",
    status: "verified",
    confidence: "high",
    sourceKey: "immunization",
  },
  "HLT-02": {
    requirement: "Immunization documentation is submitted through myBama: print the required form from the Student Health Center section, have a healthcare provider complete and sign it, then scan and upload.",
    trigger: "admitted",
    status: "verified",
    confidence: "high",
    sourceKey: "immunization",
  },
  "HLT-03": {
    requirement:
      "No explicit calendar deadline is published; the page references a 'Health Requirement for Registration' policy, implying a registration hold is possible for non-compliance. Needs direct confirmation from the registrar's policy page.",
    trigger: "admitted",
    status: "verified",
    confidence: "medium",
    sourceKey: "immunization",
  },
  "HLT-04": {
    requirement: "Admitted students must submit the Medical History Form and Proof of Immunization to the Student Health Center immediately upon admission.",
    trigger: "admitted",
    status: "verified",
    confidence: "high",
    sourceKey: "steps",
  },
  "LOG-01": {
    requirement:
      "UA is a mobile-first campus; the Action Card (student ID) is obtained by submitting a photo/ID at actcard.ua.edu/photosubmit, with approval sent to the student's Crimson email, then downloaded as a Mobile ACT Card. Used for athletics, libraries, recreation facilities, computer labs, Student Health Center, residence hall access, and Bama Cash/Dining Dollars/Meal Plan balances.",
    trigger: "admitted",
    status: "verified",
    confidence: "high",
    sourceKey: "actionCard",
  },
  "GRK-02": {
    requirement: "Fall Primary Recruitment registration opened May 1, 2026 at 10:00am CT (annual pattern; exact date shifts year to year and needs re-verification each cycle).",
    trigger: "admitted",
    population: "greek_pnm",
    deadlineExpr: "2026-05-01",
    status: "verified",
    confidence: "high",
    sourceKey: "panhellenic",
  },
  "GRK-04": {
    requirement: "Recruitment registration fee is $375; add an early move-in fee of $185 (total $560 if opting into early move-in). All registration fees are explicitly non-refundable, no exceptions.",
    trigger: "admitted",
    population: "greek_pnm",
    costCents: 37500,
    refundable: "no",
    status: "verified",
    confidence: "high",
    sourceKey: "panhellenic",
  },
  "GRK-06": {
    requirement:
      "2026 recruitment ran August 8-16: Aug 8 Convocation/Open House, Aug 9-11 Philanthropy Days I-III, Aug 12-14 Sisterhood Days I-III, Aug 15 Preference Day, Aug 16 Bid Day.",
    trigger: "admitted",
    population: "greek_pnm",
    status: "verified",
    confidence: "high",
    sourceKey: "panhellenic",
  },
  "GRK-08": {
    requirement:
      "A dedicated 'Letters of Recommendation' section exists (About Rec Letters, Chapter-Specific Recommendations, FAQs) but the specific per-chapter guidance was not extracted from this pass and needs a follow-up fetch.",
    trigger: "admitted",
    population: "greek_pnm",
    status: "verified",
    confidence: "low",
    sourceKey: "panhellenic",
  },
};

// ---------------------------------------------------------------------
// 4. The other five pressure-test schools (not yet researched)
// ---------------------------------------------------------------------

const OTHER_SCHOOLS = [
  { name: "University of Arkansas", slug: "arkansas", domains: ["admissions.uark.edu", "uagreeks.uark.edu", "career.uark.edu"] },
  { name: "University of Oklahoma", slug: "oklahoma", domains: ["ou.edu"] },
  { name: "University of Texas at Austin", slug: "ut-austin", domains: ["admissions.utexas.edu", "onestop.utexas.edu", "orientation.utexas.edu", "texaspanhellenic.com"] },
  { name: "Texas A&M University", slug: "texas-am", domains: ["admissions.tamu.edu", "sbs.tamu.edu", "cpc.tamu.edu", "careercenter.tamu.edu"] },
  { name: "University of Arizona", slug: "arizona", domains: ["orientation.arizona.edu", "housing.arizona.edu", "bursar.arizona.edu", "greek.arizona.edu", "career.arizona.edu"] },
];

export async function main() {
  console.log("Seeding College Navigator...");

  const alabama = await upsertInstitution({
    name: "University of Alabama",
    slug: "alabama",
    domains: ["admissions.ua.edu", "afford.ua.edu", "housing.sl.ua.edu", "cchs.ua.edu", "uapanhellenic.com", "studentaccounts.ua.edu", "catalog.ua.edu", "actcard.ua.edu", "mybama.ua.edu"],
    pathway: "both",
    coverageStatus: "research",
  });

  const sourceIds: Record<SourceKey, string> = {} as Record<SourceKey, string>;
  for (const [key, s] of Object.entries(SOURCES)) {
    const created = await ensureSource({ institutionId: alabama.id, url: s.url, label: s.label, owner: s.owner, lastVerified: RESEARCH_DATE });
    sourceIds[key as SourceKey] = created.id;
  }

  let verifiedCount = 0;
  for (const cp of ALL_CHECKPOINTS) {
    const override = OVERRIDES[cp.code];
    // Legacy seed overrides predate quote-level evidence. Keep their sourced
    // text for local UI demos, but do not represent them as verified.

    await upsertRule({
      institutionId: alabama.id,
      checkpointCode: cp.code,
      domain: cp.domain,
      title: cp.title,
      critical: cp.critical,
      population: override?.population ?? "all",
      requirement: override?.requirement ?? "Not yet researched — queued for the Institutional Research Agent.",
      trigger: override?.trigger ?? (cp.code.startsWith("ADM") ? null : "admitted"),
      dependsOnCode: override?.dependsOnCode ?? null,
      deadlineExpr: override?.deadlineExpr ?? null,
      costCents: override?.costCents ?? null,
      refundable: override?.refundable ?? "unknown",
      consequence: override?.consequence ?? null,
      status: "unverified",
      confidence: override?.confidence ?? "low",
      researchTerm: "Fall 2027",
      cycleState: "undated",
      applicability: "applies",
      verifiedAt: null,
      sourceId: override ? sourceIds[override.sourceKey] : null,
    });
  }

  const { pct: coveragePct, status: coverageStatus } = await recomputeCoverage(alabama.id);
  console.log(`Alabama: ${verifiedCount}/${ALL_CHECKPOINTS.length} checkpoints verified (${coveragePct}%, ${coverageStatus}).`);

  // Hand-authored GuidanceAssets showing the shape the Guidance Generation
  // Agent (agents/guidance_agent.py) produces for the rest.
  const guidanceSeeds = [
    {
      code: "ENR-02",
      what: "Pay the $200 Freshman Enrollment Deposit.",
      when: "As soon as possible after admission — it gates housing and orientation registration.",
      why: "This deposit is how you tell Alabama you intend to enroll, and it's applied toward your first semester's tuition.",
      how: "Log into myBama, go to the Admissions/Scholarships section, and select 'Submit Freshman Enrollment Deposit.'",
      consequence: "You can't apply for housing or register for Bama Bound orientation until this is paid.",
      deepLink: "https://admissions.ua.edu/freshman/deposit/",
    },
    {
      code: "HOU-04",
      what: "Submit your housing application before February 2.",
      when: "By February 2, 2027 for the 2027-28 academic year, to be eligible for online room selection.",
      why: "Applying after this date means Alabama assigns you a room instead of letting you pick one.",
      how: "Complete the housing application and $175 housing deposit ($140 prepayment + $35 non-refundable fee) through the housing portal after your enrollment deposit is on file.",
      consequence: "Miss it and you lose the ability to choose your own room and roommate.",
      deepLink: "https://housing.sl.ua.edu/incoming-students/apply/",
    },
    {
      code: "HLT-01",
      what: "Submit your Medical History Form and immunization records (MenACWY, MMR, Varicella, Tdap, TB screening).",
      when: "Immediately upon admission — no fixed calendar date, but it can hold your registration if delayed.",
      why: "Alabama requires proof of these immunizations before you can fully register for classes.",
      how: "Print the required form from the Student Health Center section of myBama, have a healthcare provider complete and sign it, then scan and upload it back through myBama.",
      consequence: "Incomplete or incorrectly formatted submissions are rejected outright, and a registration hold is possible.",
      deepLink: "https://cchs.ua.edu/shc/immunization/",
    },
  ];

  for (const g of guidanceSeeds) {
    const rule = await getRuleByCode(alabama.id, g.code);
    if (!rule) continue;
    await upsertGuidance({ ruleId: rule.id, what: g.what, when: g.when, why: g.why, how: g.how, consequence: g.consequence, deepLink: g.deepLink, generatedBy: "human" });
  }

  await ensureObservationPattern({
    institutionId: alabama.id,
    workflow: "housing_application",
    urlPattern: "housing.sl.ua.edu/*",
    signal: "application submitted",
    impliesState: "submitted",
    relatedCheckpointCode: "HOU-04",
  });
  await ensureObservationPattern({
    institutionId: alabama.id,
    workflow: "enrollment_deposit",
    urlPattern: "mybama.ua.edu/*deposit*",
    signal: "deposit received",
    impliesState: "received",
    relatedCheckpointCode: "ENR-02",
  });
  await ensureObservationPattern({
    institutionId: alabama.id,
    workflow: "immunization_upload",
    urlPattern: "mybama.ua.edu/*immunization*",
    signal: "compliant",
    impliesState: "complete",
    relatedCheckpointCode: "HLT-01",
  });

  for (const s of OTHER_SCHOOLS) {
    await upsertInstitution({ name: s.name, slug: s.slug, domains: s.domains, pathway: "both", coverageStatus: "unsupported", coveragePct: 0 });
  }

  // --- Demo household ---
  const household = await upsertHousehold({ id: "demo-household", name: "Taylor Household" });
  await ensureDemoPerson({ householdId: household.id, name: "Jordan Taylor", role: "student", email: "jordan.taylor.demo@example.com", consentState: "granted" });
  await ensureDemoPerson({ householdId: household.id, name: "Dana Taylor", role: "parent", email: "dana.taylor.demo@example.com", consentState: "granted" });

  const student = await upsertStudent({
    id: "demo-student",
    householdId: household.id,
    name: "Jordan Taylor",
    gradYear: 2027,
    applicantType: "freshman",
    residency: "out_of_state",
    // enteringTerm is set explicitly (rather than left to the welcome page's
    // own default) so this seed's own materialization below — and every
    // fresh clone of it — actually has real, non-empty actions to show.
    attributes: { gpaBand: "3.5-3.79", enteringTerm: "Fall 2027", housingPlan: "on_campus", greekInterest: true, disabilityAccommodation: false },
  });

  const alabamaRel = await upsertRelationship({ studentId: student.id, institutionId: alabama.id, lifecycleState: "admitted", decisionDate: "2026-12-15T00:00:00.000Z" });

  for (const s of OTHER_SCHOOLS) {
    const inst = await upsertInstitution({ name: s.name, slug: s.slug, domains: s.domains });
    await upsertRelationship({ studentId: student.id, institutionId: inst.id, lifecycleState: "considering" });
  }

  console.log("Materializing Action Ledger for the Alabama relationship...");
  const materialized = await materializeActionsForRelationship(alabamaRel.id);
  const applicableCount = materialized.filter((m) => m.applicable).length;
  console.log(`Evaluated ${materialized.length} rules, ${applicableCount} applicable ActionInstances created for the demo household.`);

  // A second, genuinely distinct student profile in the same demo household,
  // so the signed-in Private Preview itself — not only the public marketing
  // mock in lib/landing-demo.ts — demonstrates a combined household view
  // plus real per-student switching. Both are Class of 2027 / Fall 2027
  // applicants in the same admissions cycle, while their pathways remain
  // deliberately different:
  //   - a different lifecycle stage ("considering" vs "admitted")
  //   - a smaller, different set of tracked schools (2 vs 6)
  //   - different priorities and preferences (no Greek interest, needs
  //     accommodations, bringing a car, housing undecided, in-state residency)
  // Both students are upserted by a fixed id, so re-running this seed never
  // duplicates either one (see tests/demo-household.test.ts).
  const secondStudent = await upsertStudent({
    id: "demo-student-2",
    householdId: household.id,
    name: "Morgan Taylor",
    gradYear: 2027,
    applicantType: "freshman",
    residency: "in_state",
    attributes: { gpaBand: "3.2-3.49", enteringTerm: "Fall 2027", housingPlan: "undecided", greekInterest: false, disabilityAccommodation: true, bringingCar: true },
  });
  await ensureDemoPerson({ householdId: household.id, name: "Morgan Taylor", role: "student", email: "morgan.taylor.demo@example.com", consentState: "granted" });

  const morganAlabamaRel = await upsertRelationship({ studentId: secondStudent.id, institutionId: alabama.id, lifecycleState: "considering" });
  const arkansas = OTHER_SCHOOLS.find((s) => s.slug === "arkansas")!;
  const arkansasInstitution = await upsertInstitution({ name: arkansas.name, slug: arkansas.slug, domains: arkansas.domains });
  await upsertRelationship({ studentId: secondStudent.id, institutionId: arkansasInstitution.id, lifecycleState: "considering" });

  // Materializing here (rather than skipping it) keeps Morgan on the exact
  // same idempotent, re-runnable path as Jordan. It is expected to produce
  // zero ActionInstances against the real Alabama index: that index is
  // researched only for Fall 2027, and materializeActionsForRelationship()
  // never substitutes a different cycle's rules for an unresearched term.
  // That empty, honestly labeled queue (see lib/terms.ts termNotice) is
  // itself part of the demonstration, not a gap.
  await materializeActionsForRelationship(morganAlabamaRel.id);

  // ---------------------------------------------------------------------
  // 5. A dedicated, clearly fictional practice institution for the demo
  //    household's action ledger.
  //
  // Every real Alabama checkpoint above is intentionally kept "unverified"
  // (see the loop above and the OVERRIDES comment) because it lacks a
  // quote-level evidence citation, and listRulesForInstitution() — the same
  // gate every real household's plan goes through — only ever surfaces
  // status="verified" + confidence in (high, medium) rules. That is a
  // safety property, not a bug, and this seed must not weaken it by
  // stamping unverified real-school research as "verified" just to make a
  // demo look fuller.
  //
  // So the Private Preview's action queue is instead powered by a small,
  // explicitly fictional practice school ("Example Demo University" — not a
  // real institution, never offered in the real /welcome picker because it
  // is not in TRACKABLE_SCHOOL_SLUGS). Its evidence quotes say plainly that
  // they are illustrative. This lets the signed-in demo honestly show a
  // real, varied, per-student action ledger — not just the public
  // marketing mock in lib/landing-demo.ts — without ever implying the real
  // University of Alabama research is more complete than it is.
  // ---------------------------------------------------------------------
  const demoSchool = await upsertInstitution({
    name: "Example Demo University",
    slug: "example-demo-university",
    domains: ["admissions.example-demo-university.edu", "housing.example-demo-university.edu"],
    pathway: "both",
    coverageStatus: "unsupported",
    coveragePct: 0,
  });
  const demoSource = await ensureSource({
    institutionId: demoSchool.id,
    url: "https://admissions.example-demo-university.edu/private-preview-demo",
    label: "Illustrative example only — Example Demo University is fictional and used solely to power the Private Preview demo household",
    owner: "Fictional Example Demo University",
    lastVerified: RESEARCH_DATE,
  });
  const DEMO_RULES = [
    { code: "DEMO-01", domain: "Enrollment", title: "Pay the enrollment deposit", critical: true, population: "all", trigger: "admitted", deadlineExpr: "2027-01-15",
      requirement: "Illustrative example: pay the enrollment deposit to confirm intent to enroll.", quote: "Illustrative example: the enrollment deposit confirms a student's intent to enroll." },
    { code: "DEMO-02", domain: "Housing", title: "Submit the housing application", critical: false, population: "campus_housing", trigger: "admitted", deadlineExpr: "2027-02-01",
      requirement: "Illustrative example: submit a housing application to be eligible for room selection.", quote: "Illustrative example: housing applications determine eligibility for room selection." },
    { code: "DEMO-03", domain: "Health", title: "Upload immunization records", critical: true, population: "all", trigger: "admitted", deadlineExpr: null as string | null,
      requirement: "Illustrative example: upload immunization records before registering for classes.", quote: "Illustrative example: immunization records are required before class registration." },
    { code: "DEMO-04", domain: "Admissions", title: "Confirm intent to enroll", critical: false, population: "all", trigger: null as string | null, deadlineExpr: "2026-12-01",
      requirement: "Illustrative example: confirm continued interest while a decision is pending.", quote: "Illustrative example: confirming interest keeps a pending application active." },
  ];
  for (const r of DEMO_RULES) {
    await upsertRule({
      institutionId: demoSchool.id, checkpointCode: r.code, domain: r.domain, title: r.title, critical: r.critical,
      population: r.population, requirement: r.requirement, trigger: r.trigger, deadlineExpr: r.deadlineExpr,
      status: "verified", confidence: "high", researchTerm: "Fall 2027", cycleState: "current", applicability: "applies",
      evidenceQuote: r.quote, sourceId: demoSource.id,
    });
    const savedRule = await getRuleByCode(demoSchool.id, r.code);
    await upsertGuidance({
      ruleId: savedRule!.id,
      what: r.title, when: r.deadlineExpr ? `By ${r.deadlineExpr} (illustrative example date).` : "As soon as it's ready — no fixed date in this example.",
      why: r.requirement, how: "This is a fictional Private Preview example; there is no real official page to visit.",
      consequence: "Illustrative example only — nothing here is a real deadline or requirement.",
      deepLink: demoSource.url, generatedBy: "human",
    });
  }
  // The second applicant shares the Fall 2027 cycle but remains in a
  // different pathway. A separate, lighter, trigger-free fictional rule lets
  // the demo show that distinction without inventing a different admissions
  // cycle or changing the source context.
  const morganDemoRule = {
    code: "DEMO-05", domain: "Admissions", title: "Confirm continued interest", critical: false, population: "all", trigger: null as string | null, deadlineExpr: "2027-11-01",
    requirement: "Illustrative example: an early, informal way to stay on a school's radar while still exploring.", quote: "Illustrative example: confirming interest early keeps a prospective student on a school's radar.",
  };
  await upsertRule({
    institutionId: demoSchool.id, checkpointCode: morganDemoRule.code, domain: morganDemoRule.domain, title: morganDemoRule.title, critical: morganDemoRule.critical,
    population: morganDemoRule.population, requirement: morganDemoRule.requirement, trigger: morganDemoRule.trigger, deadlineExpr: morganDemoRule.deadlineExpr,
    status: "verified", confidence: "high", researchTerm: "Fall 2027", cycleState: "current", applicability: "applies",
    evidenceQuote: morganDemoRule.quote, sourceId: demoSource.id,
  });
  const morganSavedRule = await getRuleByCode(demoSchool.id, morganDemoRule.code, "Fall 2027");
  await upsertGuidance({
    ruleId: morganSavedRule!.id,
    what: morganDemoRule.title, when: `By ${morganDemoRule.deadlineExpr} (illustrative example date).`,
    why: morganDemoRule.requirement, how: "This is a fictional Private Preview example; there is no real official page to visit.",
    consequence: "Illustrative example only — nothing here is a real deadline or requirement.",
    deepLink: demoSource.url, generatedBy: "human",
  });

  // Jordan (admitted, further along) tracks the example school too, and
  // gets the full illustrative action set materialized against Fall 2027 —
  // her actual researched term.
  const jordanDemoRel = await upsertRelationship({ studentId: student.id, institutionId: demoSchool.id, lifecycleState: "admitted", decisionDate: "2026-12-15T00:00:00.000Z" });
  await materializeActionsForRelationship(jordanDemoRel.id);
  // Vary the states by hand so the dashboard honestly shows a mix, the same
  // way a real household's plan would look after some progress: one item
  // already confirmed complete, one in progress, the rest not yet started.
  const confirmIntentRule = await getRuleByCode(demoSchool.id, "DEMO-04");
  const confirmIntent = confirmIntentRule ? await findActionInstance(jordanDemoRel.id, confirmIntentRule.id) : null;
  if (confirmIntent && confirmIntent.state === "not_started") {
    await updateActionInstance(confirmIntent.id, { state: "complete" });
    await createActionEvent({ actionId: confirmIntent.id, eventType: "state_change", fromState: "not_started", toState: "complete", actorType: "student" });
  }
  const depositRule = await getRuleByCode(demoSchool.id, "DEMO-01");
  const depositAction = depositRule ? await findActionInstance(jordanDemoRel.id, depositRule.id) : null;
  if (depositAction && depositAction.state === "not_started") {
    await updateActionInstance(depositAction.id, { state: "started" });
    await createActionEvent({ actionId: depositAction.id, eventType: "state_change", fromState: "not_started", toState: "started", actorType: "student" });
  }

  // Morgan (on a considering pathway) reaches only the non-admitted
  // checkpoints — an honest, much shorter queue that reflects a different
  // pathway in the same cycle, not an empty or broken one.
  const morganDemoRel = await upsertRelationship({ studentId: secondStudent.id, institutionId: demoSchool.id, lifecycleState: "considering" });
  const morganDemoMaterialized = await materializeActionsForRelationship(morganDemoRel.id);

  console.log(`Second demo applicant Morgan Taylor added: Class of 2027 / Fall 2027, 3 schools tracked, ${morganDemoMaterialized.filter((m) => m.applicable).length} illustrative-example action(s) (Alabama itself stays at 0 — its research is unverified for any term, honestly).`);

  console.log("Seed complete.");
}

// Import-safe: `npm test` and any future test can `import { main } from
// "./seed"` and call it against a temp database without triggering a CLI
// run or process.exit. Only a direct `tsx lib/db/seed.ts` (npm run db:seed)
// executes it here.
const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === new URL(entry, "file://").href || import.meta.url === `file://${entry}`;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
