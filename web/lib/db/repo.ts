// Data-access layer. Every other file (rules engine, materializer, API
// routes, agent endpoints) goes through these functions rather than
// touching the database client directly, so the storage engine can be
// swapped later without hunting down raw SQL scattered across the app.
//
// Every function here is async and every query is written in Postgres-
// style "$1, $2, ..." placeholders — lib/db/client.ts adapts that same SQL
// to SQLite's "?" placeholders when running locally without a
// DATABASE_URL. See client.ts for why.

import { queryRows, queryOne, exec, newId, nowIso } from "./client";
import { cleanCopy } from "../copy-guard";
import type {
  Household,
  Person,
  Student,
  Institution,
  InstitutionRelationship,
  Source,
  Rule,
  GuidanceAsset,
  ObservationPattern,
  ActionInstance,
  ActionEvent,
  ChangeEvent,
} from "./types";

// ---------- row <-> object mappers ----------

function toRule(r: any): Rule {
  return {
    id: r.id,
    institutionId: r.institution_id,
    checkpointCode: r.checkpoint_code,
    domain: r.domain,
    title: cleanCopy(r.title),
    critical: !!r.critical,
    population: r.population,
    requirement: cleanCopy(r.requirement),
    trigger: r.trigger_state,
    dependsOnCode: r.depends_on_code,
    deadlineExpr: r.deadline_expr,
    actor: r.actor,
    costCents: r.cost_cents,
    refundable: r.refundable,
    consequence: cleanCopy(r.consequence),
    status: r.status,
    confidence: r.confidence,
    researchTerm: r.research_term ?? "Fall 2027",
    cycleState: r.cycle_state ?? "undated",
    applicability: r.applicability ?? "applies",
    evidenceQuote: r.evidence_quote ?? null,
    verifiedAt: r.verified_at,
    sourceId: r.source_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toInstitution(r: any): Institution {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    domains: r.domains,
    pathway: r.pathway,
    coverageStatus: r.coverage_status,
    coveragePct: r.coverage_pct,
    createdAt: r.created_at,
  };
}

function toRelationship(r: any): InstitutionRelationship {
  return {
    id: r.id,
    studentId: r.student_id,
    institutionId: r.institution_id,
    lifecycleState: r.lifecycle_state,
    decisionDate: r.decision_date,
    commitDate: r.commit_date,
    attributes: r.attributes ?? "{}",
    active: r.active === undefined || r.active === null ? true : !!r.active,
    createdAt: r.created_at,
  };
}

function toStudent(r: any): Student {
  return {
    id: r.id,
    householdId: r.household_id,
    name: r.name,
    gradYear: r.grad_year,
    applicantType: r.applicant_type,
    residency: r.residency,
    attributes: r.attributes,
    createdAt: r.created_at,
  };
}

function toHousehold(r: any): Household {
  return {
    id: r.id,
    name: r.name,
    timezone: r.timezone,
    subState: r.sub_state,
    createdAt: r.created_at,
  };
}

function toPerson(r: any): Person {
  return {
    id: r.id,
    householdId: r.household_id,
    name: r.name,
    role: r.role,
    email: r.email,
    phone: r.phone,
    consentState: r.consent_state,
    createdAt: r.created_at,
  };
}

function toSource(r: any): Source {
  return {
    id: r.id,
    institutionId: r.institution_id,
    url: r.url,
    label: cleanCopy(r.label),
    authorityLevel: r.authority_level,
    owner: r.owner,
    lastVerified: r.last_verified,
    fingerprint: r.fingerprint,
    lastContent: r.last_content,
    createdAt: r.created_at,
  };
}

function toGuidance(r: any): GuidanceAsset {
  return {
    id: r.id,
    ruleId: r.rule_id,
    what: cleanCopy(r.what),
    when: cleanCopy(r.when_text),
    why: cleanCopy(r.why),
    how: cleanCopy(r.how),
    consequence: cleanCopy(r.consequence),
    deepLink: r.deep_link,
    generatedBy: r.generated_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toActionInstance(r: any): ActionInstance {
  return {
    id: r.id,
    relationshipId: r.relationship_id,
    ruleId: r.rule_id,
    dueAt: r.due_at,
    applicabilityReason: r.applicability_reason,
    priority: r.priority,
    state: r.state,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toActionEvent(r: any): ActionEvent {
  return {
    id: r.id,
    actionId: r.action_id,
    eventType: r.event_type,
    fromState: r.from_state,
    toState: r.to_state,
    actorType: r.actor_type,
    evidenceRef: r.evidence_ref,
    observedAt: r.observed_at,
  };
}

function toChangeEvent(r: any): ChangeEvent {
  return {
    id: r.id,
    sourceId: r.source_id,
    detectedAt: r.detected_at,
    materiality: r.materiality,
    oldFingerprint: r.old_fingerprint,
    newFingerprint: r.new_fingerprint,
    summary: r.summary,
    reviewState: r.review_state,
  };
}

function toObservationPattern(r: any): ObservationPattern {
  return {
    id: r.id,
    institutionId: r.institution_id,
    workflow: r.workflow,
    urlPattern: r.url_pattern,
    signal: r.signal,
    impliesState: r.implies_state,
    relatedCheckpointCode: r.related_checkpoint_code,
    confidenceThreshold: r.confidence_threshold,
    createdAt: r.created_at,
  };
}

// ---------- Households / People / Students ----------

export async function upsertHousehold(input: { id?: string; name: string; timezone?: string; subState?: string }): Promise<Household> {
  const id = input.id ?? newId("hh");
  const existing = await queryOne<any>("SELECT * FROM households WHERE id = $1", [id]);
  if (existing) return toHousehold(existing);
  const now = nowIso();
  await exec(
    "INSERT INTO households (id, name, timezone, sub_state, created_at) VALUES ($1, $2, $3, $4, $5)",
    [id, input.name, input.timezone ?? "America/Chicago", input.subState ?? "trial", now]
  );
  return { id, name: input.name, timezone: input.timezone ?? "America/Chicago", subState: input.subState ?? "trial", createdAt: now };
}

export async function createPerson(input: { householdId: string; name: string; role: string; email?: string; consentState?: string }): Promise<Person> {
  const id = newId("person");
  const now = nowIso();
  await exec(
    "INSERT INTO people (id, household_id, name, role, email, phone, consent_state, created_at) VALUES ($1, $2, $3, $4, $5, NULL, $6, $7)",
    [id, input.householdId, input.name, input.role, input.email ?? null, input.consentState ?? "pending", now]
  );
  return { id, householdId: input.householdId, name: input.name, role: input.role, email: input.email ?? null, phone: null, consentState: input.consentState ?? "pending", createdAt: now };
}

export async function listPeopleForHousehold(householdId: string): Promise<Person[]> {
  return (await queryRows<any>("SELECT * FROM people WHERE household_id = $1", [householdId])).map(toPerson);
}

export async function upsertStudent(input: {
  id?: string;
  householdId: string;
  name: string;
  gradYear: number;
  applicantType?: string;
  residency?: string;
  attributes?: Record<string, unknown>;
}): Promise<Student> {
  const id = input.id ?? newId("student");
  const existing = await queryOne<any>("SELECT * FROM students WHERE id = $1", [id]);
  if (existing) return toStudent(existing);
  const now = nowIso();
  const attrs = JSON.stringify(input.attributes ?? {});
  await exec(
    "INSERT INTO students (id, household_id, name, grad_year, applicant_type, residency, attributes, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [id, input.householdId, input.name, input.gradYear, input.applicantType ?? "freshman", input.residency ?? "unknown", attrs, now]
  );
  return { id, householdId: input.householdId, name: input.name, gradYear: input.gradYear, applicantType: input.applicantType ?? "freshman", residency: input.residency ?? "unknown", attributes: attrs, createdAt: now };
}

export async function getStudent(id: string): Promise<Student | null> {
  const r = await queryOne<any>("SELECT * FROM students WHERE id = $1", [id]);
  return r ? toStudent(r) : null;
}

export async function listStudentsForHousehold(householdId: string): Promise<Student[]> {
  return (await queryRows<any>("SELECT * FROM students WHERE household_id = $1", [householdId])).map(toStudent);
}

export async function listHouseholds(): Promise<Household[]> {
  return (await queryRows<any>("SELECT * FROM households ORDER BY created_at")).map(toHousehold);
}

// ---------- Institutions ----------

export async function upsertInstitution(input: {
  name: string;
  slug: string;
  domains?: string[];
  pathway?: string;
  coverageStatus?: string;
  coveragePct?: number;
}): Promise<Institution> {
  const existing = await queryOne<any>("SELECT * FROM institutions WHERE slug = $1", [input.slug]);
  if (existing) return toInstitution(existing);
  const id = newId("inst");
  const now = nowIso();
  await exec(
    "INSERT INTO institutions (id, name, slug, domains, pathway, coverage_status, coverage_pct, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [id, input.name, input.slug, JSON.stringify(input.domains ?? []), input.pathway ?? "both", input.coverageStatus ?? "research", input.coveragePct ?? 0, now]
  );
  return toInstitution({ id, name: input.name, slug: input.slug, domains: JSON.stringify(input.domains ?? []), pathway: input.pathway ?? "both", coverage_status: input.coverageStatus ?? "research", coverage_pct: input.coveragePct ?? 0, created_at: now });
}

export async function updateInstitutionCoverage(id: string, coveragePct: number, coverageStatus: string): Promise<void> {
  await exec("UPDATE institutions SET coverage_pct = $1, coverage_status = $2 WHERE id = $3", [coveragePct, coverageStatus, id]);
}

export async function getInstitutionBySlug(slug: string): Promise<Institution | null> {
  const r = await queryOne<any>("SELECT * FROM institutions WHERE slug = $1", [slug]);
  return r ? toInstitution(r) : null;
}

export async function listInstitutions(): Promise<Institution[]> {
  return (await queryRows<any>("SELECT * FROM institutions ORDER BY name")).map(toInstitution);
}

export async function getInstitution(id: string): Promise<Institution | null> {
  const r = await queryOne<any>("SELECT * FROM institutions WHERE id = $1", [id]);
  return r ? toInstitution(r) : null;
}

export async function getSource(id: string): Promise<Source | null> {
  const r = await queryOne<any>("SELECT * FROM sources WHERE id = $1", [id]);
  return r ? toSource(r) : null;
}

// ---------- Sources ----------

function normalizedInstitutionDomains(institution: Institution): string[] {
  try {
    const parsed = JSON.parse(institution.domains);
    return Array.isArray(parsed) ? parsed.map(String).map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]).filter(Boolean) : [];
  } catch { return []; }
}

export function isOfficialInstitutionUrl(url: string, institution: Institution): boolean {
  let host = "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch { return false; }
  const domains = normalizedInstitutionDomains(institution);
  return domains.length > 0 && domains.some((d) => host === d || host.endsWith(`.${d}`));
}

export async function createSource(input: { institutionId: string; url: string; label: string; owner?: string; lastVerified?: string }): Promise<Source> {
  const institution = await getInstitution(input.institutionId);
  if (!institution || !isOfficialInstitutionUrl(input.url, institution)) throw new Error("Source must be an HTTPS URL on an approved institution domain");
  const id = newId("src");
  const now = nowIso();
  await exec(
    "INSERT INTO sources (id, institution_id, url, label, authority_level, owner, last_verified, fingerprint, last_content, created_at) VALUES ($1, $2, $3, $4, 'official', $5, $6, NULL, NULL, $7)",
    [id, input.institutionId, input.url, input.label, input.owner ?? null, input.lastVerified ?? null, now]
  );
  return toSource({ id, institution_id: input.institutionId, url: input.url, label: input.label, authority_level: "official", owner: input.owner ?? null, last_verified: input.lastVerified ?? null, fingerprint: null, last_content: null, created_at: now });
}

export async function findSourceByUrl(institutionId: string, url: string): Promise<Source | null> {
  const r = await queryOne<any>("SELECT * FROM sources WHERE institution_id = $1 AND url = $2", [institutionId, url]);
  return r ? toSource(r) : null;
}

export async function listSourcesForInstitution(institutionId: string): Promise<Source[]> {
  return (await queryRows<any>("SELECT * FROM sources WHERE institution_id = $1", [institutionId])).map(toSource);
}

export async function updateSourceFingerprint(id: string, fingerprint: string, lastVerified: string, content?: string): Promise<void> {
  if (content !== undefined) {
    // Cap stored content so a huge page can't blow up the DB row indefinitely.
    const capped = content.slice(0, 20000);
    await exec("UPDATE sources SET fingerprint = $1, last_verified = $2, last_content = $3 WHERE id = $4", [fingerprint, lastVerified, capped, id]);
  } else {
    await exec("UPDATE sources SET fingerprint = $1, last_verified = $2 WHERE id = $3", [fingerprint, lastVerified, id]);
  }
}

// ---------- Rules ----------

export type RuleInput = {
  institutionId: string;
  checkpointCode: string;
  domain: string;
  title: string;
  critical: boolean;
  population?: string;
  requirement: string;
  trigger?: string | null;
  dependsOnCode?: string | null;
  deadlineExpr?: string | null;
  costCents?: number | null;
  refundable?: string;
  consequence?: string | null;
  status?: string;
  confidence?: string;
  researchTerm?: string;
  cycleState?: "current" | "prior" | "undated";
  applicability?: "applies" | "not_applicable" | "not_yet_published";
  evidenceQuote?: string | null;
  verifiedAt?: string | null;
  sourceId?: string | null;
};

export async function upsertRule(input: RuleInput): Promise<Rule> {
  const researchTerm = String(input.researchTerm ?? "Fall 2027").trim();
  if (!researchTerm) throw new Error("researchTerm is required");
  if (input.checkpointCode.startsWith("CAR-") && input.population === "bringing_car") throw new Error("Career checkpoints cannot use vehicle applicability");
  const status = input.status ?? "unverified";
  const applicability = input.applicability ?? "applies";
  const cycleState = input.cycleState ?? "undated";
  const evidenceQuote = input.evidenceQuote?.trim().slice(0, 500) || null;
  if (status === "verified" || applicability === "not_applicable" || applicability === "not_yet_published") {
    if (!input.sourceId || !evidenceQuote) throw new Error("Evidence-backed rule state requires a same-institution official source and evidence quote");
    const source = await getSource(input.sourceId);
    const institution = await getInstitution(input.institutionId);
    if (!source || source.institutionId !== input.institutionId || !institution || !isOfficialInstitutionUrl(source.url, institution)) {
      throw new Error("Rule source must belong to the same institution and approved domain");
    }
  }
  if (status === "verified" && cycleState === "prior") throw new Error("Prior-cycle evidence cannot verify the requested research term");
  if (applicability === "not_yet_published" && status !== "unverified") throw new Error("Not-yet-published rules must remain unverified");
  const existing = await queryOne<any>(
    "SELECT * FROM rules WHERE institution_id = $1 AND checkpoint_code = $2 AND research_term = $3",
    [input.institutionId, input.checkpointCode, researchTerm]
  );
  const now = nowIso();

  const values = [input.domain, input.title, input.critical ? 1 : 0, input.population ?? "all", input.requirement,
    input.trigger ?? null, input.dependsOnCode ?? null, input.deadlineExpr ?? null, input.costCents ?? null,
    input.refundable ?? "unknown", input.consequence ?? null, status, input.confidence ?? "low", researchTerm,
    cycleState, applicability, evidenceQuote, input.verifiedAt ?? (status === "verified" ? now : null), input.sourceId ?? null];
  if (existing) {
    await exec(`UPDATE rules SET domain=$1,title=$2,critical=$3,population=$4,requirement=$5,trigger_state=$6,depends_on_code=$7,
      deadline_expr=$8,cost_cents=$9,refundable=$10,consequence=$11,status=$12,confidence=$13,research_term=$14,
      cycle_state=$15,applicability=$16,evidence_quote=$17,verified_at=$18,source_id=$19,updated_at=$20 WHERE id=$21`,
      [...values, now, existing.id]);
  } else {
    const id = newId("rule");
    await exec(`INSERT INTO rules (id,institution_id,checkpoint_code,domain,title,critical,population,requirement,trigger_state,
      depends_on_code,deadline_expr,actor,cost_cents,refundable,consequence,status,confidence,research_term,cycle_state,
      applicability,evidence_quote,verified_at,source_id,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'student',$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
      [id, input.institutionId, input.checkpointCode, ...values.slice(0, 11), ...values.slice(11), now, now]);
  }
  const saved = await queryOne<any>("SELECT * FROM rules WHERE institution_id=$1 AND checkpoint_code=$2 AND research_term=$3", [input.institutionId, input.checkpointCode, researchTerm]);
  if (!saved) throw new Error("Rule write failed");
  return toRule(saved);
}

export async function listRulesForInstitution(institutionId: string, researchTerm = "Fall 2027"): Promise<Rule[]> {
  // Customer plans may use only evidence-backed, customer-ready research.
  // Low-confidence or unverified checkpoints remain internal and never become actions.
  return (await queryRows<any>(`SELECT * FROM rules
    WHERE institution_id=$1 AND research_term=$2
      AND status='verified' AND confidence IN ('high','medium')
      AND NOT (checkpoint_code LIKE 'CAR-%' AND population='bringing_car')
    ORDER BY checkpoint_code`, [institutionId, researchTerm])).map(toRule);
}

export async function getRuleByCode(institutionId: string, checkpointCode: string, researchTerm = "Fall 2027"): Promise<Rule | null> {
  const r = await queryOne<any>("SELECT * FROM rules WHERE institution_id=$1 AND checkpoint_code=$2 AND research_term=$3", [institutionId, checkpointCode, researchTerm]);
  return r ? toRule(r) : null;
}

export async function getRuleById(id: string): Promise<Rule | null> {
  const r = await queryOne<any>("SELECT * FROM rules WHERE id = $1", [id]);
  return r ? toRule(r) : null;
}

// ---------- Guidance ----------

export async function upsertGuidance(input: {
  ruleId: string;
  what: string;
  when: string;
  why: string;
  how: string;
  consequence: string;
  deepLink?: string | null;
  generatedBy?: string;
}): Promise<GuidanceAsset> {
  const existing = await queryOne<any>("SELECT * FROM guidance_assets WHERE rule_id = $1", [input.ruleId]);
  const now = nowIso();
  if (existing) {
    await exec(
      "UPDATE guidance_assets SET what=$1, when_text=$2, why=$3, how=$4, consequence=$5, deep_link=$6, generated_by=$7, updated_at=$8 WHERE id=$9",
      [input.what, input.when, input.why, input.how, input.consequence, input.deepLink ?? null, input.generatedBy ?? "guidance_agent", now, existing.id]
    );
    return toGuidance({ ...existing, what: input.what, when_text: input.when, why: input.why, how: input.how, consequence: input.consequence, deep_link: input.deepLink, generated_by: input.generatedBy ?? "guidance_agent", updated_at: now });
  }
  const id = newId("guide");
  await exec(
    "INSERT INTO guidance_assets (id, rule_id, what, when_text, why, how, consequence, deep_link, generated_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    [id, input.ruleId, input.what, input.when, input.why, input.how, input.consequence, input.deepLink ?? null, input.generatedBy ?? "guidance_agent", now, now]
  );
  return toGuidance({ id, rule_id: input.ruleId, what: input.what, when_text: input.when, why: input.why, how: input.how, consequence: input.consequence, deep_link: input.deepLink ?? null, generated_by: input.generatedBy ?? "guidance_agent", created_at: now, updated_at: now });
}

export async function getGuidanceForRule(ruleId: string): Promise<GuidanceAsset | null> {
  const r = await queryOne<any>("SELECT * FROM guidance_assets WHERE rule_id = $1", [ruleId]);
  return r ? toGuidance(r) : null;
}

// ---------- Observation patterns ----------

export async function createObservationPattern(input: {
  institutionId: string;
  workflow: string;
  urlPattern: string;
  signal: string;
  impliesState: string;
  relatedCheckpointCode?: string | null;
  confidenceThreshold?: number;
}): Promise<ObservationPattern> {
  const id = newId("obs");
  const now = nowIso();
  await exec(
    "INSERT INTO observation_patterns (id, institution_id, workflow, url_pattern, signal, implies_state, related_checkpoint_code, confidence_threshold, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [id, input.institutionId, input.workflow, input.urlPattern, input.signal, input.impliesState, input.relatedCheckpointCode ?? null, input.confidenceThreshold ?? 0.7, now]
  );
  return toObservationPattern({
    id,
    institution_id: input.institutionId,
    workflow: input.workflow,
    url_pattern: input.urlPattern,
    signal: input.signal,
    implies_state: input.impliesState,
    related_checkpoint_code: input.relatedCheckpointCode ?? null,
    confidence_threshold: input.confidenceThreshold ?? 0.7,
    created_at: now,
  });
}

export async function listObservationPatternsForInstitution(institutionId: string): Promise<ObservationPattern[]> {
  return (await queryRows<any>("SELECT * FROM observation_patterns WHERE institution_id = $1", [institutionId])).map(toObservationPattern);
}

// ---------- Institution relationships ----------

export async function upsertRelationship(input: {
  studentId: string;
  institutionId: string;
  lifecycleState?: string;
  decisionDate?: string | null;
}): Promise<InstitutionRelationship> {
  const existing = await queryOne<any>(
    "SELECT * FROM institution_relationships WHERE student_id = $1 AND institution_id = $2",
    [input.studentId, input.institutionId]
  );
  if (existing) return toRelationship(existing);
  const id = newId("rel");
  const now = nowIso();
  await exec(
    "INSERT INTO institution_relationships (id, student_id, institution_id, lifecycle_state, decision_date, commit_date, attributes, active, created_at) VALUES ($1, $2, $3, $4, $5, NULL, '{}', 1, $6)",
    [id, input.studentId, input.institutionId, input.lifecycleState ?? "considering", input.decisionDate ?? null, now]
  );
  return toRelationship({ id, student_id: input.studentId, institution_id: input.institutionId, lifecycle_state: input.lifecycleState ?? "considering", decision_date: input.decisionDate ?? null, commit_date: null, attributes: "{}", active: 1, created_at: now });
}

export async function findRelationship(studentId: string, institutionId: string): Promise<InstitutionRelationship | null> {
  const r = await queryOne<any>("SELECT * FROM institution_relationships WHERE student_id = $1 AND institution_id = $2", [studentId, institutionId]);
  return r ? toRelationship(r) : null;
}

export async function listRelationshipsForStudent(studentId: string, opts?: { includeInactive?: boolean }): Promise<InstitutionRelationship[]> {
  if (opts?.includeInactive) {
    return (await queryRows<any>("SELECT * FROM institution_relationships WHERE student_id = $1", [studentId])).map(toRelationship);
  }
  return (await queryRows<any>("SELECT * FROM institution_relationships WHERE student_id = $1 AND active = 1", [studentId])).map(toRelationship);
}

export async function listRelationshipsForInstitution(institutionId: string): Promise<InstitutionRelationship[]> {
  return (await queryRows<any>("SELECT * FROM institution_relationships WHERE institution_id = $1", [institutionId])).map(toRelationship);
}

export async function getRelationship(id: string): Promise<(InstitutionRelationship & { student: Student; institution: Institution }) | null> {
  const r = await queryOne<any>("SELECT * FROM institution_relationships WHERE id = $1", [id]);
  if (!r) return null;
  const student = (await getStudent(r.student_id))!;
  const instRow = await queryOne<any>("SELECT * FROM institutions WHERE id = $1", [r.institution_id]);
  return { ...toRelationship(r), student, institution: toInstitution(instRow) };
}

export async function setRelationshipState(id: string, lifecycleState: string, decisionDate?: string | null, commitDate?: string | null): Promise<void> {
  await exec(
    "UPDATE institution_relationships SET lifecycle_state = $1, decision_date = COALESCE($2, decision_date), commit_date = COALESCE($3, commit_date) WHERE id = $4",
    [lifecycleState, decisionDate ?? null, commitDate ?? null, id]
  );
}

/** Soft add/remove: flips visibility only. The 144-point tracker and every
 * ActionInstance/ActionEvent underneath stay exactly as they were, so
 * re-activating resumes right where tracking left off. */
export async function setRelationshipActive(id: string, active: boolean): Promise<void> {
  await exec("UPDATE institution_relationships SET active = $1 WHERE id = $2", [active ? 1 : 0, id]);
}

/** Per-school questionnaire answers (housing plan, Greek interest, bringing
 * a car, disability accommodation) — see rules-engine.ts for how these are
 * merged over the student-level attributes and evaluated. */
export async function updateRelationshipAttributes(id: string, attributes: Record<string, unknown>): Promise<void> {
  await exec("UPDATE institution_relationships SET attributes = $1 WHERE id = $2", [JSON.stringify(attributes), id]);
}

// ---------- Action ledger ----------

export async function findActionInstance(relationshipId: string, ruleId: string): Promise<ActionInstance | null> {
  const r = await queryOne<any>("SELECT * FROM action_instances WHERE relationship_id = $1 AND rule_id = $2", [relationshipId, ruleId]);
  return r ? toActionInstance(r) : null;
}

export async function createActionInstance(input: {
  relationshipId: string;
  ruleId: string;
  dueAt: string | null;
  applicabilityReason: string;
  priority: string;
  state?: string;
}): Promise<ActionInstance> {
  const institutions = await queryOne<any>(`SELECT r.institution_id AS relationship_institution_id,
      ru.institution_id AS rule_institution_id
    FROM institution_relationships r
    CROSS JOIN rules ru
    WHERE r.id=$1 AND ru.id=$2`, [input.relationshipId, input.ruleId]);
  if (institutions && institutions.relationship_institution_id !== institutions.rule_institution_id) {
    throw new Error("Action relationship and rule must belong to the same institution");
  }
  const id = newId("action");
  const now = nowIso();
  await exec(
    "INSERT INTO action_instances (id, relationship_id, rule_id, due_at, applicability_reason, priority, state, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [id, input.relationshipId, input.ruleId, input.dueAt, input.applicabilityReason, input.priority, input.state ?? "not_started", now, now]
  );
  return toActionInstance({ id, relationship_id: input.relationshipId, rule_id: input.ruleId, due_at: input.dueAt, applicability_reason: input.applicabilityReason, priority: input.priority, state: input.state ?? "not_started", created_at: now, updated_at: now });
}

export async function updateActionInstance(id: string, patch: Partial<{ dueAt: string | null; priority: string; applicabilityReason: string; state: string }>): Promise<void> {
  const current = await queryOne<any>("SELECT * FROM action_instances WHERE id = $1", [id]);
  if (!current) return;
  const merged = {
    due_at: patch.dueAt !== undefined ? patch.dueAt : current.due_at,
    priority: patch.priority ?? current.priority,
    applicability_reason: patch.applicabilityReason ?? current.applicability_reason,
    state: patch.state ?? current.state,
  };
  await exec(
    "UPDATE action_instances SET due_at=$1, priority=$2, applicability_reason=$3, state=$4, updated_at=$5 WHERE id=$6",
    [merged.due_at, merged.priority, merged.applicability_reason, merged.state, nowIso(), id]
  );
}

export async function listActionInstancesForRelationship(relationshipId: string, researchTerm?: string): Promise<(ActionInstance & { rule: Rule; guidance: GuidanceAsset | null })[]> {
  const rows = researchTerm
    ? await queryRows<any>(`SELECT a.* FROM action_instances a JOIN rules r ON r.id=a.rule_id
        WHERE a.relationship_id=$1 AND r.research_term=$2`, [relationshipId, researchTerm])
    : await queryRows<any>("SELECT * FROM action_instances WHERE relationship_id = $1", [relationshipId]);
  const out: (ActionInstance & { rule: Rule; guidance: GuidanceAsset | null })[] = [];
  for (const r of rows) {
    const action = toActionInstance(r);
    const rule = (await getRuleById(action.ruleId))!;
    const guidance = await getGuidanceForRule(rule.id);
    out.push({ ...action, rule, guidance });
  }
  return out;
}

export async function getActionInstance(id: string): Promise<ActionInstance | null> {
  const r = await queryOne<any>("SELECT * FROM action_instances WHERE id = $1", [id]);
  return r ? toActionInstance(r) : null;
}

export async function getActionInstanceFull(id: string) {
  const action = await getActionInstance(id);
  if (!action) return null;
  const rule = (await getRuleById(action.ruleId))!;
  const guidance = await getGuidanceForRule(rule.id);
  const source = rule.sourceId ? await getSource(rule.sourceId) : null;
  const relationship = (await getRelationship(action.relationshipId))!;
  return { ...action, rule, guidance, source, relationship };
}

export async function createActionEvent(input: {
  actionId: string;
  eventType: string;
  fromState?: string | null;
  toState?: string | null;
  actorType?: string;
  evidenceRef?: string | null;
}): Promise<ActionEvent> {
  const id = newId("evt");
  const now = nowIso();
  await exec(
    "INSERT INTO action_events (id, action_id, event_type, from_state, to_state, actor_type, evidence_ref, observed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [id, input.actionId, input.eventType, input.fromState ?? null, input.toState ?? null, input.actorType ?? "system", input.evidenceRef ?? null, now]
  );
  return toActionEvent({ id, action_id: input.actionId, event_type: input.eventType, from_state: input.fromState ?? null, to_state: input.toState ?? null, actor_type: input.actorType ?? "system", evidence_ref: input.evidenceRef ?? null, observed_at: now });
}

export async function listEventsForAction(actionId: string): Promise<ActionEvent[]> {
  return (await queryRows<any>("SELECT * FROM action_events WHERE action_id = $1 ORDER BY observed_at", [actionId])).map(toActionEvent);
}

// ---------- Change events (monitoring agent) ----------

export async function createChangeEvent(input: {
  sourceId: string;
  materiality: string;
  oldFingerprint: string | null;
  newFingerprint: string | null;
  summary?: string | null;
}): Promise<ChangeEvent> {
  const id = newId("chg");
  const now = nowIso();
  await exec(
    "INSERT INTO change_events (id, source_id, detected_at, materiality, old_fingerprint, new_fingerprint, summary, review_state) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')",
    [id, input.sourceId, now, input.materiality, input.oldFingerprint, input.newFingerprint, input.summary ?? null]
  );
  return toChangeEvent({ id, source_id: input.sourceId, detected_at: now, materiality: input.materiality, old_fingerprint: input.oldFingerprint, new_fingerprint: input.newFingerprint, summary: input.summary ?? null, review_state: "pending" });
}

export async function listPendingChangeEvents(): Promise<ChangeEvent[]> {
  return (await queryRows<any>("SELECT * FROM change_events WHERE review_state = 'pending' ORDER BY detected_at DESC")).map(toChangeEvent);
}
