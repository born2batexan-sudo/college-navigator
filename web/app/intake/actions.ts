"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWritableSelectedStudent } from "@/lib/auth/session";
import { updateStudentIntake } from "@/lib/db/accounts";
import { listRelationshipsForStudent } from "@/lib/db/repo";
import { parseIntakeForm } from "@/lib/intake";
import { materializeActionsForRelationship } from "@/lib/materialize";

export async function saveIntake(formData: FormData): Promise<void> {
  const studentId = formData.get("studentId");
  if (typeof studentId !== "string" || !studentId || formData.getAll("studentId").length !== 1) throw new Error("Choose a student profile");
  const ctx = await requireWritableSelectedStudent(studentId);
  const answers = parseIntakeForm(formData);
  await updateStudentIntake(ctx, answers);
  // Never walk all household students: a preference belongs to one plan.
  const relationships = await listRelationshipsForStudent(ctx.student.id);
  await Promise.all(relationships.map((rel) => materializeActionsForRelationship(rel.id)));
  revalidatePath("/intake");
  revalidatePath("/dashboard");
  revalidatePath("/welcome");
  redirect(`/intake?student=${encodeURIComponent(ctx.student.id)}&saved=1`);
}
