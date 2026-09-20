"use server";

import { revalidatePath } from "next/cache";
import { createDemoInvite, revokeDemoInvite as revokeStoredDemoInvite } from "@/lib/db/accounts";
import { requestOrigin, requireDemoOwner } from "@/lib/auth/session";

export type CreatePreviewState = { url: string | null; error: string | null };

/** Returns the bearer link once in the action response; it never enters a URL, log, or stored row. */
export async function makeDemoInvite(_previous: CreatePreviewState): Promise<CreatePreviewState> {
  const owner = await requireDemoOwner();
  try {
    const result = await createDemoInvite({ createdBy: owner.id, createdEmail: owner.email! });
    revalidatePath("/admin/demo");
    return { url: `${await requestOrigin()}/demo/${result.token}`, error: null };
  } catch {
    return { url: null, error: "The preview link could not be created. Check the private-preview configuration." };
  }
}

export async function revokeDemoInvite(formData: FormData): Promise<void> {
  const owner = await requireDemoOwner();
  const id = String(formData.get("id") ?? "").trim();
  if (id) await revokeStoredDemoInvite(id, { id: owner.id, email: owner.email! });
  revalidatePath("/admin/demo");
}
