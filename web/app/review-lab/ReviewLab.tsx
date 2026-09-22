"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { answerReviewGuide, filterReviewWork, guideFacts, horizonEvents, journeyThemes, pageAssistMode, reviewStudents, type ReviewStudent } from "@/lib/review-lab";

const preferenceLabels: { key: keyof ReviewStudent["preferences"]; title: string; description: string }[] = [
  { key: "carParking", title: "Car / parking", description: "Show parking-related work" },
  { key: "campusHousing", title: "Campus housing", description: "Show housing-related work" },
  { key: "greekLife", title: "Greek life", description: "Show student-life awareness work" },
  { key: "accommodations", title: "Accommodations", description: "Show accessibility contact work" },
];

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-line bg-white/80 p-5 shadow-card sm:p-6"><p className="text-xs font-semibold uppercase tracking-[.16em] text-accent">{eyebrow}</p><h2 className="mt-2 font-display text-2xl font-semibold text-ink">{title}</h2>{children}</section>;
}

export function ReviewLab() {
  const [students, setStudents] = useState(reviewStudents);
  const [selectedId, setSelectedId] = useState<ReviewStudent["id"]>("maya");
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [trackedScholarship, setTrackedScholarship] = useState(false);
  const [question, setQuestion] = useState("When does the aid offer open?");
  const [guide, setGuide] = useState(() => answerReviewGuide("When does the aid offer open?"));
  const [assistActive, setAssistActive] = useState(false);
  const student = students.find((entry) => entry.id === selectedId)!;
  const work = useMemo(() => filterReviewWork(student), [student]);
  const updatePreference = (key: keyof ReviewStudent["preferences"]) => setStudents((current) => current.map((entry) => entry.id === selectedId ? { ...entry, preferences: { ...entry.preferences, [key]: !entry.preferences[key] } } : entry));
  const askGuide = (event: React.FormEvent) => { event.preventDefault(); setGuide(answerReviewGuide(question)); };

  return <main className="mx-auto flex max-w-6xl flex-col gap-6 py-5">
    <header className="border-b border-line pb-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-accent">Campus Passage · owner review lab</p><h1 className="mt-2 font-display text-3xl font-semibold text-ink sm:text-4xl">Private product pressure test</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-ink/65">A controlled interface review with fixed, fictional sample data. Nothing here is a customer feature, live school information, advice, or a sending workflow.</p></div><Link href="/dashboard" className="shrink-0 text-sm font-semibold text-accent underline">Back to dashboard</Link></div>
      <p className="mt-5 rounded-xl border border-gold/40 bg-goldPale/60 px-4 py-3 text-sm text-ink/75"><strong>Internal only.</strong> Every school, student, date, source, and status below is fictional and exists solely for same-day owner review.</p>
    </header>

    <Section eyebrow="Household view" title="A same-cycle household, with clear active plans">
      <div className="mt-4 grid gap-3 sm:grid-cols-2">{students.map((entry) => <button type="button" key={entry.id} onClick={() => setSelectedId(entry.id)} aria-pressed={entry.id === selectedId} className={`rounded-xl border p-4 text-left transition ${entry.id === selectedId ? "border-accent bg-sky/55 ring-2 ring-accent/20" : "border-line bg-paper/45 hover:bg-paperDeep/35"}`}><p className="font-display text-xl font-semibold text-ink">{entry.name}</p><p className="mt-1 text-sm text-ink/60">{entry.year} · {entry.id === selectedId ? "Active review plan" : "Switch to this plan"}</p></button>)}</div>
      <p className="mt-4 text-sm text-ink/60">Reviewing: <strong className="text-ink">{student.name}</strong> · {student.year} / {student.admissionsCycle}. This fixed illustration uses two applicants; the household model supports two or more qualifying students under a purchaser&apos;s genuine caregiving responsibility when they share the same cycle. Switching changes only this fictional plan.</p>
    </Section>

    <div className="grid gap-6 lg:grid-cols-2">
      <Section eyebrow="Relevance controls" title={`${student.name}'s editable applicability`}>
        <p className="mt-3 text-sm leading-6 text-ink/65">Toggle a preference to pressure-test which work becomes relevant. This is local demo state only; it does not save a profile.</p>
        <div className="mt-4 space-y-2">{preferenceLabels.map(({ key, title, description }) => <label key={key} className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-line bg-paper/35 px-4 py-3"><span><span className="block text-sm font-semibold text-ink">{title}</span><span className="block text-xs text-ink/55">{description}</span></span><input type="checkbox" checked={student.preferences[key]} onChange={() => updatePreference(key)} className="h-5 w-5 accent-accent" /></label>)}</div>
      </Section>
      <Section eyebrow="Filtered work" title="Only applicable work is foregrounded">
        <div className="mt-4 space-y-2">{work.visible.map((item) => <article key={item.id} className="rounded-xl border border-accent/25 bg-sky/35 p-3"><p className="text-xs font-semibold uppercase tracking-[.12em] text-accent">{item.theme}</p><h3 className="mt-1 font-semibold text-ink">{item.title}</h3><p className="mt-1 text-sm text-ink/65">{item.detail}</p></article>)}</div>
        <details className="mt-4 rounded-xl border border-line bg-paper/35 p-3"><summary className="cursor-pointer text-sm font-semibold text-ink">{work.hidden.length} item{work.hidden.length === 1 ? "" : "s"} intentionally hidden — show why</summary><ul className="mt-3 space-y-2">{work.hidden.map((item) => <li key={item.id} className="text-sm text-ink/65"><strong className="text-ink">{item.title}:</strong> {item.hideReason}</li>)}</ul></details>
      </Section>
    </div>

    <Section eyebrow="The customer journey" title="Twelve family-facing themes, not an internal operating list">
      <p className="mt-3 text-sm text-ink/65">This review names the family journey in plain language. In particular, financial aid, scholarship awareness, and tuition, billing, and 529 are distinct moments.</p>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{journeyThemes.map((theme, index) => <li key={theme} className="flex gap-3 rounded-xl border border-line bg-paper/35 p-3 text-sm text-ink"><span className="font-display text-lg font-semibold text-accent">{String(index + 1).padStart(2, "0")}</span><span>{theme}</span></li>)}</ol>
    </Section>

    <Section eyebrow="Campus Passage Horizon · review concept" title="Upcoming timing, with certainty made visible">
      <p className="mt-3 text-sm text-ink/65">Illustrative timeline states only. Dates are fictional; expected and unpublished items are never represented as confirmed.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{horizonEvents.map((event) => <article key={`${event.label}-${event.state}`} className="rounded-xl border border-line bg-paper/35 p-4"><p className="text-xs font-semibold uppercase tracking-[.12em] text-violet">{event.state}</p><h3 className="mt-2 font-semibold text-ink">{event.label}</h3><p className="mt-1 font-display text-lg text-ink">{event.date ?? "—"}</p><p className="mt-2 text-xs leading-5 text-ink/60">{event.note}</p></article>)}</div>
    </Section>

    <div className="grid gap-6 lg:grid-cols-2">
      <Section eyebrow="Scholarship awareness · review concept" title="Family tracking, never a qualification decision">
        <article className="mt-4 rounded-xl border border-line bg-paper/35 p-4"><p className="text-xs font-semibold uppercase tracking-[.12em] text-violet">Fictional source</p><h3 className="mt-1 font-semibold text-ink">River County Community Foundation award</h3><p className="mt-1 text-sm text-ink/65">Sample deadline: February 18 · Status is family-reported, not verified by Campus Passage.</p><label className="mt-4 flex cursor-pointer items-center gap-3 text-sm font-medium text-ink"><input type="checkbox" checked={trackedScholarship} onChange={() => setTrackedScholarship(!trackedScholarship)} className="h-5 w-5 accent-accent" /> Family reports this opportunity as {trackedScholarship ? "tracked" : "not yet tracked"}</label></article>
        <p className="mt-4 rounded-xl bg-violetPale/60 p-3 text-sm leading-6 text-ink/75"><strong>No qualification assessment.</strong> This concept can surface an awareness item and record what a family reports; it never says a student qualifies, will be selected, or will receive funding.</p>
      </Section>
      <Section eyebrow="Reminders · simulated preferences" title="Channels are visible; delivery is off">
        <p className="mt-3 text-sm text-ink/65">These controls model a preference screen only. This private lab sends no email, text, notification, or external request.</p>
        <div className="mt-4 space-y-3"><label className="flex items-center justify-between rounded-xl border border-line bg-paper/35 p-4"><span><span className="block font-semibold text-ink">Email</span><span className="block text-xs text-ink/55">Included in this preference demonstration · delivery disabled</span></span><input type="checkbox" checked={emailEnabled} onChange={() => setEmailEnabled(!emailEnabled)} className="h-5 w-5 accent-accent" /></label><label className="flex items-center justify-between rounded-xl border border-line bg-paper/35 p-4"><span><span className="block font-semibold text-ink">SMS · planned</span><span className="block text-xs text-ink/55">Opt-in can be previewed; actual sending is disabled</span></span><input type="checkbox" checked={smsOptIn} onChange={() => setSmsOptIn(!smsOptIn)} className="h-5 w-5 accent-accent" /></label></div>
        <p className="mt-3 text-xs text-ink/50">Preview state: email {emailEnabled ? "selected" : "not selected"}; SMS {smsOptIn ? "opt-in selected" : "not selected"}. No delivery queue is created.</p>
      </Section>
    </div>

    <div className="grid gap-6 lg:grid-cols-2">
      <Section eyebrow="Campus Passage Guide · review concept" title="Answers grounded in fixed demo facts">
        <p className="mt-3 text-sm text-ink/65">This simulation searches only the fictional facts listed below. It does not browse, infer facts, or give an answer when the evidence is absent.</p>
        <form onSubmit={askGuide} className="mt-4 flex gap-2"><label className="sr-only" htmlFor="review-guide-question">Ask a fictional fact question</label><input id="review-guide-question" value={question} onChange={(event) => setQuestion(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink" placeholder="Ask about aid, parking, housing, or billing" /><button className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white">Ask Guide</button></form>
        <div className="mt-3 flex flex-wrap gap-2">{["When does the aid offer open?", "What is the parking window?", "When is billing due?", "Will I get a scholarship?"].map((prompt) => <button key={prompt} type="button" onClick={() => { setQuestion(prompt); setGuide(answerReviewGuide(prompt)); }} className="rounded-full border border-line px-3 py-1 text-xs text-ink/70 hover:bg-paperDeep/40">{prompt}</button>)}</div>
        <article aria-live="polite" className={`mt-4 rounded-xl p-4 text-sm leading-6 ${guide.refused ? "border border-gold/40 bg-goldPale/60" : "border border-accent/25 bg-sky/35"}`}><p className="font-semibold text-ink">{guide.refused ? "Honest limitation" : "Fixed-fact response"}</p><p className="mt-1 text-ink/75">{guide.answer}</p>{guide.sources.length > 0 && <><p className="mt-3 text-xs font-semibold uppercase tracking-[.12em] text-ink/50">Fictional sources used</p><ul className="mt-1 list-disc pl-5 text-xs text-ink/60">{guide.sources.map((source) => <li key={source}>{source}</li>)}</ul></>}</article>
        <details className="mt-4 text-xs text-ink/55"><summary className="cursor-pointer font-semibold">Fixed facts available to this simulation</summary><ul className="mt-2 list-disc pl-5">{guideFacts.map((fact) => <li key={fact.topic}>{fact.sources.join("; ")}</li>)}</ul></details>
      </Section>
      <Section eyebrow="Page Assist · review simulation" title="Read and explain only, after explicit activation">
        <p className="mt-3 text-sm text-ink/65">No live webpage is connected. Activating this simulation exposes a fixed fictional excerpt for read/explain behavior only.</p>
        <div className={`mt-4 rounded-xl border p-4 ${assistActive ? "border-accent bg-sky/35" : "border-line bg-paper/35"}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold text-ink">Status: {assistActive ? "ACTIVE · read / explain only" : "Inactive"}</p><p className="text-xs text-ink/55">{assistActive ? "Clear mode indicator: no form completion, clicking, submission, or sending." : "Explicit activation is required before any simulated excerpt appears."}</p></div><button type="button" onClick={() => setAssistActive(!assistActive)} className={`rounded-xl px-4 py-2 text-sm font-semibold ${assistActive ? "border border-line bg-white text-ink" : "bg-accent text-white"}`}>{assistActive ? "Deactivate" : "Activate Page Assist"}</button></div>{assistActive && <blockquote className="mt-4 border-l-4 border-accent pl-3 text-sm italic leading-6 text-ink/75">“Fictional billing statement: publication date has not been announced.”<footer className="mt-2 not-italic text-xs text-ink/55">Explanation: retain this as an unknown rather than estimating a date.</footer></blockquote>}</div>
        <div className="mt-4 rounded-xl border border-dashed border-line bg-paper/30 p-4"><p className="font-semibold text-ink">Draft suggestions — built, disabled</p><p className="mt-1 text-sm text-ink/60">A future draft helper is intentionally unavailable in this lab. It cannot write into, submit, or alter anything.</p><button type="button" disabled className="mt-3 cursor-not-allowed rounded-xl bg-ink/20 px-4 py-2 text-sm font-semibold text-ink/45">Draft a suggestion (disabled)</button></div>
        <p className="mt-3 text-xs text-ink/50">Mode value for review: {pageAssistMode(assistActive)}.</p>
      </Section>
    </div>

    <footer className="flex flex-col gap-3 border-t border-line pt-5 text-sm text-ink/60 sm:flex-row sm:items-center sm:justify-between"><p>Internal owner review only · no production records or customer-facing claims are changed.</p><Link href="/request-access" className="font-semibold text-accent underline">Request Access</Link></footer>
  </main>;
}
