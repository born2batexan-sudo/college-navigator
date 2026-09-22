import Link from "next/link";
import { requireHousehold, requestOrigin } from "@/lib/auth/session";
import { getPurchaserAttestation, listMembers } from "@/lib/db/accounts";
import { listStudentsForHousehold } from "@/lib/db/repo";
import { START_TERMS } from "@/lib/terms";
import { StudentDot } from "@/components/StudentSwitcher";
import { addStudent, deleteAccount, makeInvite, signOut } from "./actions";

export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ invite?: string; error?: string }> }) {
  const query = await searchParams;
  const ctx = await requireHousehold();
  const [members, students, attestation] = await Promise.all([listMembers(ctx.household.id), listStudentsForHousehold(ctx.household.id), getPurchaserAttestation(ctx.household.id)]);
  const inviteUrl = query.invite ? `${await requestOrigin()}/invite/${query.invite}` : null;

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

      {ctx.isDemo && <p className="rounded-xl border border-accent/25 bg-accent/10 p-3 text-sm text-ink/75"><strong className="font-semibold text-accent">Private Preview</strong> · This sample household is read-only. Changes are disabled.</p>}

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
