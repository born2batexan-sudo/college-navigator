"use server";

import { revalidatePath } from "next/cache";
import { getActionInstanceFull, updateActionInstance, createActionEvent } from "@/lib/db/repo";
import { saveFamilyCompletion } from "@/lib/db/action-completion";
import { requireWritableOnboardedHousehold } from "@/lib/auth/session";
import { actionBelongsToHousehold } from "@/lib/db/accounts";

const VALID_STATES = new Set(["not_started", "started", "submitted", "received", "blocked", "waived", "missed"]);

/** Student/parent manually advances an action's state from the dashboard. */
export async function advanceActionState(actionId: string, toState: string) {
  // Only actions in the signed-in family's own plan can be changed.
  const { household } = await requireWritableOnboardedHousehold();
  if (!(await actionBelongsToHousehold(actionId, household.id))) throw new Error("Action not found");

  if (!VALID_STATES.has(toState)) throw new Error(`Invalid state: ${toState}`);

  // The full projection denies unknown/mismatched terms before any state write.
  const current = await getActionInstanceFull(actionId);
  if (!current) throw new Error("Action not found");

  await updateActionInstance(actionId, { state: toState });
  await createActionEvent({ actionId, eventType: "state_change", fromState: current.state, toState, actorType: "student" });

  revalidatePath("/");
  revalidatePath(`/action/${actionId}`);
  revalidatePath("/dashboard");
}

/** Persist a family's independent per-task completion marker, never an official school-side confirmation. */
export async function setActionCompleted(actionId: string, completed: boolean) {
  const { household } = await requireWritableOnboardedHousehold();
  await saveFamilyCompletion(household.id, actionId, completed);
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath(`/action/${actionId}`);
}
