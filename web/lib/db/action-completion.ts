import { actionBelongsToHousehold } from "./accounts";
import { getActionInstanceFull, updateActionInstance, createActionEvent } from "./repo";
import { enteringTermFrom } from "../terms";
import { parseDateStatus } from "../date-status";

/** Called only after the signed-in writable-household gate. Checks ownership again against the action ID. */
export async function saveFamilyCompletion(householdId: string, actionId: string, completed: boolean): Promise<void> {
  if (typeof completed !== "boolean") throw new Error("Invalid completion value");
  if (!(await actionBelongsToHousehold(actionId, householdId))) throw new Error("Action not found");
  const action = await getActionInstanceFull(actionId);
  if (!action || enteringTermFrom(action.relationship.student) !== action.rule.researchTerm ||
    parseDateStatus(action.rule).kind === "not_applicable") throw new Error("Action not found");
  const state = completed ? "complete" : "not_started";
  if (action.state === state) return;
  if (!completed && action.state !== "complete") throw new Error("Action is not completed");
  if (completed && ["waived", "not_applicable"].includes(action.state)) throw new Error("Action is not actionable");
  await updateActionInstance(actionId, { state });
  await createActionEvent({ actionId, eventType: "family_completion", fromState: action.state, toState: state, actorType: "student" });
}
