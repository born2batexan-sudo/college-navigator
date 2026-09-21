import Link from "next/link";
import { listRelationshipsForStudent, listInstitutions } from "@/lib/db/repo";
import { requireOnboardedHousehold } from "@/lib/auth/session";
import { TRACKABLE_SCHOOL_SLUGS } from "@/lib/trackable";
import { parseAttributes, resolveAttributes } from "@/lib/rules-engine";
import { saveSchoolPreferences, saveStartTerm, stopTracking } from "./actions";
import { START_TERMS, enteringTermFrom, termNotice } from "@/lib/terms";
import type { Institution, InstitutionRelationship } from "@/lib/db/types";

export const dynamic = "force-dynamic";

const HOUSING_OPTIONS: { value: string; label: string }[] = [
  { value: "undecided", label: "Not decided yet" },
  { value: "on_campus", label: "Planning to live on campus" },
  { value: "off_campus", label: "Planning to live off campus" },
  { value: "commuter", label: "Commuting from home" },
];

export default async function WelcomePage() {
  const { student, isDemo } = await requireOnboardedHousehold();
  const allInstitutions = await listInstitutions();
  const relationships = await listRelationshipsForStudent(student.id, { includeInactive: true });
  const relByInstitution = new Map<string, InstitutionRelationship>(relationships.map((r) => [r.institutionId, r]));

  const schools = TRACKABLE_SCHOOL_SLUGS.map((slug) => allInstitutions.find((i) => i.slug === slug)).filter(
    (i): i is Institution => !!i
  );

  const trackedCount = relationships.filter((r) => r.active).length;
  const enteringTerm = enteringTermFrom(student) ?? "Fall 2027";
  const notice = termNotice(enteringTerm);

  return (
    <main className="flex flex-col gap-8">
      <header>
        <p className="text-sm font-medium uppercase tracking-wide text-ink/40">UVOYANT</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">Schools to track</h1>
        <p className="mt-1 max-w-2xl text-ink/60">
          Keep every college-specific requirement in one calm plan. A few household preferences help us surface only
          the actions, deadlines, and decisions that are pertinent to this student.
        </p>
        {isDemo && <p className="mt-3 rounded-xl border border-accent/25 bg-accent/10 p-3 text-sm text-ink/75"><strong className="text-accent">Private Preview</strong> · School settings are shown for context; changes are disabled.</p>}
        <p className="mt-3 text-sm text-ink/40">
          Currently tracking {trackedCount} of {schools.length} schools ·{" "}
          <Link href="/" className="underline">
            Back to the dashboard
          </Link>
        </p>
      </header>

      <section className="rounded-lg border border-line bg-white p-4">
        <form action={saveStartTerm} className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[16rem] flex-col gap-1 text-sm text-ink/70">Planned start term
            <select name="enteringTerm" defaultValue={enteringTerm} disabled={isDemo} className="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink disabled:opacity-60">{START_TERMS.map((term) => <option key={term} value={term}>{term}</option>)}</select>
          </label>
          <button type="submit" disabled={isDemo} className="rounded-md border border-accent px-3 py-1.5 text-sm font-medium text-accent disabled:cursor-not-allowed disabled:opacity-50">Save term</button>
        </form>
        {notice && <p className="mt-3 text-sm text-warn">{notice}</p>}
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {schools.map((institution) => {
          const rel = relByInstitution.get(institution.id);
          const attrs = rel ? resolveAttributes(rel, student) : parseAttributes(student);
          const isActive = !!rel?.active;
          const wasRemoved = !!rel && !rel.active;

          return (
            <div key={institution.id} className="flex flex-col gap-4 rounded-lg border border-line bg-white p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-medium text-ink">{institution.name}</h2>
                  <p className="mt-0.5 text-xs text-ink/40">
                    {isActive ? (
                      <span className="font-medium text-ok">Tracking</span>
                    ) : wasRemoved ? (
                      <span className="font-medium text-warn">Paused — tracker preserved</span>
                    ) : (
                      <span>Not tracked yet</span>
                    )}
                  </p>
                </div>
                {isActive && <span className="shrink-0 rounded-full bg-ok/10 px-2 py-0.5 text-[11px] font-medium text-ok">Plan ready</span>}
              </div>

              <form action={saveSchoolPreferences} className="flex flex-col gap-3">
                <input type="hidden" name="institutionId" value={institution.id} />

                <label className="flex flex-col gap-1 text-sm text-ink/70">
                  Housing plan
                  <select
                    name="housingPlan"
                    defaultValue={attrs.housingPlan ?? "undecided"}
                    disabled={isDemo}
                    className="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink disabled:opacity-60"
                  >
                    {HOUSING_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex items-center gap-2 text-sm text-ink/70">
                  <input type="checkbox" name="greekInterest" defaultChecked={attrs.greekInterest === true} disabled={isDemo} />
                  Interested in Greek life / recruitment
                </label>

                <label className="flex items-center gap-2 text-sm text-ink/70">
                  <input type="checkbox" name="bringingCar" defaultChecked={attrs.bringingCar === true} disabled={isDemo} />
                  Bringing a car to campus
                </label>

                <label className="flex items-center gap-2 text-sm text-ink/70">
                  <input
                    type="checkbox"
                    name="disabilityAccommodation"
                    defaultChecked={attrs.disabilityAccommodation === true}
                    disabled={isDemo}
                  />
                  Needs disability accommodations
                </label>

                <div className="mt-1 flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={isDemo}
                    className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isActive ? "Save preferences" : wasRemoved ? "Resume tracking" : "Start tracking"}
                  </button>
                  {isActive && (
                    <Link href={`/school/${institution.slug}`} className="text-sm text-ink/50 underline">
                      View tracker
                    </Link>
                  )}
                </div>
              </form>

              {isActive && (
                <form action={stopTracking} className="border-t border-line pt-3">
                    <input type="hidden" name="institutionId" value={institution.id} />
                  <button type="submit" disabled={isDemo} className="text-sm text-ink/40 underline hover:text-urgent disabled:cursor-not-allowed disabled:opacity-40">
                    Stop tracking this school
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </section>
    </main>
  );
}
