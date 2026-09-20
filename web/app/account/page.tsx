import Link from "next/link";
import { requireHousehold, requestOrigin } from "@/lib/auth/session";
import { listMembers } from "@/lib/db/accounts";
import { deleteAccount, makeInvite, signOut } from "./actions";

export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ invite?: string; error?: string }> }) {
  const query = await searchParams;
  const ctx = await requireHousehold();
  const members = await listMembers(ctx.household.id);
  const inviteUrl = query.invite ? `${await requestOrigin()}/invite/${query.invite}` : null;

  return (
    <main className="flex max-w-2xl flex-col gap-8">
      <header>
        <Link href="/" className="text-sm text-ink/50 hover:underline">
          ← Back to the dashboard
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-ink">Account</h1>
        <p className="mt-1 text-ink/60">
          Signed in as {ctx.email ?? "your account"} · {ctx.household.name}
        </p>
      </header>

      {query.error && (
        <p role="alert" className="rounded-md border border-urgent/30 bg-urgent/10 p-3 text-sm text-urgent">
          {query.error}
        </p>
      )}

      {ctx.isDemo && <p className="rounded-xl border border-accent/25 bg-accent/10 p-3 text-sm text-ink/75"><strong className="text-accent">Private Preview</strong> · This sample household is read-only. Changes are disabled.</p>}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">Who shares this plan</h2>
        <ul className="flex flex-col gap-1 text-sm text-ink/70">
          {members.map((m, i) => (
            <li key={i}>
              {m.email ?? "Member"} <span className="text-ink/40">· {m.role === "owner" ? "plan owner" : "member"}</span>
            </li>
          ))}
        </ul>

        {ctx.isDemo ? <p className="text-sm text-ink/55">Member invitations are unavailable in Private Preview.</p> : inviteUrl ? (
          <div className="rounded-lg border border-line bg-white p-4 text-sm">
            <p className="font-medium text-ink">Send this link to the person you are inviting</p>
            <p className="mt-1 break-all rounded bg-ink/5 p-2 font-mono text-xs text-ink/80">{inviteUrl}</p>
            <p className="mt-2 text-xs text-ink/50">
              It works once and expires in 14 days. It is shown only now. If you lose it, make a new one.
            </p>
          </div>
        ) : (
          <form action={makeInvite} className="flex flex-wrap items-center gap-2 text-sm">
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

      <section>
        <form action={signOut}>
          <button type="submit" className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink/70 hover:border-ink/30">
            Sign out
          </button>
        </form>
      </section>

      {!ctx.isDemo && <section className="flex flex-col gap-3 border-t border-line pt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">Delete my account</h2>
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
