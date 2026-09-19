"use server";

import { revalidatePath } from "next/cache";
import {
  upsertRelationship,
  findRelationship,
  setRelationshipActive,
  updateRelationshipAttributes,
  getInstitution,
} from "@/lib/db/repo";
import { materializeActionsForRelationship } from "@/lib/materialize";
import { requireOnboardedHousehold } from "@/lib/auth/session";
import { TRACKABLE_SCHOOL_SLUGS } from "@/lib/trackable";

// The student always comes from the signed-in family (requireOnboardedHousehold),
// never from a form field, so one family cannot change another family's schools.

/**
 * Start (or resume) tracking a school and save this school's questionnaire
 * answers in one step. Always leaves the relationship active=true — if you
 * are filling in preferences for a school, the intent is to track it.
 * Re-materializes afterward so a changed answer (e.g. turning Greek
 * interest on) immediately updates which of the 144 checkpoints apply.
 */
export async function saveSchoolPreferences(formData: FormData): Promise<void> {
  const { student } = await requireOnboardedHousehold();
  const institutionId = String(formData.get("institutionId") ?? "");
  if (!institutionId) throw new Error("Missing institutionId");
  const institution = await getInstitution(institutionId);
  if (!institution || !TRACKABLE_SCHOOL_SLUGS.includes(institution.slug)) throw new Error("That school is not available");

  const housingPlan = String(formData.get("housingPlan") ?? "undecided");
  const greekInterest = formData.get("greekInterest") === "on";
  const bringingCar = formData.get("bringingCar") === "on";
  const disabilityAccommodation = formData.get("disabilityAccommodation") === "on";

  const relationship = await upsertRelationship({ studentId: student.id, institutionId });
  await updateRelationshipAttributes(relationship.id, {
    housingPlan,
    greekInterest,
    bringingCar,
    disabilityAccommodation,
  });
  await setRelationshipActive(relationship.id, true);
  await materializeActionsForRelationship(relationship.id);

  revalidatePath("/welcome");
  revalidatePath("/");
}

/**
 * Soft-remove: hide this school from the dashboard/action queue without
 * touching its underlying tracker or action history. Re-tracking later
 * (saveSchoolPreferences) picks up exactly where this left off.
 */
export async function stopTracking(formData: FormData): Promise<void> {
  const { student } = await requireOnboardedHousehold();
  const institutionId = String(formData.get("institutionId") ?? "");
  if (!institutionId) throw new Error("Missing institutionId");

  const relationship = await findRelationship(student.id, institutionId);
  if (relationship) {
    await setRelationshipActive(relationship.id, false);
  }

  revalidatePath("/welcome");
  revalidatePath("/");
}
