"use server";

import { revalidatePath } from "next/cache";
import { getActionInstance, updateActionInstance, createActionEvent } from "@/lib/db/repo";

const VALID_STATES = new Set(["not_started", "started", "submitted", "received", "complete", "blocked", "waived", "missed"]);

/** Student/parent manually advances an action's state from the dashboard. */
export async function advanceActionState(actionId: string, toState: string) {
  if (!VALID_STATES.has(toState)) throw new Error(`Invalid state: ${toState}`);

  const current = await getActionInstance(actionId);
  if (!current) throw new Error("Action not found");

  await updateActionInstance(actionId, { state: toState });
  await createActionEvent({ actionId, eventType: "state_change", fromState: current.state, toState, actorType: "student" });

  revalidatePath("/");
  revalidatePath(`/action/${actionId}`);
}
