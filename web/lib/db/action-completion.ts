import { actionBelongsToHousehold } from "./accounts";
import { getActionInstanceFull, updateActionInstance, createActionEvent, listEventsForAction } from "./repo";
import { queryRows } from "./client";
import { enteringTermFrom } from "../terms";
import { parseDateStatus } from "../date-status";

/** A family_completion event is the only completion authority. Workflow state, research and observations are not. */
export async function familyCompletionForActions(actionIds: string[]): Promise<Map<string, boolean>> {
  const markers = new Map<string, boolean>();
  for (let start = 0; start < actionIds.length; start += 100) {
    const ids = actionIds.slice(start, start + 100);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
    const rows = await queryRows<{ action_id: string; to_state: string }>(
      `SELECT action_id, to_state FROM action_events WHERE event_type='family_completion' AND actor_type='student' AND action_id IN (${placeholders}) ORDER BY observed_at, id`, ids
    );
    for (const row of rows) markers.set(row.action_id, row.to_state === "complete");
  }
  return markers;
}

/** Called only after the signed-in writable-household gate; ownership and term are rechecked. */
export async function saveFamilyCompletion(householdId: string, actionId: string, completed: boolean): Promise<void> {
  if (typeof completed !== "boolean") throw new Error("Invalid completion value");
  if (!(await actionBelongsToHousehold(actionId, householdId))) throw new Error("Action not found");
  const action = await getActionInstanceFull(actionId);
  if (!action || enteringTermFrom(action.relationship.student) !== action.rule.researchTerm ||
    parseDateStatus(action.rule).kind === "not_applicable" || action.state === "not_applicable") throw new Error("Action not found");
  if (action.completed === completed) return;
  if (!completed && !action.completed) throw new Error("Action is not completed");
  // Older releases overwrote workflow state on check. Restore the pre-check state
  // when undoing one of those markers; new checks never overwrite workflow state.
  const events = await listEventsForAction(actionId);
  if (!completed && action.state === "complete") {
    const prior = events.findLast((event) => event.eventType === "family_completion" && event.toState === "complete");
    await updateActionInstance(actionId, { state: prior?.fromState && prior.fromState !== "complete" ? prior.fromState : "not_started" });
  }
  const latest = events.reduce((time, event) => Math.max(time, new Date(event.observedAt).getTime()), 0);
  const observedAt = new Date(Math.max(Date.now(), latest + 1)).toISOString();
  await createActionEvent({ actionId, eventType: "family_completion", fromState: action.state, toState: completed ? "complete" : "not_started", actorType: "student", observedAt });
}
