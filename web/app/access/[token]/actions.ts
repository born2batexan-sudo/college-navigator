"use server";
import { redirect } from "next/navigation";
import { requireInvitationHousehold } from "@/lib/auth/session";
import { acceptBetaInvite } from "@/lib/db/beta-access";

export async function acceptBetaAccess(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const ctx = await requireInvitationHousehold({ next: `/access/${token}` });
  const status = await acceptBetaInvite(ctx, token);
  if (status !== "accepted") redirect(`/access/${encodeURIComponent(token)}?problem=${status}`);
  redirect("/onboarding");
}
