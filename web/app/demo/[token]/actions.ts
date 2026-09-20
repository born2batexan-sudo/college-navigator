"use server";

import { redirect } from "next/navigation";
import { requireHousehold } from "@/lib/auth/session";
import { acceptDemoInvite } from "@/lib/db/accounts";

export async function acceptPrivatePreview(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const ctx = await requireHousehold({ next: `/demo/${token}` });
  const result = await acceptDemoInvite(ctx, token);
  if (!result.ok) redirect(`/demo/${encodeURIComponent(token)}?problem=${result.reason}`);
  redirect("/dashboard");
}
