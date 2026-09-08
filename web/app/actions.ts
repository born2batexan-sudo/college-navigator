"use server";

import { revalidatePath } from "next/cache";
import { updateActionInstance, createActionEvent } from "@/lib/db/repo";
import { db } from "@/lib/db/client";

const VALID_STATES = new Set(["not_started", "started", "submitted", "received", "complete", "blocked", "waived", "missed"]);

/** Student/parent manually advances an action's state from the dashboard. */
export async function advanceActionState(actionId: string, toState: string) {
  if (!VALID_STATES.has(toState)) throw new Error(`Invalid state: ${toState}`);

  const current = db.prepare("SELECT * FROM action_instances WHERE id = ?").get(actionId) as any;
  if (!current) throw new Error("Action not found");

  updateActionInstance(actionId, { state: toState });
  createActionEvent({ actionId, eventType: "state_change", fromState: current.state, toState, actorType: "student" });

  revalidatePath("/");
  revalidatePath(`/action/${actionId}`);
}
