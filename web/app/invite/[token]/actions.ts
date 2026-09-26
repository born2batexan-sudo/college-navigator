"use server";

import { redirect } from "next/navigation";
import { requireInvitationHousehold } from "@/lib/auth/session";
import { acceptInvite } from "@/lib/db/accounts";

export async function joinFamily(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const ctx = await requireInvitationHousehold({ next: `/invite/${token}` });
  const result = await acceptInvite(ctx, token);
  if (!result.ok) redirect(`/invite/${encodeURIComponent(token)}?problem=${result.reason}`);
  redirect("/");
}
