"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOnboardedHousehold } from "@/lib/auth/session";
import { createSchoolRequest } from "@/lib/db/requests";
import { enteringTermFrom } from "@/lib/terms";

export async function requestSchool(formData: FormData): Promise<void> {
  const ctx = await requireOnboardedHousehold();
  const unitid = String(formData.get("unitid") ?? "").trim();
  if (!/^\d+$/.test(unitid)) redirect("/request?error=Choose+a+school+from+the+directory.");
  // Existing families without the new field are treated as Fall 2027 until they edit it.
  const term = enteringTermFrom(ctx.student) ?? "Fall 2027";
  try {
    await createSchoolRequest({ householdId: ctx.household.id, personId: ctx.person?.id, unitid, term });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save that request.";
    redirect(`/request?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/request");
  revalidatePath("/");
  redirect("/request?submitted=1");
}
