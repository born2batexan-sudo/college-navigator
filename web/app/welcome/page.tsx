import Link from "next/link";
import {
  listHouseholds,
  listStudentsForHousehold,
  listRelationshipsForStudent,
  listInstitutions,
} from "@/lib/db/repo";
import { parseAttributes, resolveAttributes } from "@/lib/rules-engine";
import { COVERAGE_LABELS, COVERAGE_STYLES } from "@/lib/format";
import { saveSchoolPreferences, stopTracking } from "./actions";
import type { Institution, InstitutionRelationship } from "@/lib/db/types";

export const dynamic = "force-dynamic";

// Scope decision (2026-09-13): the picker only ever offers these six
// already-researched, "certified"/near-certified schools — not an
// open add-any-college flow. Extend this list (and re-run research) before
// offering a school here.
const TRACKABLE_SCHOOL_SLUGS = ["alabama", "arkansas", "oklahoma", "arizona", "ut-austin", "texas-am"];

const HOUSING_OPTIONS: { value: string; label: string }[] = [
  { value: "undecided", label: "Not decided yet" },
  { value: "on_campus", label: "Planning to live on campus" },
  { value: "off_campus", label: "Planning to live off campus" },
  { value: "commuter", label: "Commuting from home" },
];

export default async function WelcomePage() {
  const households = await listHouseholds();
  const household = households[0];

  if (!household) {
    return (
      <main>
        <p className="text-ink/60">
          No household seeded yet. Run <code className="rounded bg-ink/5 px-1">npm run db:seed</code> and reload.
        </p>
      </main>
    );
  }

  const students = await listStudentsForHousehold(household.id);
  const student = students[0];
  const allInstitutions = await listInstitutions();
  const relationships = await listRelationshipsForStudent(student.id, { includeInactive: true });
  const relByInstitution = new Map<string, InstitutionRelationship>(relationships.map((r) => [r.institutionId, r]));

  const schools = TRACKABLE_SCHOOL_SLUGS.map((slug) => allInstitutions.find((i) => i.slug === slug)).filter(
    (i): i is Institution => !!i
  );

  const trackedCount = relationships.filter((r) => r.active).length;

  return (
    <main className="flex flex-col gap-8">
      <header>
        <p className="text-sm font-medium uppercase tracking-wide text-ink/40">College Navigator</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">Schools to track</h1>
        <p className="mt-1 max-w-2xl text-ink/60">
          Choose which schools {student.name} is actively juggling, and answer a few quick questions for each one.
          Those answers — housing plan, Greek life interest, bringing a car, disability accommodations — decide which
          of the 144 checkpoints actually apply, so the action queue only shows what's relevant to that school.
        </p>
        <p className="mt-3 text-sm text-ink/40">
          Currently tracking {trackedCount} of {schools.length} schools ·{" "}
          <Link href="/" className="underline">
            Back to the dashboard
          </Link>
        </p>
      </header>

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
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${COVERAGE_STYLES[institution.coverageStatus]}`}
                >
                  {COVERAGE_LABELS[institution.coverageStatus]} · {institution.coveragePct}%
                </span>
              </div>

              <form action={saveSchoolPreferences} className="flex flex-col gap-3">
                <input type="hidden" name="studentId" value={student.id} />
                <input type="hidden" name="institutionId" value={institution.id} />

                <label className="flex flex-col gap-1 text-sm text-ink/70">
                  Housing plan
                  <select
                    name="housingPlan"
                    defaultValue={attrs.housingPlan ?? "undecided"}
                    className="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
                  >
                    {HOUSING_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex items-center gap-2 text-sm text-ink/70">
                  <input type="checkbox" name="greekInterest" defaultChecked={attrs.greekInterest === true} />
                  Interested in Greek life / recruitment
                </label>

                <label className="flex items-center gap-2 text-sm text-ink/70">
                  <input type="checkbox" name="bringingCar" defaultChecked={attrs.bringingCar === true} />
                  Bringing a car to campus
                </label>

                <label className="flex items-center gap-2 text-sm text-ink/70">
                  <input
                    type="checkbox"
                    name="disabilityAccommodation"
                    defaultChecked={attrs.disabilityAccommodation === true}
                  />
                  Needs disability accommodations
                </label>

                <div className="mt-1 flex items-center gap-3">
                  <button
                    type="submit"
                    className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
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
                  <input type="hidden" name="studentId" value={student.id} />
                  <input type="hidden" name="institutionId" value={institution.id} />
                  <button type="submit" className="text-sm text-ink/40 underline hover:text-urgent">
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
