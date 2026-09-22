"use client";

import { useState } from "react";
import { START_TERMS } from "@/lib/terms";
import { saveOnboarding } from "@/app/onboarding/actions";

const MAX_STUDENTS = 6;

/**
 * A household is set up as one plan containing distinct student profiles.
 * We intentionally collect only the name a family wants displayed; surnames
 * are never requested or used to infer a relationship.
 */
export function OnboardingForm() {
  const [count, setCount] = useState(1);
  return (
    <form action={saveOnboarding} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1 text-sm text-ink/70" htmlFor="studentCount">
        How many students are navigating college this cycle?
        <select id="studentCount" name="studentCount" value={count} onChange={(event) => setCount(Number(event.target.value))} className="rounded-md border border-line bg-white px-3 py-2 text-ink">
          {Array.from({ length: MAX_STUDENTS }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm font-medium text-ink">Student profiles</legend>
        <p className="-mt-2 text-xs text-ink/50">Each student gets a separate school list, preferences, and action status. Use a first or preferred name only.</p>
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className="rounded-xl border border-line bg-white/70 p-4">
            <p className="mb-3 text-sm font-medium text-ink">Student {index + 1}</p>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm text-ink/70" htmlFor={`studentName-${index}`}>
                First or preferred name
                <input id={`studentName-${index}`} name="studentName" required maxLength={60} autoComplete="off" className="rounded-md border border-line bg-white px-3 py-2 text-ink" />
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink/70" htmlFor={`enteringTerm-${index}`}>
                Planned start term
                <select id={`enteringTerm-${index}`} name="enteringTerm" required defaultValue="Fall 2027" className="rounded-md border border-line bg-white px-3 py-2 text-ink">
                  {START_TERMS.map((term) => <option key={term} value={term}>{term}</option>)}
                </select>
              </label>
            </div>
          </div>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2 text-sm text-ink/70">
        <legend className="mb-1">You are the</legend>
        <label className="flex items-center gap-2"><input type="radio" name="role" value="parent" defaultChecked /> Parent or guardian</label>
        <label className="flex items-center gap-2"><input type="radio" name="role" value="student" /> Student</label>
      </fieldset>

      <label className="flex gap-2 rounded-xl border border-line bg-white/70 p-3 text-sm leading-relaxed text-ink/70">
        <input name="purchaserAttested" type="checkbox" value="yes" required className="mt-1" />
        <span>I confirm I am authorized to purchase and manage this household plan for the students I add. CampusPassage does not use surnames as proof of relationship. If account-protection signals need attention, a person reviews them; we do not automatically reject families based on names, addresses, or protected traits.</span>
      </label>

      <button type="submit" className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition hover:opacity-90">Continue</button>
    </form>
  );
}
