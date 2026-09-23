import Link from "next/link";
import { requireInvitationHousehold } from "@/lib/auth/session";
import { previewBetaInvite } from "@/lib/db/beta-access";
import { acceptBetaAccess } from "./actions";

export const dynamic = "force-dynamic";
export default async function AccessInvitationPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ problem?: string }> }) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const ctx = await requireInvitationHousehold({ next: `/access/${token}` });
  const invitation = await previewBetaInvite(token, ctx.email);
  return <main className="mx-auto flex max-w-lg flex-col gap-6 py-8 sm:py-14">
    <header><p className="text-xs font-semibold uppercase tracking-[.18em] text-accent">Campus Passage · Founding-family beta</p><h1 className="mt-2 font-display text-3xl font-semibold text-ink">Set up your family plan</h1></header>
    {!invitation ? <p className="rounded-2xl border border-line bg-white/70 p-4 text-sm text-ink/70">This invitation is unavailable for this sign-in address. It may have been used, revoked, or expired.</p>
      : query.problem === "populated" ? <p className="rounded-2xl border border-line bg-white/70 p-4 text-sm text-ink/70">This invitation requires a new, empty household. Your existing plan was not changed.</p>
      : <form action={acceptBetaAccess} className="rounded-2xl border border-line bg-white/70 p-5 shadow-card"><p className="text-sm leading-relaxed text-ink/70">Owner-approved complimentary access begins after you set up a real household for the current admissions cycle. This link is personal and cannot be forwarded. No payment is required.</p><p className="mt-2 text-xs text-ink/50">Accept and finish onboarding before {new Date(invitation.expires_at).toLocaleString()}.</p><input type="hidden" name="token" value={token}/><button className="mt-5 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white">Accept and continue to onboarding</button></form>}
    <Link className="text-sm text-ink/50 underline" href="/request-access">Request access</Link>
  </main>;
}
