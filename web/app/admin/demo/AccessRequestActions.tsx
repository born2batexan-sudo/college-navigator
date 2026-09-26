"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { approveAccessRequest, declineAccessRequest, revokeAccessRequest, type ApproveAccessState } from "./actions";

const initialState: ApproveAccessState = { inviteUrl: null, error: null };

type Props = { id: string; status: string; inviteAccepted: boolean };

export function AccessRequestActions({ id, status }: Props) {
  const [state, approve, pending] = useActionState(approveAccessRequest, initialState);
  const router = useRouter();
  const refresh = () => setTimeout(() => router.refresh(), 0);
  return (
    <div className="flex flex-col items-end gap-2">
      {status === "pending" && (
        <div className="flex gap-3">
          <form action={approve}>
            <input type="hidden" name="requestId" value={id} />
            <button disabled={pending} className="text-sm font-semibold text-accent underline disabled:opacity-50" type="submit">{pending ? "Approving…" : "Approve"}</button>
          </form>
          <form action={async (formData) => { await declineAccessRequest(formData); refresh(); }}>
            <input type="hidden" name="requestId" value={id} />
            <button className="text-sm font-semibold text-urgent underline" type="submit">Decline</button>
          </form>
        </div>
      )}
      {status === "approved" && (
        <form action={async (formData) => { await revokeAccessRequest(formData); refresh(); }}>
          <input type="hidden" name="requestId" value={id} />
          <button className="text-sm font-semibold text-urgent underline" type="submit">Revoke</button>
        </form>
      )}
      {state.error && <p role="alert" className="max-w-xs text-right text-xs text-urgent">{state.error}</p>}
      {state.inviteUrl && (
        <div className="max-w-sm rounded-xl border border-accent/30 bg-accent/10 p-3 text-left" role="status">
          <p className="text-xs font-semibold text-ink">Copy this invitation now.</p>
          <p className="mt-1 break-all font-mono text-[11px] text-ink/70">{state.inviteUrl}</p>
          <p className="mt-1 text-[11px] text-ink/55">It is single-use and expires in seven days. It will not be shown again.</p>
        </div>
      )}
    </div>
  );
}
