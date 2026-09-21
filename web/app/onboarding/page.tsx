import { redirect } from "next/navigation";
import { requireHousehold } from "@/lib/auth/session";
import { ENTERING_CLASS_YEAR } from "@/lib/db/accounts";
import { saveOnboarding } from "./actions";
import { START_TERMS } from "@/lib/terms";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const query = await searchParams;
  const ctx = await requireHousehold();
  if (ctx.student) redirect("/");

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 pt-10">
      <header>
        <p className="text-sm font-medium uppercase tracking-wide text-ink/40">CampusPassage</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">Set up your family plan</h1>
        <p className="mt-1 text-ink/60">
          Three quick questions. Research currently covers the Fall {ENTERING_CLASS_YEAR} entering class; choosing another term keeps that distinction visible.
        </p>
      </header>

      {query.error && (
        <p role="alert" className="rounded-md border border-urgent/30 bg-urgent/10 p-3 text-sm text-urgent">
          {query.error}
        </p>
      )}

      <form action={saveOnboarding} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-ink/70" htmlFor="studentName">
          Student&apos;s first name
          <input
            id="studentName"
            name="studentName"
            required
            maxLength={60}
            autoComplete="off"
            className="rounded-md border border-line bg-white px-3 py-2 text-ink"
          />
        </label>

        <fieldset className="flex flex-col gap-2 text-sm text-ink/70">
          <legend className="mb-1">When does the student plan to start?</legend>
          <select name="enteringTerm" required defaultValue="Fall 2027" className="rounded-md border border-line bg-white px-3 py-2 text-ink">
            {START_TERMS.map((term) => <option key={term} value={term}>{term}</option>)}
          </select>
        </fieldset>

        <fieldset className="flex flex-col gap-2 text-sm text-ink/70">
          <legend className="mb-1">You are the</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="role" value="parent" defaultChecked /> Parent or guardian
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="role" value="student" /> Student
          </label>
        </fieldset>

        <button type="submit" className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition hover:opacity-90">
          Continue
        </button>
      </form>
    </main>
  );
}
