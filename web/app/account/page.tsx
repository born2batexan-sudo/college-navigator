import Link from "next/link";
import { requireHousehold, requestOrigin } from "@/lib/auth/session";
import { getPurchaserAttestation, listMembers } from "@/lib/db/accounts";
import { listStudentsForHousehold } from "@/lib/db/repo";
import { START_TERMS } from "@/lib/terms";
import { StudentDot } from "@/components/StudentSwitcher";
import { addStudent, deleteAccount, makeInvite, signOut } from "./actions";
import { claimAccess, startCheckout } from './access-actions';
import { stripeReady } from '@/lib/db/stripe-review';
import { configured, mailEnabled } from '@/lib/mail/provider';
import { mailStatus } from '@/lib/mail/service';
import { connectMail, syncMail, disconnectMailAction, deleteMailAction } from './mail-actions';

export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ invite?: string; error?: string; mail?: string }> }) {
  const query = await searchParams;
  const ctx = await requireHousehold();
  const [members, students, attestation] = await Promise.all([listMembers(ctx.household.id), listStudentsForHousehold(ctx.household.id), getPurchaserAttestation(ctx.household.id)]);
  const inviteUrl = query.invite ? `${await requestOrigin()}/invite/${query.invite}` : null;
  const connections = !ctx.isDemo && ctx.isOwner ? await mailStatus({id:ctx.authUserId,email:ctx.email},ctx.household.id) : [];

  return (
    <main className="flex max-w-2xl flex-col gap-7">
      <header className="border-b border-line pb-6">
        <Link href="/" className="text-sm text-ink/50 hover:underline">
          ← Back to the dashboard
        </Link>
        <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-accent">Campus Passage</p>
        <h1 className="mt-1 font-display text-3xl font-semibold leading-tight text-ink sm:text-4xl">Account</h1>
        <p className="mt-2 text-ink/60">
          Signed in as {ctx.email ?? "your account"} · {ctx.household.name}
        </p>
      </header>

      {query.error && (
        <p role="alert" className="rounded-2xl border border-urgent/30 bg-urgent/10 p-4 text-sm font-medium text-urgent shadow-card">
          {query.error}
        </p>
      )}

      {query.mail && <p role="status" className="rounded-xl border border-line p-3 text-sm">{query.mail}</p>}
      {ctx.isDemo && <p className="rounded-xl border border-accent/25 bg-accent/10 p-3 text-sm text-ink/75"><strong className="font-semibold text-accent">Private Preview</strong> · This sample household is read-only. Changes are disabled.</p>}

      {!ctx.isDemo && ctx.isOwner && <section className="rounded-2xl border border-line bg-white/80 p-5 shadow-card sm:p-6"><h2 className="font-display text-xl font-semibold">Household-cycle access · built—not live</h2><p className="mt-2 text-sm text-ink/60">Sign-in is separate from purchase. A complimentary invitation is for this household only, expires, and works once. Returning from checkout never grants access; only a verified payment event can do that.</p><form action={claimAccess} className="mt-3 flex gap-2"><input name="token" required placeholder="One-time invitation token" className="min-w-0 flex-1 rounded border border-line p-2 text-sm"/><button className="rounded bg-accent px-3 py-2 text-sm text-white">Claim</button></form>{stripeReady() ? <form action={startCheckout} className="mt-3"><button className="rounded bg-accent px-3 py-2 text-sm text-white">Continue to hosted checkout</button></form> : <p className="mt-3 text-xs text-ink/55">Checkout not enabled. No payment methods are connected.</p>}</section>}
      {!ctx.isDemo && ctx.isOwner && <section className="rounded-2xl border border-line bg-white/80 p-5 shadow-card sm:p-6">
        <h2 className="font-display text-xl font-semibold">Connected mail</h2>
        <p className="mt-2 text-sm"><Link className="underline" href="/account/mail-privacy">Mail privacy controls remain available after access expires</Link></p>
        <p className="mt-2 text-sm text-ink/65">Optional, off unless explicitly enabled. Each provider needs separate consent. We query only curated, currently approved official school/vendor sender domains, collect limited sender/time evidence, never attachments or message bodies, and never certify school research or complete tasks from mail. Evidence is purged after 30 days. Disconnect or delete at any time.</p>
        {!mailEnabled() && <p className="mt-3 text-sm">Not enabled. New connections and syncing are unavailable; existing grants can still be removed.</p>}
        {mailEnabled() && <>
          {(['gmail','microsoft'] as const).map(p => configured(p) && <form key={p} action={connectMail} className="mt-4 rounded-lg border border-line p-3 text-sm">
            <input type="hidden" name="provider" value={p}/>
            <p className="font-medium">{p==='gmail'?'Google Gmail':'Microsoft 365 Outlook'}</p>
            <p className="mt-1 text-ink/60">{p==='gmail'?'Google gmail.readonly is needed for sender-scoped search; this is a restricted Google scope.':'Microsoft Mail.ReadBasic plus User.Read; the provider omits bodies, previews, and attachments.'} Account identity is verified by the provider; access can be revoked in provider settings.</p>
            <label className="mt-2 flex gap-2"><input type="checkbox" name="consent" value="yes" required/> I consent to this provider&apos;s limited mail access and 30-day evidence retention.</label>
            <button className="mt-2 rounded bg-accent px-3 py-2 text-white">Connect {p==='gmail'?'Gmail':'Microsoft 365'}</button>
          </form>)}
        </>}
          {connections.map(c=><div key={c.id} className="mt-4 rounded-lg border border-line p-3 text-sm">
            <p><strong>{c.provider==='gmail'?'Gmail':'Microsoft 365'}</strong> · {c.status} · consented {new Date(c.consented_at).toLocaleDateString()}</p>
            <p className="text-ink/60">Last sync: {c.last_sync_at?new Date(c.last_sync_at).toLocaleString():'never'}{c.retry_after?` · Retry after ${new Date(c.retry_after).toLocaleString()}`:''}</p>
            {mailEnabled() && c.status==='active'&&<form action={syncMail} className="inline-block mr-2"><input type="hidden" name="id" value={c.id}/><button className="underline">Sync approved senders</button></form>}
            {c.status!=='revoked'&&<form action={disconnectMailAction} className="inline-block"><input type="hidden" name="id" value={c.id}/><button className="underline">Disconnect and erase evidence</button></form>}
          </div>)}
          <p className="mt-3 text-xs text-ink/60">Microsoft does not provide per-app OAuth revocation under these least-privilege scopes. After disconnect, remove Campus Passage in <a className="underline" href="https://myapps.microsoft.com/">Microsoft My Apps</a>. If Google revocation fails, remove access in your Google account security settings. Local tokens and evidence are erased regardless.</p>
          <form action={deleteMailAction} className="mt-3 flex gap-2 text-sm"><input name="confirm" placeholder="Type DELETE" aria-label="Type DELETE to erase connected mail" className="rounded border border-line px-2"/><button className="rounded border border-urgent/40 px-3 py-2 text-urgent">Delete all connected-mail data</button></form>
      </section>}
      <section className="flex flex-col gap-4 rounded-2xl border border-line bg-white/80 p-5 shadow-card sm:p-6">
        <h2 className="font-display text-xl font-semibold text-ink">Student profiles</h2>
        <p className="text-sm text-ink/60">Every profile has separate schools, preferences, and action statuses. We never ask for a last name or use one as proof of a household relationship.</p>
        <ul className="flex flex-wrap gap-2">{students.map((student, index) => <li key={student.id}><Link className="inline-flex items-center gap-2 rounded-full bg-ink/5 px-3 py-1.5 text-sm font-medium text-ink/70 hover:bg-ink/10" href={`/dashboard?student=${student.id}`}><StudentDot index={index} />{student.name}&apos;s plan</Link></li>)}</ul>
        {ctx.isDemo ? <p className="text-sm text-ink/55">Adding student profiles is unavailable in Private Preview.</p> : <form action={addStudent} className="flex flex-col gap-3 border-t border-line pt-4"><p className="text-sm font-semibold text-ink">Add a student later · same admissions cycle</p><div className="flex flex-wrap gap-3"><label className="flex min-w-52 flex-1 flex-col gap-1 text-sm text-ink/70">First or preferred name<input required maxLength={60} autoComplete="off" name="studentName" className="rounded-md border border-line bg-white px-3 py-2 text-ink" /></label><label className="flex min-w-44 flex-1 flex-col gap-1 text-sm text-ink/70">Planned start term<select name="enteringTerm" defaultValue="Fall 2027" className="rounded-md border border-line bg-white px-3 py-2 text-ink">{START_TERMS.map((term) => <option key={term} value={term}>{term}</option>)}</select></label></div>{!attestation && <label className="flex gap-2 text-sm text-ink/65"><input name="purchaserAttested" type="checkbox" value="yes" required className="mt-1" /><span>I confirm I am authorized to manage this household plan. This is not relationship proof; unusual account-protection signals receive human review, never automatic rejection based on names, addresses, or protected traits.</span></label>}<button type="submit" className="w-fit rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition hover:opacity-90">Add student</button></form>}
        {attestation && <p className="text-xs text-ink/45">Household management authorization recorded {new Date(attestation.attestedAt).toLocaleDateString()}.</p>}
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border border-line bg-white/80 p-5 shadow-card sm:p-6">
        <h2 className="font-display text-xl font-semibold text-ink">Who shares this plan</h2>
        <ul className="flex flex-col gap-1 text-sm text-ink/70">
          {members.map((m, i) => (
            <li key={i}>
              {m.email ?? "Member"} <span className="text-ink/40">· {m.role === "owner" ? "plan owner" : "member"}</span>
            </li>
          ))}
        </ul>

        {ctx.isDemo ? <p className="text-sm text-ink/55">Member invitations are unavailable in Private Preview.</p> : inviteUrl ? (
          <div className="rounded-xl border border-line bg-white p-4 text-sm">
            <p className="font-medium text-ink">Send this link to the person you are inviting</p>
            <p className="mt-1 break-all rounded bg-ink/5 p-2 font-mono text-xs text-ink/80">{inviteUrl}</p>
            <p className="mt-2 text-xs text-ink/50">
              It works once and expires in 14 days. It is shown only now. If you lose it, make a new one.
            </p>
          </div>
        ) : (
          <form action={makeInvite} className="flex flex-wrap items-center gap-2 border-t border-line pt-4 text-sm">
            <label className="text-ink/70" htmlFor="invite-role">
              Invite the
            </label>
            <select id="invite-role" name="role" className="rounded-md border border-line bg-white px-2 py-1.5 text-ink">
              <option value="parent">other parent or guardian</option>
              <option value="student">student</option>
            </select>
            <button type="submit" className="rounded-md border border-line bg-white px-3 py-1.5 font-medium text-ink/70 hover:border-ink/30">
              Make an invite link
            </button>
          </form>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-white/80 p-5 shadow-card sm:p-6">
        <form action={signOut}>
          <button type="submit" className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink/70 hover:border-ink/30">
            Sign out
          </button>
        </form>
      </section>

      {!ctx.isDemo && <section className="flex flex-col gap-3 rounded-2xl border border-urgent/25 bg-white/80 p-5 shadow-card sm:p-6">
        <h2 className="font-display text-xl font-semibold text-urgent">Delete my account</h2>
        <p className="text-sm text-ink/60">
          {ctx.isOwner
            ? "You own this plan, so this deletes the whole family plan for everyone in it: the student, every school you track, every action and its history. Anyone else on the plan keeps their own sign-in but loses access to it. It cannot be undone."
            : "This removes you from the family plan and deletes your sign-in. The plan and its data stay with the owner."}
        </p>
        <form action={deleteAccount} className="flex flex-wrap items-center gap-2">
          <label htmlFor="confirm" className="sr-only">
            Type DELETE to confirm
          </label>
          <input id="confirm" name="confirm" placeholder="Type DELETE" autoComplete="off" className="rounded-md border border-line bg-white px-3 py-1.5 text-sm text-ink" />
          <button type="submit" className="rounded-md border border-urgent/40 px-3 py-1.5 text-sm font-medium text-urgent hover:bg-urgent/10">
            Delete my account
          </button>
        </form>
      </section>}
    </main>
  );
}
