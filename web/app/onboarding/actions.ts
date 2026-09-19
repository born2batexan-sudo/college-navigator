"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireHousehold } from "@/lib/auth/session";
import { completeOnboarding } from "@/lib/db/accounts";

const schema = z.object({
  studentName: z.string().trim().min(1, "Enter the student's first name.").max(60),
  role: z.enum(["parent", "student"]),
});

export async function saveOnboarding(formData: FormData): Promise<void> {
  const ctx = await requireHousehold();
  const parsed = schema.safeParse({ studentName: formData.get("studentName"), role: formData.get("role") });
  if (!parsed.success) {
    redirect(`/onboarding?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Please check the form.")}`);
  }
  await completeOnboarding(ctx, parsed.data);
  redirect("/welcome");
}
