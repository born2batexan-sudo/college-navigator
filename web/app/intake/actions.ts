"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWritableSelectedStudent } from "@/lib/auth/session";
import { updateStudentAttributes } from "@/lib/db/accounts";
import { listRelationshipsForStudent } from "@/lib/db/repo";
import { parseIntakeForm } from "@/lib/intake";
import { materializeActionsForRelationship } from "@/lib/materialize";
import { listDirectoryMappedInstitutionIds } from "@/lib/db/requests";

export async function saveIntake(formData: FormData): Promise<void> {
  const studentId = formData.get("studentId");
  if (typeof studentId !== "string" || !studentId || formData.getAll("studentId").length !== 1) throw new Error("Choose a student profile");
  const ctx = await requireWritableSelectedStudent(studentId);
  const answers = parseIntakeForm(formData);
  await updateStudentAttributes(ctx, { intake: answers });
  // Never walk all household students: a preference belongs to one plan.
  const [relationships, directoryMappedIds] = await Promise.all([listRelationshipsForStudent(ctx.student.id), listDirectoryMappedInstitutionIds()]);
  // Saving an intake answer must not republish unreviewed directory-linked rules.
  await Promise.all(relationships.filter(rel => !directoryMappedIds.has(rel.institutionId)).map(rel => materializeActionsForRelationship(rel.id)));
  revalidatePath("/intake");
  revalidatePath("/dashboard");
  revalidatePath("/welcome");
  redirect(`/intake?student=${encodeURIComponent(ctx.student.id)}&saved=1`);
}
