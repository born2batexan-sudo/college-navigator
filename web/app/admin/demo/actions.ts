"use server";

import { revalidatePath } from "next/cache";
import { approveDemoAccessRequest, declineDemoAccessRequest, revokeDemoAccessRequest } from "@/lib/db/demo-access";
import { revokeDemoInvite as revokeStoredDemoInvite } from "@/lib/db/accounts";
import { queryOne } from "@/lib/db/client";
import { requestOrigin, requireDemoOwner } from "@/lib/auth/session";

export type ApproveAccessState = { inviteUrl: string | null; error: string | null };

/** Approval is the only path that issues an invite for a public request. */
export async function approveAccessRequest(_previous: ApproveAccessState, formData: FormData): Promise<ApproveAccessState> {
  const owner = await requireDemoOwner();
  const requestId = String(formData.get("requestId") ?? "").trim();
  if (!requestId) return { inviteUrl: null, error: "That request is unavailable." };
  try {
    const origin = await requestOrigin();
    const result = await approveDemoAccessRequest({ requestId, actor: { id: owner.id, email: owner.email! }, origin });
    if (!result.ok) return { inviteUrl: null, error: result.reason === "not_pending" ? "That request is no longer pending." : "The private-preview template is unavailable." };
    revalidatePath("/admin/demo");
    return { inviteUrl: `${origin}/demo/${result.token}`, error: null };
  } catch {
    return { inviteUrl: null, error: "The request could not be approved. Check the private-preview configuration." };
  }
}

export async function declineAccessRequest(formData: FormData): Promise<void> {
  const owner = await requireDemoOwner();
  const requestId = String(formData.get("requestId") ?? "").trim();
  if (requestId) await declineDemoAccessRequest({ requestId, actor: { id: owner.id, email: owner.email! }, origin: await requestOrigin() });
  revalidatePath("/admin/demo");
}

export async function revokeAccessRequest(formData: FormData): Promise<void> {
  const owner = await requireDemoOwner();
  const requestId = String(formData.get("requestId") ?? "").trim();
  if (requestId) await revokeDemoAccessRequest({ requestId, actor: { id: owner.id, email: owner.email! }, origin: await requestOrigin() });
  revalidatePath("/admin/demo");
}

/** Retained for already-issued direct links; new public requests use approval above. */
export async function revokeDemoInvite(formData: FormData): Promise<void> {
  const owner = await requireDemoOwner();
  const id = String(formData.get("id") ?? "").trim();
  if (id) {
    const linked = await queryOne<{ access_request_id: string | null }>("SELECT access_request_id FROM demo_invites WHERE id=$1", [id]);
    if (linked?.access_request_id) await revokeDemoAccessRequest({ requestId: linked.access_request_id, actor: { id: owner.id, email: owner.email! }, origin: await requestOrigin() });
    else await revokeStoredDemoInvite(id, { id: owner.id, email: owner.email! });
  }
  revalidatePath("/admin/demo");
}
