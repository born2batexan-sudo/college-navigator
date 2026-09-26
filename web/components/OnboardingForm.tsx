"use client";

import { useState } from "react";
import { START_TERMS } from "@/lib/terms";
import { saveOnboarding } from "@/app/onboarding/actions";
import { StudentDot } from "@/components/StudentSwitcher";

const MAX_STUDENTS = 6;

/**
 * A household is set up as one plan containing distinct student profiles.
 * We intentionally collect only the name a family wants displayed; surnames
 * are never requested or used to infer a relationship.
 *
 * Visually grouped into three stages (how many, each profile, who's setting
 * this up) so a multi-student household can see the shape of the form at a
 * glance — this is presentational grouping of one real submission, not a
 * separately saved wizard step.
 */
export function OnboardingForm({ betaCycle }: { betaCycle?: string }) {
  const [count, setCount] = useState(1);
  const terms = betaCycle ? START_TERMS.filter(term => term === betaCycle) : START_TERMS;
  return (
    <form action={saveOnboarding} className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2 border-b border-line pb-6">
        <legend className="flex items-center gap-2 font-display text-lg font-semibold text-ink"><StageNumber n={1} />How many students are navigating college this cycle?</legend>
        <label className="flex max-w-xs flex-col gap-1 text-sm text-ink/70" htmlFor="studentCount">
          <span className="sr-only">Number of students</span>
          <select id="studentCount" name="studentCount" value={count} onChange={(event) => setCount(Number(event.target.value))} className="rounded-md border border-line bg-white px-3 py-2 text-ink">
            {Array.from({ length: MAX_STUDENTS }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value} student{value === 1 ? "" : "s"}</option>)}
          </select>
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-4 border-b border-line pb-6">
        <legend className="flex items-center gap-2 font-display text-lg font-semibold text-ink"><StageNumber n={2} />One admissions cycle, a profile for each student</legend>
        <label className="flex max-w-xs flex-col gap-1 text-sm text-ink/70" htmlFor="enteringTerm">
          Shared high-school graduation year / admissions cycle
          <select id="enteringTerm" name="enteringTerm" required defaultValue={betaCycle ?? "Fall 2027"} className="rounded-md border border-line bg-white px-3 py-2 text-ink">
            {terms.map((term) => <option key={term} value={term}>{term}</option>)}
          </select>
        </label>
        <p className="-mt-1 text-xs text-ink/50">Every qualifying student under the purchaser&apos;s genuine caregiving responsibility in this plan shares that cycle. Each student still gets a separate school list, priorities, preferences, and action status. Use a first or preferred name only.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: count }, (_, index) => (
            <div key={index} className="rounded-2xl border border-line border-t-4 bg-white/70 p-4 shadow-card" style={{ borderTopColor: ACCENT_HEX[index % ACCENT_HEX.length] }}>
              <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink"><StudentDot index={index} />Student {index + 1}</p>
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-sm text-ink/70" htmlFor={`studentName-${index}`}>
                  First or preferred name
                  <input id={`studentName-${index}`} name="studentName" required maxLength={60} autoComplete="off" className="rounded-md border border-line bg-white px-3 py-2 text-ink" />
                </label>
                <p className="text-xs text-ink/50">Cycle: shared above · this student&apos;s schools and priorities stay separate.</p>
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="flex items-center gap-2 font-display text-lg font-semibold text-ink"><StageNumber n={3} />You are the</legend>
        <div className="flex gap-4 text-sm text-ink/70">
          <label className="flex items-center gap-2"><input type="radio" name="role" value="parent" defaultChecked /> Parent or guardian</label>
          <label className="flex items-center gap-2"><input type="radio" name="role" value="student" /> Student</label>
        </div>

        <label className="flex gap-2 rounded-2xl border border-line bg-white/70 p-4 text-sm leading-relaxed text-ink/70 shadow-card">
          <input name="purchaserAttested" type="checkbox" value="yes" required className="mt-1" />
          <span>I confirm I am authorized to purchase and manage this household plan for the students I add. Campus Passage does not use surnames as proof of relationship. If account-protection signals need attention, a person reviews them; we do not automatically reject families based on names, addresses, or protected traits.</span>
        </label>
      </fieldset>

      <button type="submit" className="self-start rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90">Continue</button>
    </form>
  );
}

// Same fixed rotation as studentAccent()'s border color, expressed as plain
// hex so it can be used in an inline style (Tailwind can't safely generate
// dynamic class names like `border-t-${index}`).
const ACCENT_HEX = ["#E96555", "#087F78", "#6758C9", "#EDAE35"];

function StageNumber({ n }: { n: number }) {
  return <span aria-hidden="true" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-white font-display text-xs font-semibold text-ink/50">{n}</span>;
}
