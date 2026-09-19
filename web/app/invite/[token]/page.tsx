import Link from "next/link";
import { requireHousehold } from "@/lib/auth/session";
import { previewInvite } from "@/lib/db/accounts";
import { joinFamily } from "./actions";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params, searchParams }: { params: { token: string }; searchParams: { problem?: string } }) {
  const ctx = await requireHousehold({ next: `/invite/${params.token}` });
  const invite = await previewInvite(params.token);
  const alreadyIn = !!invite && invite.householdId === ctx.household.id;

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 pt-10">
      <header>
        <p className="text-sm font-medium uppercase tracking-wide text-ink/40">College Navigator</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">Family plan invite</h1>
      </header>

      {!invite ? (
        <p className="rounded-md border border-line bg-ink/5 p-3 text-sm text-ink/70">
          This invite link has already been used or has expired. Ask the plan owner to make a new one.
        </p>
      ) : searchParams.problem === "has_own_family" ? (
        <p className="rounded-md border border-warn/30 bg-warn/10 p-3 text-sm text-ink/80">
          You already have your own family plan with a student in it, so this link cannot move you. Delete your plan from the
          Account page first if you want to join {invite.householdName}.
        </p>
      ) : alreadyIn ? (
        <p className="text-ink/70">You are already part of this plan.</p>
      ) : (
        <form action={joinFamily} className="flex flex-col gap-3">
          <p className="text-ink/70">
            You have been invited to join <strong>{invite.householdName}</strong> as the {invite.invitedRole}. You will see the same
            schools and deadlines as everyone else on the plan.
          </p>
          <input type="hidden" name="token" value={params.token} />
          <button type="submit" className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition hover:opacity-90">
            Join this plan
          </button>
        </form>
      )}
      <Link href="/" className="text-sm text-ink/50 underline">
        Go to my dashboard
      </Link>
    </main>
  );
}
