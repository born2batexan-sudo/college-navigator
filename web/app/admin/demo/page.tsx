import Link from "next/link";
import { listDemoAccessRequests } from "@/lib/db/demo-access";
import { listDemoInvites } from "@/lib/db/accounts";
import { requireDemoOwner } from "@/lib/auth/session";
import { revokeDemoInvite } from "./actions";
import { AccessRequestActions } from "./AccessRequestActions";
import GrantPanel from './GrantPanel';
import { accessSummary } from '@/lib/db/cycle-access';
import { resendConfigured } from '@/lib/email/resend';
import { listResearchExceptions } from '@/lib/db/request-pipeline';

export const dynamic = "force-dynamic";

function inviteStatus(invite: { acceptedAt: string | null; revokedAt: string | null; expiresAt: string }) {
  if (invite.acceptedAt) return "Accepted";
  if (invite.revokedAt) return "Revoked";
  if (new Date(invite.expiresAt).getTime() <= Date.now()) return "Expired";
  return "Open";
}

export default async function DemoAdminPage() {
  await requireDemoOwner();
  const [requests, invites, summary, researchExceptions] = await Promise.all([listDemoAccessRequests(), listDemoInvites(), accessSummary(), listResearchExceptions()]);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-7 py-5">
      <header className="border-b border-line pb-5">
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-accent">Campus Passage</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Private Preview access</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink/65">Review requests before issuing a single-use, seven-day read-only invitation. Invitation tokens are shown once and are never stored in plain text.</p>
      </header>

      <section className="rounded-xl border border-line bg-white/70 p-4 text-sm" aria-label="Review summary"><h2 className="font-semibold">Review summary · built—not live</h2><p className="mt-2">Pending requests: {summary.requests} · Active complimentary grants: {summary.grants} · Verified payments: {summary.payments} · Order exceptions: {summary.exceptions.length} · Webhook exceptions: {summary.webhookExceptions.length}</p>{summary.exceptions.length > 0 && <ul className="mt-2 list-disc pl-5">{summary.exceptions.map(x => <li key={x.id}>Order {x.id} · household {x.household_id} · {x.cycle} · {x.status}</li>)}</ul>}{summary.webhookExceptions.length>0 && <ul className="mt-2 list-disc pl-5">{summary.webhookExceptions.map(x=><li key={x.event_id}>Webhook {x.event_id}: {x.detail_code}</li>)}</ul>}<p className="mt-2 text-xs text-ink/55">Provider fees and net cash remain unreconciled until actual processor fee data is imported and checked. Webhook exceptions require separate review.</p></section>
      <section aria-label="Research exceptions" className="rounded-xl border border-line bg-white/70 p-4 text-sm"><h2 className="font-semibold">Research exceptions · {researchExceptions.length}</h2><p className="text-xs text-ink/55">Only withheld/conflicting evidence or exhausted/blocked jobs appear here; routine unpublished or unchanged checks do not notify families or the owner.</p>{researchExceptions.length>0 && <ul className="mt-2 space-y-1">{researchExceptions.map((x,i)=><li key={`${x.unitid}-${x.term}-${x.code}-${i}`}>{x.name} ({x.unitid}, {x.term}) · {x.code} · {x.state} {x.checkedAt && `· ${x.checkedAt}`}</li>)}</ul>}</section>
      <GrantPanel />
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
        <p className="border-t border-line px-4 py-3 text-xs leading-5 text-ink/45">{resendConfigured() ? 'Demo access notifications use the configured provider; review delivery records and copy a one-time link only through the owner workflow.' : 'Demo email delivery is not configured. Approval queues a notification record but does not send mail; copy the one-time link shown after approval.'} Paid checkout and connected mail remain review-only.</p>
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
