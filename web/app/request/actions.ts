"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWritableOnboardedHousehold } from "@/lib/auth/session";
import { createSchoolRequest } from "@/lib/db/requests";
import { CollegeCoverageBlockedError, createPendingAddonPurchase } from "@/lib/db/college-coverage";
import { addonUiReady, getCollegeAddonOffer } from "@/lib/db/college-addon-offer";
import { createAddonCheckout } from "@/lib/db/stripe-college-addon";
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
    if (error instanceof CollegeCoverageBlockedError && error.reason === "capacity_exhausted" && addonUiReady()) {
      redirect(`/request?addon=${encodeURIComponent(unitid)}`);
    }
    const message = error instanceof Error ? error.message : "Could not save that request.";
    redirect(`/request?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/request");
  revalidatePath("/");
  redirect("/request?submitted=1");
}

/** The only provider-initiating path: an explicit owner POST after a fresh server quote. */
export async function startCollegeAddon(formData: FormData): Promise<void> {
  const ctx = await requireWritableOnboardedHousehold();
  const unitid = String(formData.get("unitid") ?? "").trim();
  const cycle = enteringTermFrom(ctx.student);
  const offer = await getCollegeAddonOffer({ householdId: ctx.household.id, authUserId: ctx.authUserId,
    isOwner: ctx.isOwner, isDemo: ctx.isDemo, cycle, unitid });
  if (offer?.ownerRequired) redirect("/request?error=Ask+the+household+owner+to+review+additional+college+access.");
  if (!offer) redirect("/request?error=Add-on+checkout+is+unavailable.+Please+review+your+request+and+access.");
  let url: string;
  try {
    const purchase = await createPendingAddonPurchase({ householdId: ctx.household.id, authUserId: ctx.authUserId,
      cycle: offer.cycle, desiredCollegeIds: [offer.unitid], idempotencyKey: randomUUID() });
    // Pending is not access; only a matching, signed Stripe webhook grants a unit.
    url = await createAddonCheckout({ purchaseId: purchase.id, householdId: ctx.household.id, authUserId: ctx.authUserId });
  } catch {
    redirect("/request?error=Checkout+could+not+start.+No+college+capacity+has+been+added.+Please+retry+later.");
  }
  redirect(url);
}
