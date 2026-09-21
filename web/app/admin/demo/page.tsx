import Link from "next/link";
import { listDemoAccessRequests } from "@/lib/db/demo-access";
import { listDemoInvites } from "@/lib/db/accounts";
import { requireDemoOwner } from "@/lib/auth/session";
import { revokeDemoInvite } from "./actions";
import { AccessRequestActions } from "./AccessRequestActions";

export const dynamic = "force-dynamic";

function inviteStatus(invite: { acceptedAt: string | null; revokedAt: string | null; expiresAt: string }) {
  if (invite.acceptedAt) return "Accepted";
  if (invite.revokedAt) return "Revoked";
  if (new Date(invite.expiresAt).getTime() <= Date.now()) return "Expired";
  return "Open";
}

export default async function DemoAdminPage() {
  await requireDemoOwner();
  const [requests, invites] = await Promise.all([listDemoAccessRequests(), listDemoInvites()]);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-7 py-5">
      <header className="border-b border-line pb-5">
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-accent">CampusPassage</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Private Preview access</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink/65">Review requests before issuing a single-use, seven-day read-only invitation. Invitation tokens are shown once and are never stored in plain text.</p>
      </header>

      <section aria-label="Demo access requests" className="overflow-hidden rounded-2xl border border-line bg-white/70 shadow-card">
        <div className="border-b border-line px-4 py-3 text-xs font-semibold uppercase tracking-[.12em] text-ink/45">Access requests</div>
        {requests.length === 0 ? (
          <p className="p-5 text-sm text-ink/60">No access requests have been submitted.</p>
        ) : (
          <ul className="divide-y divide-line">
            {requests.map((request) => (
              <li key={request.id} className="grid gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-start">
                <div>
                  <p className="text-sm font-medium text-ink">{request.requesterName}</p>
                  <p className="mt-1 text-sm text-ink/65">{request.requesterEmail}</p>
                  <p className="mt-1 text-xs text-ink/45">Requested {new Date(request.createdAt).toLocaleString()} · {request.status}</p>
                  {request.inviteExpiresAt && <p className="mt-1 text-xs text-ink/45">Invitation expires {new Date(request.inviteExpiresAt).toLocaleString()}{request.inviteAccepted ? " · accepted" : ""}</p>}
                </div>
                <AccessRequestActions id={request.id} status={request.status} inviteAccepted={request.inviteAccepted} />
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-line px-4 py-3 text-xs leading-5 text-ink/45">Email delivery is not configured. Approval queues a notification record but does not send mail; copy the one-time link shown after approval or configure and review a provider adapter before deployment.</p>
      </section>

      <section aria-label="Issued invitations" className="overflow-hidden rounded-2xl border border-line bg-white/70 shadow-card">
        <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-line px-4 py-3 text-xs font-semibold uppercase tracking-[.12em] text-ink/45"><span>Issued invitation</span><span>Status</span></div>
        {invites.length === 0 ? (
          <p className="p-5 text-sm text-ink/60">No invitations have been issued.</p>
        ) : (
          <ul className="divide-y divide-line">
            {invites.map((invite) => {
              const state = inviteStatus(invite);
              const canRevoke = state === "Open";
              return (
                <li key={invite.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div>
                    <p className="text-sm font-medium text-ink">Created {new Date(invite.createdAt).toLocaleString()}</p>
                    <p className="mt-1 text-xs text-ink/55">Expires {new Date(invite.expiresAt).toLocaleString()}{invite.acceptedEmail ? ` · accepted by ${invite.acceptedEmail}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-3"><span className="text-sm text-ink/60">{state}</span>{canRevoke && <form action={revokeDemoInvite}><input type="hidden" name="id" value={invite.id} /><button className="text-sm font-semibold text-urgent underline">Revoke</button></form>}</div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <Link href="/dashboard" className="text-sm text-ink/50 underline">Back to dashboard</Link>
    </main>
  );
}
