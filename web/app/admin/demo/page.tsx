import Link from "next/link";
import { listDemoInvites } from "@/lib/db/accounts";
import { requireDemoOwner } from "@/lib/auth/session";
import { revokeDemoInvite } from "./actions";
import { CreatePreviewLink } from "./CreatePreviewLink";

export const dynamic = "force-dynamic";

function status(invite: { acceptedAt: string | null; revokedAt: string | null; expiresAt: string }) {
  if (invite.acceptedAt) return "Accepted";
  if (invite.revokedAt) return "Revoked";
  if (new Date(invite.expiresAt).getTime() <= Date.now()) return "Expired";
  return "Open";
}

export default async function DemoAdminPage() {
  await requireDemoOwner();
  const invites = await listDemoInvites();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-7 py-5">
      <header className="border-b border-line pb-5">
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-accent">College Navigator</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Private Preview invitations</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink/65">
          Create a single-use, seven-day preview link. Each accepted link produces a separate, read-only sample household.
        </p>
      </header>

      <CreatePreviewLink />

      <section aria-label="Preview invitations" className="overflow-hidden rounded-2xl border border-line bg-white/70 shadow-card">
        <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-line px-4 py-3 text-xs font-semibold uppercase tracking-[.12em] text-ink/45">
          <span>Invitation</span><span>Status</span>
        </div>
        {invites.length === 0 ? (
          <p className="p-5 text-sm text-ink/60">No private-preview links have been created.</p>
        ) : (
          <ul className="divide-y divide-line">
            {invites.map((invite) => {
              const state = status(invite);
              const canRevoke = state === "Open";
              return (
                <li key={invite.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div>
                    <p className="text-sm font-medium text-ink">Created {new Date(invite.createdAt).toLocaleString()}</p>
                    <p className="mt-1 text-xs text-ink/55">
                      Expires {new Date(invite.expiresAt).toLocaleString()}
                      {invite.acceptedEmail ? ` · accepted by ${invite.acceptedEmail}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-ink/60">{state}</span>
                    {canRevoke && (
                      <form action={revokeDemoInvite}>
                        <input type="hidden" name="id" value={invite.id} />
                        <button className="text-sm font-semibold text-accent underline">Revoke</button>
                      </form>
                    )}
                  </div>
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
