// Data-access layer. Every other file (rules engine, materializer, API
// routes, agent endpoints) goes through these functions rather than
// touching `db` directly, so the storage engine can be swapped later
// without hunting down raw SQL scattered across the app.

import { db, newId, nowIso } from "./client";
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
    title: r.title,
    critical: !!r.critical,
    population: r.population,
    requirement: r.requirement,
    trigger: r.trigger_state,
    dependsOnCode: r.depends_on_code,
    deadlineExpr: r.deadline_expr,
    actor: r.actor,
    costCents: r.cost_cents,
    refundable: r.refundable,
    consequence: r.consequence,
    status: r.status,
    confidence: r.confidence,
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

function toSource(r: any): Source {
  return {
    id: r.id,
    institutionId: r.institution_id,
    url: r.url,
    label: r.label,
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
    what: r.what,
    when: r.when_text,
    why: r.why,
    how: r.how,
    consequence: r.consequence,
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

// ---------- Households / People / Students ----------

export function upsertHousehold(input: { id?: string; name: string; timezone?: string; subState?: string }): Household {
  const id = input.id ?? newId("hh");
  const existing = db.prepare("SELECT * FROM households WHERE id = ?").get(id);
  if (existing) return existing as unknown as Household;
  const now = nowIso();
  db.prepare(
    "INSERT INTO households (id, name, timezone, sub_state, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, input.name, input.timezone ?? "America/Chicago", input.subState ?? "trial", now);
  return { id, name: input.name, timezone: input.timezone ?? "America/Chicago", subState: input.subState ?? "trial", createdAt: now };
}

export function createPerson(input: { householdId: string; name: string; role: string; email?: string; consentState?: string }): Person {
  const id = newId("person");
  const now = nowIso();
  db.prepare(
    "INSERT INTO people (id, household_id, name, role, email, phone, consent_state, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)"
  ).run(id, input.householdId, input.name, input.role, input.email ?? null, input.consentState ?? "pending", now);
  return { id, householdId: input.householdId, name: input.name, role: input.role, email: input.email ?? null, phone: null, consentState: input.consentState ?? "pending", createdAt: now };
}

export function upsertStudent(input: {
  id?: string;
  householdId: string;
  name: string;
  gradYear: number;
  applicantType?: string;
  residency?: string;
  attributes?: Record<string, unknown>;
}): Student {
  const id = input.id ?? newId("student");
  const existing = db.prepare("SELECT * FROM students WHERE id = ?").get(id) as any;
  if (existing) return toStudent(existing);
  const now = nowIso();
  const attrs = JSON.stringify(input.attributes ?? {});
  db.prepare(
    "INSERT INTO students (id, household_id, name, grad_year, applicant_type, residency, attributes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, input.householdId, input.name, input.gradYear, input.applicantType ?? "freshman", input.residency ?? "unknown", attrs, now);
  return { id, householdId: input.householdId, name: input.name, gradYear: input.gradYear, applicantType: input.applicantType ?? "freshman", residency: input.residency ?? "unknown", attributes: attrs, createdAt: now };
}

export function getStudent(id: string): Student | null {
  const r = db.prepare("SELECT * FROM students WHERE id = ?").get(id) as any;
  return r ? toStudent(r) : null;
}

export function listStudentsForHousehold(householdId: string): Student[] {
  return (db.prepare("SELECT * FROM students WHERE household_id = ?").all(householdId) as any[]).map(toStudent);
}

export function listHouseholds(): Household[] {
  return db.prepare("SELECT * FROM households ORDER BY created_at").all() as unknown as Household[];
}

// ---------- Institutions ----------

export function upsertInstitution(input: {
  name: string;
  slug: string;
  domains?: string[];
  pathway?: string;
  coverageStatus?: string;
  coveragePct?: number;
}): Institution {
  const existing = db.prepare("SELECT * FROM institutions WHERE slug = ?").get(input.slug) as any;
  if (existing) return toInstitution(existing);
  const id = newId("inst");
  const now = nowIso();
  db.prepare(
    "INSERT INTO institutions (id, name, slug, domains, pathway, coverage_status, coverage_pct, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, input.name, input.slug, JSON.stringify(input.domains ?? []), input.pathway ?? "both", input.coverageStatus ?? "research", input.coveragePct ?? 0, now);
  return toInstitution({ id, name: input.name, slug: input.slug, domains: JSON.stringify(input.domains ?? []), pathway: input.pathway ?? "both", coverage_status: input.coverageStatus ?? "research", coverage_pct: input.coveragePct ?? 0, created_at: now });
}

export function updateInstitutionCoverage(id: string, coveragePct: number, coverageStatus: string) {
  db.prepare("UPDATE institutions SET coverage_pct = ?, coverage_status = ? WHERE id = ?").run(coveragePct, coverageStatus, id);
}

export function getInstitutionBySlug(slug: string): Institution | null {
  const r = db.prepare("SELECT * FROM institutions WHERE slug = ?").get(slug) as any;
  return r ? toInstitution(r) : null;
}

export function listInstitutions(): Institution[] {
  return (db.prepare("SELECT * FROM institutions ORDER BY name").all() as any[]).map(toInstitution);
}

export function getInstitution(id: string): Institution | null {
  const r = db.prepare("SELECT * FROM institutions WHERE id = ?").get(id) as any;
  return r ? toInstitution(r) : null;
}

export function getSource(id: string): Source | null {
  const r = db.prepare("SELECT * FROM sources WHERE id = ?").get(id) as any;
  return r ? toSource(r) : null;
}

// ---------- Sources ----------

export function createSource(input: { institutionId: string; url: string; label: string; owner?: string; lastVerified?: string }): Source {
  const id = newId("src");
  const now = nowIso();
  db.prepare(
    "INSERT INTO sources (id, institution_id, url, label, authority_level, owner, last_verified, fingerprint, last_content, created_at) VALUES (?, ?, ?, ?, 'official', ?, ?, NULL, NULL, ?)"
  ).run(id, input.institutionId, input.url, input.label, input.owner ?? null, input.lastVerified ?? null, now);
  return toSource({ id, institution_id: input.institutionId, url: input.url, label: input.label, authority_level: "official", owner: input.owner ?? null, last_verified: input.lastVerified ?? null, fingerprint: null, last_content: null, created_at: now });
}

export function findSourceByUrl(institutionId: string, url: string): Source | null {
  const r = db.prepare("SELECT * FROM sources WHERE institution_id = ? AND url = ?").get(institutionId, url) as any;
  return r ? toSource(r) : null;
}

export function listSourcesForInstitution(institutionId: string): Source[] {
  return (db.prepare("SELECT * FROM sources WHERE institution_id = ?").all(institutionId) as any[]).map(toSource);
}

export function updateSourceFingerprint(id: string, fingerprint: string, lastVerified: string, content?: string) {
  if (content !== undefined) {
    // Cap stored content so a huge page can't blow up the DB row indefinitely.
    const capped = content.slice(0, 20000);
    db.prepare("UPDATE sources SET fingerprint = ?, last_verified = ?, last_content = ? WHERE id = ?").run(fingerprint, lastVerified, capped, id);
  } else {
    db.prepare("UPDATE sources SET fingerprint = ?, last_verified = ? WHERE id = ?").run(fingerprint, lastVerified, id);
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
  verifiedAt?: string | null;
  sourceId?: string | null;
};

export function upsertRule(input: RuleInput): Rule {
  const existing = db
    .prepare("SELECT * FROM rules WHERE institution_id = ? AND checkpoint_code = ?")
    .get(input.institutionId, input.checkpointCode) as any;
  const now = nowIso();

  if (existing) {
    db.prepare(
      `UPDATE rules SET domain=?, title=?, critical=?, population=?, requirement=?, trigger_state=?, depends_on_code=?,
       deadline_expr=?, cost_cents=?, refundable=?, consequence=?, status=?, confidence=?, verified_at=?, source_id=?, updated_at=?
       WHERE id = ?`
    ).run(
      input.domain,
      input.title,
      input.critical ? 1 : 0,
      input.population ?? "all",
      input.requirement,
      input.trigger ?? null,
      input.dependsOnCode ?? null,
      input.deadlineExpr ?? null,
      input.costCents ?? null,
      input.refundable ?? "unknown",
      input.consequence ?? null,
      input.status ?? "unverified",
      input.confidence ?? "low",
      input.verifiedAt ?? null,
      input.sourceId ?? null,
      now,
      existing.id
    );
    return toRule({ ...existing, ...input, trigger_state: input.trigger, depends_on_code: input.dependsOnCode, deadline_expr: input.deadlineExpr, cost_cents: input.costCents, verified_at: input.verifiedAt, source_id: input.sourceId, updated_at: now });
  }

  const id = newId("rule");
  db.prepare(
    `INSERT INTO rules (id, institution_id, checkpoint_code, domain, title, critical, population, requirement, trigger_state,
      depends_on_code, deadline_expr, actor, cost_cents, refundable, consequence, status, confidence, verified_at, source_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'student', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.institutionId,
    input.checkpointCode,
    input.domain,
    input.title,
    input.critical ? 1 : 0,
    input.population ?? "all",
    input.requirement,
    input.trigger ?? null,
    input.dependsOnCode ?? null,
    input.deadlineExpr ?? null,
    input.costCents ?? null,
    input.refundable ?? "unknown",
    input.consequence ?? null,
    input.status ?? "unverified",
    input.confidence ?? "low",
    input.verifiedAt ?? null,
    input.sourceId ?? null,
    now,
    now
  );
  return toRule({
    id,
    institution_id: input.institutionId,
    checkpoint_code: input.checkpointCode,
    domain: input.domain,
    title: input.title,
    critical: input.critical ? 1 : 0,
    population: input.population ?? "all",
    requirement: input.requirement,
    trigger_state: input.trigger ?? null,
    depends_on_code: input.dependsOnCode ?? null,
    deadline_expr: input.deadlineExpr ?? null,
    cost_cents: input.costCents ?? null,
    refundable: input.refundable ?? "unknown",
    consequence: input.consequence ?? null,
    status: input.status ?? "unverified",
    confidence: input.confidence ?? "low",
    verified_at: input.verifiedAt ?? null,
    source_id: input.sourceId ?? null,
    created_at: now,
    updated_at: now,
  });
}

export function listRulesForInstitution(institutionId: string): Rule[] {
  return (db.prepare("SELECT * FROM rules WHERE institution_id = ? ORDER BY checkpoint_code").all(institutionId) as any[]).map(toRule);
}

export function getRuleByCode(institutionId: string, checkpointCode: string): Rule | null {
  const r = db.prepare("SELECT * FROM rules WHERE institution_id = ? AND checkpoint_code = ?").get(institutionId, checkpointCode) as any;
  return r ? toRule(r) : null;
}

export function getRuleById(id: string): Rule | null {
  const r = db.prepare("SELECT * FROM rules WHERE id = ?").get(id) as any;
  return r ? toRule(r) : null;
}

// ---------- Guidance ----------

export function upsertGuidance(input: {
  ruleId: string;
  what: string;
  when: string;
  why: string;
  how: string;
  consequence: string;
  deepLink?: string | null;
  generatedBy?: string;
}): GuidanceAsset {
  const existing = db.prepare("SELECT * FROM guidance_assets WHERE rule_id = ?").get(input.ruleId) as any;
  const now = nowIso();
  if (existing) {
    db.prepare(
      "UPDATE guidance_assets SET what=?, when_text=?, why=?, how=?, consequence=?, deep_link=?, generated_by=?, updated_at=? WHERE id=?"
    ).run(input.what, input.when, input.why, input.how, input.consequence, input.deepLink ?? null, input.generatedBy ?? "guidance_agent", now, existing.id);
    return toGuidance({ ...existing, what: input.what, when_text: input.when, why: input.why, how: input.how, consequence: input.consequence, deep_link: input.deepLink, generated_by: input.generatedBy ?? "guidance_agent", updated_at: now });
  }
  const id = newId("guide");
  db.prepare(
    "INSERT INTO guidance_assets (id, rule_id, what, when_text, why, how, consequence, deep_link, generated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, input.ruleId, input.what, input.when, input.why, input.how, input.consequence, input.deepLink ?? null, input.generatedBy ?? "guidance_agent", now, now);
  return toGuidance({ id, rule_id: input.ruleId, what: input.what, when_text: input.when, why: input.why, how: input.how, consequence: input.consequence, deep_link: input.deepLink ?? null, generated_by: input.generatedBy ?? "guidance_agent", created_at: now, updated_at: now });
}

export function getGuidanceForRule(ruleId: string): GuidanceAsset | null {
  const r = db.prepare("SELECT * FROM guidance_assets WHERE rule_id = ?").get(ruleId) as any;
  return r ? toGuidance(r) : null;
}

// ---------- Observation patterns ----------

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

export function createObservationPattern(input: {
  institutionId: string;
  workflow: string;
  urlPattern: string;
  signal: string;
  impliesState: string;
  relatedCheckpointCode?: string | null;
  confidenceThreshold?: number;
}): ObservationPattern {
  const id = newId("obs");
  const now = nowIso();
  db.prepare(
    "INSERT INTO observation_patterns (id, institution_id, workflow, url_pattern, signal, implies_state, related_checkpoint_code, confidence_threshold, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, input.institutionId, input.workflow, input.urlPattern, input.signal, input.impliesState, input.relatedCheckpointCode ?? null, input.confidenceThreshold ?? 0.7, now);
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

export function listObservationPatternsForInstitution(institutionId: string): ObservationPattern[] {
  return (db.prepare("SELECT * FROM observation_patterns WHERE institution_id = ?").all(institutionId) as any[]).map(toObservationPattern);
}

// ---------- Institution relationships ----------

export function upsertRelationship(input: {
  studentId: string;
  institutionId: string;
  lifecycleState?: string;
  decisionDate?: string | null;
}): InstitutionRelationship {
  const existing = db
    .prepare("SELECT * FROM institution_relationships WHERE student_id = ? AND institution_id = ?")
    .get(input.studentId, input.institutionId) as any;
  if (existing) return toRelationship(existing);
  const id = newId("rel");
  const now = nowIso();
  db.prepare(
    "INSERT INTO institution_relationships (id, student_id, institution_id, lifecycle_state, decision_date, commit_date, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)"
  ).run(id, input.studentId, input.institutionId, input.lifecycleState ?? "considering", input.decisionDate ?? null, now);
  return toRelationship({ id, student_id: input.studentId, institution_id: input.institutionId, lifecycle_state: input.lifecycleState ?? "considering", decision_date: input.decisionDate ?? null, commit_date: null, created_at: now });
}

export function listRelationshipsForStudent(studentId: string): InstitutionRelationship[] {
  return (db.prepare("SELECT * FROM institution_relationships WHERE student_id = ?").all(studentId) as any[]).map(toRelationship);
}

export function listRelationshipsForInstitution(institutionId: string): InstitutionRelationship[] {
  return (db.prepare("SELECT * FROM institution_relationships WHERE institution_id = ?").all(institutionId) as any[]).map(toRelationship);
}

export function getRelationship(id: string): (InstitutionRelationship & { student: Student; institution: Institution }) | null {
  const r = db.prepare("SELECT * FROM institution_relationships WHERE id = ?").get(id) as any;
  if (!r) return null;
  const student = getStudent(r.student_id)!;
  const inst = db.prepare("SELECT * FROM institutions WHERE id = ?").get(r.institution_id) as any;
  return { ...toRelationship(r), student, institution: toInstitution(inst) };
}

export function setRelationshipState(id: string, lifecycleState: string, decisionDate?: string | null, commitDate?: string | null) {
  db.prepare("UPDATE institution_relationships SET lifecycle_state = ?, decision_date = COALESCE(?, decision_date), commit_date = COALESCE(?, commit_date) WHERE id = ?").run(
    lifecycleState,
    decisionDate ?? null,
    commitDate ?? null,
    id
  );
}

// ---------- Action ledger ----------

export function findActionInstance(relationshipId: string, ruleId: string): ActionInstance | null {
  const r = db.prepare("SELECT * FROM action_instances WHERE relationship_id = ? AND rule_id = ?").get(relationshipId, ruleId) as any;
  return r ? toActionInstance(r) : null;
}

export function createActionInstance(input: {
  relationshipId: string;
  ruleId: string;
  dueAt: string | null;
  applicabilityReason: string;
  priority: string;
  state?: string;
}): ActionInstance {
  const id = newId("action");
  const now = nowIso();
  db.prepare(
    "INSERT INTO action_instances (id, relationship_id, rule_id, due_at, applicability_reason, priority, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, input.relationshipId, input.ruleId, input.dueAt, input.applicabilityReason, input.priority, input.state ?? "not_started", now, now);
  return toActionInstance({ id, relationship_id: input.relationshipId, rule_id: input.ruleId, due_at: input.dueAt, applicability_reason: input.applicabilityReason, priority: input.priority, state: input.state ?? "not_started", created_at: now, updated_at: now });
}

export function updateActionInstance(id: string, patch: Partial<{ dueAt: string | null; priority: string; applicabilityReason: string; state: string }>) {
  const current = db.prepare("SELECT * FROM action_instances WHERE id = ?").get(id) as any;
  if (!current) return;
  const merged = {
    due_at: patch.dueAt !== undefined ? patch.dueAt : current.due_at,
    priority: patch.priority ?? current.priority,
    applicability_reason: patch.applicabilityReason ?? current.applicability_reason,
    state: patch.state ?? current.state,
  };
  db.prepare("UPDATE action_instances SET due_at=?, priority=?, applicability_reason=?, state=?, updated_at=? WHERE id=?").run(
    merged.due_at,
    merged.priority,
    merged.applicability_reason,
    merged.state,
    nowIso(),
    id
  );
}

export function listActionInstancesForRelationship(relationshipId: string): (ActionInstance & { rule: Rule; guidance: GuidanceAsset | null })[] {
  const rows = db.prepare("SELECT * FROM action_instances WHERE relationship_id = ?").all(relationshipId) as any[];
  return rows.map((r) => {
    const action = toActionInstance(r);
    const rule = getRuleById(action.ruleId)!;
    const guidance = getGuidanceForRule(rule.id);
    return { ...action, rule, guidance };
  });
}

export function getActionInstance(id: string): ActionInstance | null {
  const r = db.prepare("SELECT * FROM action_instances WHERE id = ?").get(id) as any;
  return r ? toActionInstance(r) : null;
}

export function getActionInstanceFull(id: string) {
  const action = getActionInstance(id);
  if (!action) return null;
  const rule = getRuleById(action.ruleId)!;
  const guidance = getGuidanceForRule(rule.id);
  const source = rule.sourceId ? getSource(rule.sourceId) : null;
  const relationship = getRelationship(action.relationshipId)!;
  return { ...action, rule, guidance, source, relationship };
}

export function createActionEvent(input: {
  actionId: string;
  eventType: string;
  fromState?: string | null;
  toState?: string | null;
  actorType?: string;
  evidenceRef?: string | null;
}): ActionEvent {
  const id = newId("evt");
  const now = nowIso();
  db.prepare(
    "INSERT INTO action_events (id, action_id, event_type, from_state, to_state, actor_type, evidence_ref, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, input.actionId, input.eventType, input.fromState ?? null, input.toState ?? null, input.actorType ?? "system", input.evidenceRef ?? null, now);
  return toActionEvent({ id, action_id: input.actionId, event_type: input.eventType, from_state: input.fromState ?? null, to_state: input.toState ?? null, actor_type: input.actorType ?? "system", evidence_ref: input.evidenceRef ?? null, observed_at: now });
}

export function listEventsForAction(actionId: string): ActionEvent[] {
  return (db.prepare("SELECT * FROM action_events WHERE action_id = ? ORDER BY observed_at").all(actionId) as any[]).map(toActionEvent);
}

// ---------- Change events (monitoring agent) ----------

export function createChangeEvent(input: {
  sourceId: string;
  materiality: string;
  oldFingerprint: string | null;
  newFingerprint: string | null;
  summary?: string | null;
}): ChangeEvent {
  const id = newId("chg");
  const now = nowIso();
  db.prepare(
    "INSERT INTO change_events (id, source_id, detected_at, materiality, old_fingerprint, new_fingerprint, summary, review_state) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')"
  ).run(id, input.sourceId, now, input.materiality, input.oldFingerprint, input.newFingerprint, input.summary ?? null);
  return toChangeEvent({ id, source_id: input.sourceId, detected_at: now, materiality: input.materiality, old_fingerprint: input.oldFingerprint, new_fingerprint: input.newFingerprint, summary: input.summary ?? null, review_state: "pending" });
}

export function listPendingChangeEvents(): ChangeEvent[] {
  return (db.prepare("SELECT * FROM change_events WHERE review_state = 'pending' ORDER BY detected_at DESC").all() as any[]).map(toChangeEvent);
}
