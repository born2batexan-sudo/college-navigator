"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestDemoAccess, type RequestAccessState } from "./actions";

const initialState: RequestAccessState = { submitted: false, error: null };

export default function RequestAccessPage() {
  const [state, action, pending] = useActionState(requestDemoAccess, initialState);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-7 px-6 py-8 sm:py-14">
      <header>
        <Link href="/" className="text-sm text-ink/60 underline underline-offset-4">Back to CampusPassage</Link>
        <p className="mt-8 text-xs font-semibold uppercase tracking-[.18em] text-violet">Private preview</p>
        <h1 className="mt-2 font-display text-4xl font-semibold text-ink">Request access</h1>
        <p className="mt-3 leading-7 text-ink/65">Tell us where to send a decision. We review requests before issuing a private, read-only invitation.</p>
      </header>

      {state.submitted ? (
        <section className="rounded-2xl border border-ok/30 bg-sky p-5" role="status">
          <h2 className="font-semibold text-ink">Thanks — your request is recorded.</h2>
          <p className="mt-2 text-sm leading-6 text-ink/70">If the request is approved, we will send next steps to the address provided. This page does not confirm whether an address already has access.</p>
          <Link href="/" className="mt-4 inline-block text-sm font-semibold text-accent underline underline-offset-4">Return to CampusPassage</Link>
        </section>
      ) : (
        <form action={action} className="flex flex-col gap-5 rounded-2xl border border-line bg-white/80 p-6 shadow-card">
          {state.error && <p role="alert" className="rounded-xl border border-urgent/30 bg-coralPale p-3 text-sm text-urgent">{state.error}</p>}
          <div>
            <label htmlFor="name" className="text-sm font-semibold text-ink">Name</label>
            <input id="name" name="name" required maxLength={100} autoComplete="name" className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink" />
          </div>
          <div>
            <label htmlFor="email" className="text-sm font-semibold text-ink">Email</label>
            <input id="email" name="email" required maxLength={254} type="email" autoComplete="email" className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink" />
          </div>
          <div className="hidden" aria-hidden="true">
            <label htmlFor="website">Website</label>
            <input id="website" name="website" tabIndex={-1} autoComplete="off" />
          </div>
          <label className="flex gap-3 text-sm leading-6 text-ink/70">
            <input name="consent" type="checkbox" required className="mt-1 h-4 w-4 accent-accent" />
            <span>I consent to CampusPassage using my name and email to review this private-preview request and, if approved, provide access instructions.</span>
          </label>
          <button disabled={pending} className="rounded-lg bg-coral px-5 py-3 font-semibold text-white transition hover:bg-coralDeep disabled:cursor-wait disabled:opacity-60" type="submit">
            {pending ? "Sending request…" : "Request private-preview access"}
          </button>
          <p className="text-xs leading-5 text-ink/45">Requests are reviewed manually. Do not send passwords, payment details, or application materials.</p>
        </form>
      )}
    </main>
  );
}
