/**
 * Turns Rules into ActionInstances for a given InstitutionRelationship,
 * using the Rules Engine. Idempotent: safe to call repeatedly (e.g. every
 * time lifecycle state changes, or on a schedule) — existing instances are
 * updated in place rather than duplicated, and instances for rules that
 * are no longer applicable are marked not_applicable rather than deleted,
 * preserving history in the Action Ledger.
 */

import {
  getRelationship,
  listRulesForInstitution,
  findActionInstance,
  createActionInstance,
  updateActionInstance,
  createActionEvent,
} from "./db/repo";
import { evaluateRule } from "./rules-engine";

const CLOSED_STATES = new Set(["complete", "waived"]);

export function materializeActionsForRelationship(relationshipId: string) {
  const relationship = getRelationship(relationshipId);
  if (!relationship) throw new Error(`Relationship ${relationshipId} not found`);

  const rules = listRulesForInstitution(relationship.institutionId);
  const results: { checkpointCode: string; applicable: boolean }[] = [];

  for (const rule of rules) {
    const evaluation = evaluateRule(rule, relationship, relationship.student);
    const existing = findActionInstance(relationshipId, rule.id);

    if (!evaluation.applicable) {
      if (existing && existing.state !== "not_applicable" && !CLOSED_STATES.has(existing.state)) {
        updateActionInstance(existing.id, { state: "not_applicable", applicabilityReason: evaluation.reason });
        createActionEvent({ actionId: existing.id, eventType: "state_change", fromState: existing.state, toState: "not_applicable", actorType: "system" });
      }
      results.push({ checkpointCode: rule.checkpointCode, applicable: false });
      continue;
    }

    const dueAtIso = evaluation.dueAt ? evaluation.dueAt.toISOString() : null;

    if (existing) {
      updateActionInstance(existing.id, {
        dueAt: dueAtIso,
        priority: evaluation.priority,
        applicabilityReason: evaluation.reason,
        state: existing.state === "not_applicable" ? "not_started" : existing.state,
      });
    } else {
      const created = createActionInstance({
        relationshipId,
        ruleId: rule.id,
        dueAt: dueAtIso,
        applicabilityReason: evaluation.reason,
        priority: evaluation.priority,
        state: "not_started",
      });
      createActionEvent({ actionId: created.id, eventType: "state_change", fromState: null, toState: "not_started", actorType: "system" });
    }
    results.push({ checkpointCode: rule.checkpointCode, applicable: true });
  }

  return results;
}
