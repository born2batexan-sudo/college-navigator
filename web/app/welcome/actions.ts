"use server";

import { revalidatePath } from "next/cache";
import {
  upsertRelationship,
  findRelationship,
  setRelationshipActive,
  updateRelationshipAttributes,
  getInstitution,
  listRelationshipsForStudent,
} from "@/lib/db/repo";
import { materializeActionsForRelationship } from "@/lib/materialize";
import { requireWritableSelectedStudent } from "@/lib/auth/session";
import { updateStudentAttributes } from "@/lib/db/accounts";
import { enteringTermFrom, isStartTerm } from "@/lib/terms";
import { assertBetaAccessCycle, requireBetaTrackedCollege } from "@/lib/db/college-coverage";
import { assertSelfServiceAccessCycle } from "@/lib/db/self-service-access";
import { withTransaction } from "@/lib/db/client";
import { TRACKABLE_SCHOOL_SLUGS } from "@/lib/trackable";
import { getDirectorySchoolForInstitution, listDirectoryMappedInstitutionIds } from "@/lib/db/requests";

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
  const { student, household } = await requireWritableSelectedStudent(String(formData.get("studentId") ?? ""));
  const institutionId = String(formData.get("institutionId") ?? "");
  if (!institutionId) throw new Error("Missing institutionId");
  const institution = await getInstitution(institutionId);
  if (!institution) throw new Error("That school is not available");
  const existing = await findRelationship(student.id, institutionId);
  // Existing requested schools remain editable even when absent from the legacy
  // opt-in list; an arbitrary institution ID cannot create a new relationship.
  if (!existing?.active && !TRACKABLE_SCHOOL_SLUGS.includes(institution.slug)) throw new Error("That school is not available");
  const directory = await getDirectorySchoolForInstitution(institutionId);
  // A directory link (or old 90% coverage value) is not independently reviewed
  // research. Preserve active preferences but do not create or revive a plan.
  if (directory && !existing?.active) throw new Error("School source review is required before tracking begins");

  const housingPlan = String(formData.get("housingPlan") ?? "undecided");
  const greekInterest = formData.get("greekInterest") === "on";
  const bringingCar = formData.get("bringingCar") === "on";
  const disabilityAccommodation = formData.get("disabilityAccommodation") === "on";

  await withTransaction(async () => {
    if (!directory) await requireBetaTrackedCollege({ householdId: household.id, cycle: enteringTermFrom(student) ?? "Not sure yet", institutionId });
    const relationship = directory ? existing! : await upsertRelationship({ studentId: student.id, institutionId });
    await updateRelationshipAttributes(relationship.id, {
      housingPlan,
      greekInterest,
      bringingCar,
      disabilityAccommodation,
    });
    if (!directory) {
      await setRelationshipActive(relationship.id, true);
      await materializeActionsForRelationship(relationship.id);
    }
    // For a previously active, directory-linked school: preference-only save.
    // Existing actions are not recertified by this edit.
  });

  revalidatePath("/welcome");
  revalidatePath("/");
}

/**
 * Soft-remove: hide this school from the dashboard/action queue without
 * touching its underlying tracker or action history. Re-tracking later
 * (saveSchoolPreferences) picks up exactly where this left off.
 */
export async function saveStartTerm(formData: FormData): Promise<void> {
  const ctx = await requireWritableSelectedStudent(String(formData.get("studentId") ?? ""));
  const term = String(formData.get("enteringTerm") ?? "");
  if (!isStartTerm(term)) throw new Error("Choose a valid start term");
  if (!await assertSelfServiceAccessCycle(ctx.household.id, term)) await assertBetaAccessCycle(ctx.household.id, term);
  await updateStudentAttributes(ctx, { enteringTerm: term });
  // Rebuild each tracked school's actions from this exact term. If that term
  // has no certified rules yet, no other cycle is substituted.
  const [relationships, directoryMappedIds] = await Promise.all([listRelationshipsForStudent(ctx.student.id), listDirectoryMappedInstitutionIds()]);
  // A changed cycle is not evidence that a directory-linked school has a
  // certified action plan. Preserve its saved relationship, but do not create
  // fresh action instances from quarantined legacy research.
  await Promise.all(relationships.filter(rel => !directoryMappedIds.has(rel.institutionId)).map(rel => materializeActionsForRelationship(rel.id)));
  revalidatePath("/welcome"); revalidatePath("/");
}

export async function stopTracking(formData: FormData): Promise<void> {
  const { student } = await requireWritableSelectedStudent(String(formData.get("studentId") ?? ""));
  const institutionId = String(formData.get("institutionId") ?? "");
  if (!institutionId) throw new Error("Missing institutionId");

  const relationship = await findRelationship(student.id, institutionId);
  if (relationship) {
    await setRelationshipActive(relationship.id, false);
  }

  revalidatePath("/welcome");
  revalidatePath("/");
}
