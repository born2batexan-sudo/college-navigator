import Link from "next/link";
import { listRelationshipsForStudent, listInstitutions, listStudentsForHousehold } from "@/lib/db/repo";
import { requireSelectedStudent } from "@/lib/auth/session";
import { TRACKABLE_SCHOOL_SLUGS } from "@/lib/trackable";
import { parseAttributes, resolveAttributes } from "@/lib/rules-engine";
import { saveSchoolPreferences, saveStartTerm, stopTracking } from "./actions";
import { START_TERMS, enteringTermFrom, termNotice } from "@/lib/terms";
import type { Institution, InstitutionRelationship } from "@/lib/db/types";
import { StudentSwitcher } from "@/components/StudentSwitcher";

export const dynamic = "force-dynamic";
const HOUSING_OPTIONS = [{ value: "undecided", label: "Not decided yet" }, { value: "on_campus", label: "Planning to live on campus" }, { value: "off_campus", label: "Planning to live off campus" }, { value: "commuter", label: "Commuting from home" }];

type Params = { student?: string };
export default async function WelcomePage({ searchParams }: { searchParams: Promise<Params> }) {
  const query = await searchParams;
  const { student, household, isDemo } = await requireSelectedStudent(query.student);
  const [students, allInstitutions, relationships] = await Promise.all([listStudentsForHousehold(household.id), listInstitutions(), listRelationshipsForStudent(student.id, { includeInactive: true })]);
  const relByInstitution = new Map<string, InstitutionRelationship>(relationships.map((relationship) => [relationship.institutionId, relationship]));
  const schools = TRACKABLE_SCHOOL_SLUGS.map((slug) => allInstitutions.find((institution) => institution.slug === slug)).filter((institution): institution is Institution => !!institution);
  // Counted only against the schools this picker can actually show (the
  // trackable list above), not every active relationship on the student —
  // the Private Preview demo can carry an extra illustrative-example
  // relationship (Example Demo University) that never appears in this
  // picker, and counting it here would render an impossible "7 of 6".
  const trackedCount = schools.filter((institution) => relByInstitution.get(institution.id)?.active).length;
  const enteringTerm = enteringTermFrom(student) ?? "Fall 2027";
  const notice = termNotice(enteringTerm);
  const studentUrl = (id?: string) => id ? `/welcome?student=${encodeURIComponent(id)}` : "/dashboard";
  // A real, live-computed progress summary — not a saved wizard step. Every
  // number here is recalculated from the current account data on each
  // render, so it can never drift from what the account actually holds.
  const termConfirmed = !!enteringTermFrom(student);
  const schoolsStageDone = trackedCount > 0;

  return <main className="flex flex-col gap-7">
    <header className="border-b border-line pb-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Campus Passage · {student.name}&apos;s plan</p>
      <h1 className="mt-2 font-display text-3xl font-semibold leading-tight text-ink sm:text-4xl">Schools to track</h1>
      <p className="mt-2 max-w-2xl text-ink/60">Each student has an independent school list and preferences. Changes here affect only {student.name}&apos;s plan — never another student&apos;s.</p>
      {isDemo && <p className="mt-3 rounded-xl border border-accent/25 bg-accent/10 p-3 text-sm text-ink/75"><strong className="font-semibold text-accent">Private Preview</strong> · School settings are shown for context; changes are disabled.</p>}
      <p className="mt-3 text-sm text-ink/40">Currently tracking {trackedCount} of {schools.length} schools · <Link href={`/dashboard?student=${student.id}`} className="underline">Back to {student.name}&apos;s dashboard</Link></p>
    </header>

    <StudentSwitcher students={students} selectedStudentId={student.id} hrefFor={studentUrl} />

    {/* A visually staged journey, grouped from the same live data above — not a
        separately saved wizard step. Both stages are always editable in place;
        the numbering and "done" marks exist only to make the two-part shape of
        the workflow legible for one student at a time. */}
    <section aria-label="Setup progress" className="grid gap-3 sm:grid-cols-2">
      <StageTile number={1} label="Entering term" done={termConfirmed} detail={termConfirmed ? `Set to ${enteringTerm}` : `Defaulting to ${enteringTerm} until you confirm one`} />
      <StageTile number={2} label="School preferences" done={schoolsStageDone} detail={`${trackedCount} of ${schools.length} schools configured`} />
    </section>

    <section aria-labelledby="stage-term-heading" className="rounded-2xl border border-line border-t-4 border-t-accent bg-white/80 p-5 shadow-card sm:p-6">
      <div className="flex items-center gap-3">
        <StageBadge number={1} done={termConfirmed} />
        <h2 id="stage-term-heading" className="font-display text-xl font-semibold text-ink">Confirm {student.name}&apos;s entering term</h2>
      </div>
      <p className="mt-2 text-sm text-ink/55">This term decides which cycle&apos;s dates and requirements apply everywhere else in {student.name}&apos;s plan.</p>
      <form action={saveStartTerm} className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="studentId" value={student.id} />
        <label className="flex min-w-[16rem] flex-col gap-1 text-sm text-ink/70">
          Planned start term
          <select name="enteringTerm" defaultValue={enteringTerm} disabled={isDemo} className="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink disabled:opacity-60">
            {START_TERMS.map((term) => <option key={term} value={term}>{term}</option>)}
          </select>
        </label>
        <button type="submit" disabled={isDemo} className="rounded-md border border-accent px-3 py-1.5 text-sm font-medium text-accent disabled:cursor-not-allowed disabled:opacity-50">Save term</button>
      </form>
      {notice && <p className="mt-3 text-sm text-warn">{notice}</p>}
    </section>

    <section aria-labelledby="stage-schools-heading" className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <StageBadge number={2} done={schoolsStageDone} />
        <h2 id="stage-schools-heading" className="font-display text-xl font-semibold text-ink">Configure each school</h2>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{schools.map((institution) => {
        const rel = relByInstitution.get(institution.id); const attrs = rel ? resolveAttributes(rel, student) : parseAttributes(student); const isActive = !!rel?.active; const wasRemoved = !!rel && !rel.active;
        return <article key={institution.id} className="flex flex-col gap-4 rounded-2xl border border-line bg-white/80 p-5 shadow-card">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-display text-lg font-semibold text-ink">{institution.name}</h3>
              <TrackingBadge state={isActive ? "tracking" : wasRemoved ? "paused" : "not_tracked"} studentName={student.name} />
            </div>
          </div>
          <form action={saveSchoolPreferences} className="flex flex-col gap-3">
            <input type="hidden" name="studentId" value={student.id} /><input type="hidden" name="institutionId" value={institution.id} />
            <label className="flex flex-col gap-1 text-sm text-ink/70">Housing plan
              <select name="housingPlan" defaultValue={attrs.housingPlan ?? "undecided"} disabled={isDemo} className="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink disabled:opacity-60">
                {HOUSING_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-ink/70"><input type="checkbox" name="greekInterest" defaultChecked={attrs.greekInterest === true} disabled={isDemo} />Interested in Greek life / recruitment</label>
            <label className="flex items-center gap-2 text-sm text-ink/70"><input type="checkbox" name="bringingCar" defaultChecked={attrs.bringingCar === true} disabled={isDemo} />Bringing a car to campus</label>
            <label className="flex items-center gap-2 text-sm text-ink/70"><input type="checkbox" name="disabilityAccommodation" defaultChecked={attrs.disabilityAccommodation === true} disabled={isDemo} />Needs disability accommodations</label>
            <div className="mt-1 flex items-center gap-3">
              <button type="submit" disabled={isDemo} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">{isActive ? "Save preferences" : wasRemoved ? "Resume tracking" : "Start tracking"}</button>
              {isActive && <Link href={`/school/${institution.slug}?student=${student.id}`} className="text-sm text-ink/50 underline">View tracker</Link>}
            </div>
          </form>
          {isActive && <form action={stopTracking} className="border-t border-line pt-3"><input type="hidden" name="studentId" value={student.id} /><input type="hidden" name="institutionId" value={institution.id} /><button type="submit" disabled={isDemo} className="text-sm text-ink/40 underline hover:text-urgent disabled:cursor-not-allowed disabled:opacity-40">Stop tracking this school</button></form>}
        </article>;
      })}</div>
    </section>
  </main>;
}

function StageBadge({ number, done }: { number: number; done: boolean }) {
  return <span aria-hidden="true" className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-sm font-semibold ${done ? "bg-ok text-white" : "border border-line bg-white text-ink/50"}`}>{done ? "✓" : number}</span>;
}

function StageTile({ number, label, done, detail }: { number: number; label: string; done: boolean; detail: string }) {
  return <div className="flex items-center gap-3 rounded-2xl border border-line bg-white/80 p-4 shadow-card">
    <StageBadge number={number} done={done} />
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink/45">Stage {number} · {label}</p>
      <p className="mt-0.5 truncate text-sm font-medium text-ink">{detail}</p>
    </div>
  </div>;
}

const TRACKING_LABELS: Record<string, { label: string; className: string }> = {
  tracking: { label: "Tracking", className: "bg-ok/10 text-ok" },
  paused: { label: "Paused — tracker preserved", className: "bg-warn/10 text-warn" },
  not_tracked: { label: "Not tracked yet", className: "bg-ink/5 text-ink/50" },
};

function TrackingBadge({ state, studentName }: { state: "tracking" | "paused" | "not_tracked"; studentName: string }) {
  const info = TRACKING_LABELS[state];
  return <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide"><span className={`rounded-full px-2 py-0.5 ${info.className}`}>{info.label}</span>{state === "tracking" && <span className="normal-case font-medium text-ink/40">for {studentName}</span>}</p>;
}
