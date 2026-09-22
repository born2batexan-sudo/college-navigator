import { redirect } from "next/navigation";
import { requireHousehold } from "@/lib/auth/session";
import { ENTERING_CLASS_YEAR } from "@/lib/db/accounts";
import { OnboardingForm } from "@/components/OnboardingForm";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const query = await searchParams;
  const ctx = await requireHousehold();
  if (ctx.student) redirect("/");

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 pt-10">
      <header>
        <p className="text-sm font-medium uppercase tracking-wide text-ink/40">CampusPassage</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">Set up your household plan</h1>
        <p className="mt-1 text-ink/60">Set up one household account, then give every student an independent plan. Research currently covers the Fall {ENTERING_CLASS_YEAR} entering class; another term stays clearly labeled.</p>
      </header>

      {query.error && <p role="alert" className="rounded-md border border-urgent/30 bg-urgent/10 p-3 text-sm text-urgent">{query.error}</p>}
      <OnboardingForm />
    </main>
  );
}
