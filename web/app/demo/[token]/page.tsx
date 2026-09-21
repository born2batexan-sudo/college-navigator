import Link from "next/link";
import { requireHousehold } from "@/lib/auth/session";
import { previewDemoInvite } from "@/lib/db/accounts";
import { acceptPrivatePreview } from "./actions";

export const dynamic = "force-dynamic";

export default async function DemoAcceptancePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ problem?: string }> }) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const ctx = await requireHousehold({ next: `/demo/${token}` });
  const invite = await previewDemoInvite(token);
  return <main className="mx-auto flex max-w-lg flex-col gap-6 py-8 sm:py-14">
    <header><p className="text-xs font-semibold uppercase tracking-[.18em] text-accent">CampusPassage · Private Preview</p><h1 className="mt-2 font-display text-3xl font-semibold text-ink">Explore a sample household</h1></header>
    {!invite ? <p className="rounded-2xl border border-line bg-white/70 p-4 text-sm text-ink/70">This private-preview link is unavailable. It may have been used, revoked, or expired.</p>
      : ctx.isDemo ? <p className="rounded-2xl border border-line bg-white/70 p-4 text-sm text-ink/70">You already have a private-preview household. Changes are disabled.</p>
      : query.problem === "populated" ? <p className="rounded-2xl border border-warn/30 bg-warn/10 p-4 text-sm text-ink/75">This preview can only be added to a new, empty account. Your existing plan was not changed.</p>
      : <form action={acceptPrivatePreview} className="rounded-2xl border border-line bg-white/70 p-5 shadow-card"><p className="text-sm leading-relaxed text-ink/70">This opens a separate sample plan with neutral names and representative schools. It is read-only: no changes, invitations, or school requests can be made.</p><p className="mt-2 text-xs text-ink/50">This single-use link expires {new Date(invite.expiresAt).toLocaleString()}.</p><input type="hidden" name="token" value={token}/><button className="mt-5 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90">Open private preview</button></form>}
    <Link className="text-sm text-ink/50 underline" href="/dashboard">Go to dashboard</Link>
  </main>;
}
