"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOnboardingHousehold } from "@/lib/auth/session";
import { hasBetaOnboardingAccess, completeBetaOnboarding } from "@/lib/db/beta-access";
import { hasProductAccess } from "@/lib/auth/product-access";
import { completeOnboarding } from "@/lib/db/accounts";
import { isStartTerm } from "@/lib/terms";

const MAX_STUDENTS = 6;
const studentSchema = z.object({
  name: z.string().trim().min(1, "Enter each student's first or preferred name.").max(60),
  enteringTerm: z.string().refine(isStartTerm, "Choose a start term for every student."),
});

export async function saveOnboarding(formData: FormData): Promise<void> {
  const ctx = await requireOnboardingHousehold();
  const names = formData.getAll("studentName").map(String);
  const terms = formData.getAll("enteringTerm").map(String);
  const cycles = [...new Set(terms.filter(Boolean))];
  if (cycles.length !== 1) redirect(`/onboarding?error=${encodeURIComponent("All students in a household plan must share the same high-school graduation year and admissions cycle.")}`);
  const parsed = z.object({
    studentCount: z.coerce.number().int().min(1).max(MAX_STUDENTS),
    role: z.enum(["parent", "student"]),
    purchaserAttested: z.literal("yes"),
  }).safeParse({ studentCount: formData.get("studentCount"), role: formData.get("role"), purchaserAttested: formData.get("purchaserAttested") });
  if (!parsed.success) redirect(`/onboarding?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Please check the form.")}`);
  if (names.length !== parsed.data.studentCount || terms.length !== 1) redirect("/onboarding?error=Add+a+profile+for+every+student+you+selected.");

  const students = names.map((name) => studentSchema.safeParse({ name, enteringTerm: terms[0] }));
  const invalid = students.find((result) => !result.success);
  if (invalid && !invalid.success) redirect(`/onboarding?error=${encodeURIComponent(invalid.error.issues[0]?.message ?? "Please check the student profiles.")}`);

  const input = {
    role: parsed.data.role,
    students: students.map((result) => {
      if (!result.success) throw new Error("Student validation unexpectedly failed");
      return result.data;
    }),
    purchaserAttested: true,
  };
  if (await hasBetaOnboardingAccess({ id: ctx.authUserId, email: ctx.email }, ctx.household.id)) {
    await completeBetaOnboarding(ctx, ctx.email, input);
  } else if (await hasProductAccess({ id: ctx.authUserId, email: ctx.email }, ctx.household.id)) {
    await completeOnboarding(ctx, input);
  } else redirect("/request-access");
  redirect("/dashboard");
}
