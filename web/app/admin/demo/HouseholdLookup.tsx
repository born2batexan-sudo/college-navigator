"use client";

import { useActionState } from "react";
import { lookupHouseholds, type HouseholdLookupState } from "./lookup-actions";

const initialState: HouseholdLookupState = { query: "", results: [], searched: false, error: null };

function displayDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function HouseholdLookup() {
  const [state, search, pending] = useActionState(lookupHouseholds, initialState);

  return (
    <section aria-label="Read-only household lookup" className="rounded-2xl border border-line bg-white/70 p-5 shadow-card">
      <h2 className="font-display text-xl">Household and student lookup · read-only</h2>
      <p className="mt-2 text-sm text-ink/60">Find a household by its name, a parent/contact name or email, or a student name. Results are limited to household/account status and student names and graduation years; authentication identifiers, phone numbers, tokens, and student attributes are not shown.</p>
      <form action={search} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label htmlFor="household-lookup-query" className="flex-1 text-sm font-medium">Search term
          <input id="household-lookup-query" name="query" type="search" minLength={2} maxLength={120} autoComplete="off" className="mt-1 w-full rounded border border-line p-2" placeholder="Household, contact email, or student" required />
        </label>
        <button type="submit" disabled={pending} className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Searching…" : "Search accounts"}</button>
      </form>
      {state.error && <p role="alert" className="mt-3 text-sm text-urgent">{state.error}</p>}
      {state.searched && state.results.length === 0 && <p role="status" className="mt-4 text-sm text-ink/60">No matching households found.</p>}
      {state.results.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
          {state.results.map((household) => (
            <li key={household.id} className="p-4">
              <h3 className="font-semibold text-ink">{household.name}</h3>
              <p className="mt-1 text-xs text-ink/60"><span className="font-medium">Account state:</span> {household.subState} · <span className="font-medium">Created:</span> {displayDate(household.createdAt)} · <span className="font-medium">Household ID:</span> <code>{household.id}</code></p>
              <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-ink/55">Contacts</h4>
                  {household.contacts.length === 0 ? <p className="mt-1 text-ink/55">No contact records.</p> : <ul className="mt-1 space-y-1">{household.contacts.map((contact, index) => <li key={`${contact.email ?? contact.name}-${index}`}>{contact.name} · {contact.role}{contact.email ? ` · ${contact.email}` : ""}</li>)}</ul>}
                </div>
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-ink/55">Students</h4>
                  {household.students.length === 0 ? <p className="mt-1 text-ink/55">No student profiles.</p> : <ul className="mt-1 space-y-1">{household.students.map((student, index) => <li key={`${student.name}-${index}`}>{student.name} · Class of {student.gradYear}</li>)}</ul>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-ink/50">Up to 25 results are returned. Lookup does not expose authentication or invitation secrets and cannot change account or student data.</p>
    </section>
  );
}
