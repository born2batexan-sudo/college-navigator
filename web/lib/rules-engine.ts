/**
 * Rules Engine
 * ------------
 * Evaluates institutional Rules against a Student's attributes and an
 * InstitutionRelationship's lifecycle state to decide which rules are
 * currently applicable, and (for applicable rules) computes a due date and
 * priority for the resulting ActionInstance.
 *
 * This is intentionally a small, readable rule evaluator rather than a
 * generic DSL — the brief's own principle is "narrow end-to-end proof, not
 * feature breadth." Extend evaluatePopulation() / resolveDeadline() as new
 * population segments and deadline expressions show up in real rule data.
 */

import type { Rule, InstitutionRelationship, Student } from "./db/types";
import { parseDateStatus } from "./date-status";
import { enteringTermFrom } from "./terms";
import { intakeRuleDefaults, readIntake } from "./intake";

// Order matters: used to test "has the relationship reached at least X".
const LIFECYCLE_ORDER = [
  "considering",
  "applying",
  "applied",
  "admitted",
  "waitlisted",
  "enrolled",
  "attending",
  "alumni",
] as const;

const TERMINAL_STATES = new Set(["declined"]);
const PREFERENCE_POPULATIONS = new Set([
  "campus_housing", "greek_pnm", "disability_accommodation", "bringing_car",
  "education_savings", "school_scholarships", "outside_scholarships",
  "financial_aid", "campus_visits", "orientation", "program_needs", "family_travel",
]);

export type StudentAttributes = {
  gpaBand?: string;
  housingPlan?: "on_campus" | "off_campus" | "commuter" | "undecided";
  greekInterest?: boolean | null;
  disabilityAccommodation?: boolean | null;
  outOfStatePayer529?: boolean;
  bringingCar?: boolean | null;
  [key: string]: unknown;
};

export function parseAttributes(student: Student): StudentAttributes {
  let existing: StudentAttributes = {};
  try {
    const parsed: unknown = JSON.parse(student.attributes || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) existing = parsed as StudentAttributes;
  } catch { /* bad legacy JSON must not hide possible steps */ }
  // Saved intake defaults beat old student-level answers; an explicitly
  // answered school's questionnaire still beats both in resolveAttributes().
  return { ...existing, ...intakeRuleDefaults(readIntake(student)) };
}

/** Same shape as parseAttributes(), scoped to one school's relationship —
 * a family's answers (Greek interest, bringing a car, housing plan,
 * disability accommodation) legitimately differ school to school. */
export function parseRelationshipAttributes(relationship: InstitutionRelationship): StudentAttributes {
  try {
    return JSON.parse(relationship.attributes || "{}");
  } catch {
    return {};
  }
}

/** Per-school answers win; anything a school's questionnaire hasn't
 * answered yet falls back to the student-level default. */
export function resolveAttributes(relationship: InstitutionRelationship, student: Student): StudentAttributes {
  return { ...parseAttributes(student), ...parseRelationshipAttributes(relationship) };
}

function lifecycleAtLeast(state: string, floor: string): boolean {
  const stateIdx = LIFECYCLE_ORDER.indexOf(state as (typeof LIFECYCLE_ORDER)[number]);
  const floorIdx = LIFECYCLE_ORDER.indexOf(floor as (typeof LIFECYCLE_ORDER)[number]);
  if (stateIdx === -1 || floorIdx === -1) return false;
  return stateIdx >= floorIdx;
}

/** Is this rule's population segment applicable to this student? */
export function evaluatePopulation(rule: Rule, attrs: StudentAttributes, student: Student): boolean {
  switch (rule.population) {
    case "all":
      return true;
    case "out_of_state":
      return student.residency === "out_of_state" || student.residency === "international";
    case "campus_housing":
      return !attrs.housingPlan || attrs.housingPlan === "on_campus" || attrs.housingPlan === "undecided";
    case "greek_pnm":
      return attrs.greekInterest !== false;
    case "disability_accommodation":
      return attrs.disabilityAccommodation !== false;
    case "bringing_car":
      return attrs.bringingCar !== false;
    // These segments are ready for future verified rules. Existing school-wide
    // rules use "all" and cannot be hidden by intake preferences.
    case "education_savings": return attrs.educationSavings !== false;
    case "school_scholarships": return attrs.schoolScholarships !== false;
    case "outside_scholarships": return attrs.outsideScholarships !== false;
    case "financial_aid": return attrs.financialAid !== false;
    case "campus_visits": return attrs.visits !== false;
    case "orientation": return attrs.orientation !== false;
    case "program_needs": return attrs.programNeeds !== false;
    case "family_travel": return attrs.familyTravel !== false;
    default:
      // Unknown population segment: fail closed, don't silently surface a
      // rule we can't confirm applies.
      return false;
  }
}

