"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWritableOnboardedHousehold } from "@/lib/auth/session";
import { createSchoolRequest } from "@/lib/db/requests";
import { enteringTermFrom } from "@/lib/terms";
import { wakeSchoolRequest } from "@/lib/request-dispatch";

export async function requestSchool(formData: FormData): Promise<void> {
  const ctx = await requireWritableOnboardedHousehold();
  const unitid = String(formData.get("unitid") ?? "").trim();
  if (!/^\d+$/.test(unitid)) redirect("/request?error=Choose+a+school+from+the+directory.");
  const term = enteringTermFrom(ctx.student);
  if (!term || term === "Not sure yet") redirect("/request?error=Choose+a+specific+entering+term+before+requesting+research.");
  try {
    const result = await createSchoolRequest({ householdId: ctx.household.id, personId: ctx.person?.id, unitid, term });
    // The request is already committed. Dispatch failure cannot undo it.
    await wakeSchoolRequest(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save that request.";
    redirect(`/request?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/request");
  revalidatePath("/");
  redirect("/request?submitted=1");
}
