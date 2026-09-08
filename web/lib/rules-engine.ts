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

export type StudentAttributes = {
  gpaBand?: string;
  housingPlan?: "on_campus" | "off_campus" | "commuter" | "undecided";
  greekInterest?: boolean;
  disabilityAccommodation?: boolean;
  outOfStatePayer529?: boolean;
  [key: string]: unknown;
};

export function parseAttributes(student: Student): StudentAttributes {
  try {
    return JSON.parse(student.attributes || "{}");
  } catch {
    return {};
  }
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
      return attrs.housingPlan === "on_campus" || attrs.housingPlan === "undecided";
    case "greek_pnm":
      return attrs.greekInterest === true;
    case "disability_accommodation":
      return attrs.disabilityAccommodation === true;
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
  const attrs = parseAttributes(student);

  if (!evaluateTrigger(rule, relationship)) {
    return {
      applicable: false,
      reason: `Relationship state "${relationship.lifecycleState}" has not reached trigger "${rule.trigger}"`,
    };
  }

  if (!evaluatePopulation(rule, attrs, student)) {
    return {
      applicable: false,
      reason: `Student population does not match rule segment "${rule.population}"`,
    };
  }

  const dueAt = resolveDeadline(rule, relationship);
  const priority = computePriority(rule, dueAt);
  const reasonParts = [`Applies to population "${rule.population}"`];
  if (rule.trigger) reasonParts.push(`triggered by reaching "${rule.trigger}"`);
  if (rule.critical) reasonParts.push("critical checkpoint");

  return { applicable: true, reason: reasonParts.join("; "), dueAt, priority };
}
