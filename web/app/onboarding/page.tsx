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
    <main className="mx-auto flex max-w-2xl flex-col gap-7 pt-10">
      <header className="border-b border-line pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Campus Passage</p>
        <h1 className="mt-2 font-display text-3xl font-semibold leading-tight text-ink sm:text-4xl">Set up your household plan</h1>
        <p className="mt-2 max-w-xl text-ink/60">Set up one household account, then give every student an independent plan. Research currently covers the Fall {ENTERING_CLASS_YEAR} entering class; another term stays clearly labeled.</p>
      </header>

      {query.error && <p role="alert" className="rounded-2xl border border-urgent/30 bg-urgent/10 p-4 text-sm font-medium text-urgent shadow-card">{query.error}</p>}

      <div className="rounded-2xl border border-line bg-white/80 p-5 shadow-card sm:p-6">
        <OnboardingForm />
      </div>
    </main>
  );
}