/** Has the relationship reached the lifecycle stage this rule triggers on? */
export function evaluateTrigger(rule: Rule, relationship: InstitutionRelationship): boolean {
  if (TERMINAL_STATES.has(relationship.lifecycleState)) return false;
  if (!rule.trigger) return true; // no trigger = applicable from "considering" onward
  return lifecycleAtLeast(relationship.lifecycleState, rule.trigger);
}

/**
 * Resolve a deadlineExpr into a concrete Date where possible.
 * Supports: literal ISO dates ("2027-02-01") and simple relative
 * expressions ("30 days after admission"). Anything else returns null —
 * the action still gets created, just without a computed due date, and is
 * flagged for human/agent follow-up.
 */
export function resolveDeadline(rule: Rule, relationship: InstitutionRelationship): Date | null {
  if (!rule.deadlineExpr) return null;

  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (iso.test(rule.deadlineExpr)) {
    return new Date(rule.deadlineExpr + "T00:00:00");
  }

  const relative = rule.deadlineExpr.match(/^(\d+)\s+days?\s+after\s+admission$/i);
  if (relative && relationship.decisionDate) {
    const d = new Date(relationship.decisionDate);
    d.setDate(d.getDate() + parseInt(relative[1], 10));
    return d;
  }

  return null;
}

export type Priority = "urgent" | "high" | "normal" | "low";

export function computePriority(rule: Rule, dueAt: Date | null): Priority {
  if (!dueAt) return rule.critical ? "high" : "normal";
  const daysUntil = (dueAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (daysUntil < 0) return "urgent"; // overdue
  if (daysUntil <= 7) return "urgent";
  if (daysUntil <= 21) return rule.critical ? "urgent" : "high";
  if (daysUntil <= 45) return "high";
  return rule.critical ? "normal" : "low";
}

export type ApplicabilityResult =
  | { applicable: true; reason: string; dueAt: Date | null; priority: Priority }
  | { applicable: false; reason: string };

/** The single entry point: is this rule applicable to this relationship right now? */
export function evaluateRule(
  rule: Rule,
  relationship: InstitutionRelationship,
  student: Student
): ApplicabilityResult {
  // Never materialize a legacy/unknown-term checkpoint (or another cycle's
  // checkpoint) from its old status label or saved date.
  if (!rule.researchTerm?.trim() || enteringTermFrom(student) !== rule.researchTerm) {
    return { applicable: false, reason: "Research term is unknown or does not match the student's entering term" };
  }
  const attrs = resolveAttributes(relationship, student);

  // The research agent marks checkpoints the school genuinely doesn't have as
  // "Not applicable: ..." (with a cited, quoted source). Those are not to-dos.
  const dateStatus = parseDateStatus(rule);
  if (dateStatus.kind === "not_applicable") {
    return { applicable: false, reason: `Not applicable at this school: ${dateStatus.detail}` };
  }

  if (!evaluateTrigger(rule, relationship)) {
    return {
      applicable: false,
      reason: `Relationship state "${relationship.lifecycleState}" has not reached trigger "${rule.trigger}"`,
    };
  }

  // A preference can set aside only noncritical population-specific work.
  // Critical school checkpoints, including a housing requirement in conflict
  // with a commute preference, remain visible for checking against official policy.
  const populationMatches = evaluatePopulation(rule, attrs, student);
  if (!populationMatches && !(rule.critical && PREFERENCE_POPULATIONS.has(rule.population))) {
    return {
      applicable: false,
      reason: `Student population does not match rule segment "${rule.population}"`,
    };
  }

  // While the school hasn't published this cycle's dates, never compute a due
  // date from older information.
  const dueAt = dateStatus.kind === "awaiting" ? null : resolveDeadline(rule, relationship);
  const priority = computePriority(rule, dueAt);
  const reasonParts = [populationMatches
    ? `Applies to population "${rule.population}"`
    : "Critical school checkpoint retained despite a conflicting preference; verify the school's official instructions"];
  if (rule.trigger) reasonParts.push(`triggered by reaching "${rule.trigger}"`);
  if (rule.critical) reasonParts.push("critical checkpoint");

  return { applicable: true, reason: reasonParts.join("; "), dueAt, priority };
}
