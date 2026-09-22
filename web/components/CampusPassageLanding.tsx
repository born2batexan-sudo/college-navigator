"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  actionsFor,
  demoStudents,
  hiddenWorkFor,
  horizonFor,
  studentById,
  summarizeSelection,
  type DemoActionRow,
  type DemoSelection,
  type DemoTone,
} from "@/lib/landing-demo";

type View = "public" | "dashboard";
type BadgeTone = "live" | "preview" | "coming";

const TONE_META: Record<DemoTone, { marker: string; due: string; label: string }> = {
  action: { marker: "", due: "", label: "Family action" },
  waiting: { marker: "waiting", due: "wait", label: "Waiting on school" },
  complete: { marker: "done", due: "complete", label: "Complete" },
  aware: { marker: "aware", due: "aware", label: "Awareness notice" },
};

/**
 * Badge is the one visual vocabulary for what a family can rely on today. It
 * replaces scattered "Planned:" hedge words in prose with a single, scannable
 * mark: Live (interactive here, in the real product), Preview (an
 * interactive, clearly fictional illustration of a roadmap capability), or
 * Coming (named and described, not shown or interactive anywhere yet).
 */
function Badge({ tone, children }: { tone: BadgeTone; children?: React.ReactNode }) {
  const label = tone === "live" ? "Live" : tone === "preview" ? "Preview" : "Coming";
  return (
    <span className={`badge badge-${tone}`}>
      <span className="badge-dot" aria-hidden="true" />
      {label}
      {children ? <span className="badge-detail">{children}</span> : null}
    </span>
  );
}

const journeyStages: { phase: string; title: string; text: string; tone: BadgeTone }[] = [
  { phase: "Before you apply", title: "Research, terms, and timelines", text: "Plain-language explanations and published timelines, always linking back to each school's own admissions pages.", tone: "coming" },
  { phase: "While applying", title: "One list, every school", text: "Public information worth noticing across the whole list a household is watching, organized by school and term.", tone: "coming" },
  { phase: "After you submit", title: "What came next, and what is a wait", text: "The moment illustrated below: a family action, a school update, an honest unknown, and a completion — told apart in plain language.", tone: "live" },
  { phase: "Aid & scholarships", title: "Reviewed, source-linked opportunities", text: "Sponsor, link, and status for a credible opportunity, with a question list for the household — never an eligibility claim.", tone: "preview" },
  { phase: "Decision, billing & 529", title: "What to understand before you commit", text: "Published deposit, orientation, housing, and billing prompts in one place, pointed back to the school and plan administrator.", tone: "preview" },
  { phase: "Persistence & career", title: "What the school or employer publishes", text: "Institution- and employer-provided opportunities worth noticing — never a replacement for the school's own career center.", tone: "coming" },
];

const moneyCards: { title: string; tone: BadgeTone; text: string }[] = [
  { title: "Financial aid & scholarship awareness", tone: "preview", text: "A reviewed, source-linked aid or scholarship opportunity, shown with sponsor, link, and status, plus a question list for the household. Campus Passage never states or predicts that a student qualifies or will be selected — the sponsor and school alone decide eligibility and awards." },
  { title: "Billing & 529 awareness", tone: "preview", text: "See what a bill or education-savings question is really asking before money moves, with a direct path to the bursar's office, the 529 plan administrator, or IRS guidance. Campus Passage does not process a payment, a withdrawal, or a determination of qualified expenses." },
  { title: "Household Horizon", tone: "live", text: "A calm view of upcoming school announcements and milestones, shown only once an official public source has published a date or window — illustrated below with two applicants in the same admissions cycle, each on a different pathway." },
  { title: "Every student, every desired school", tone: "live", text: "Switch cleanly between every student in a household, each with a separate plan, source list, and pace — with no student's urgency becoming another's notification burden. This fixed illustration uses Priya and Mateo; a qualifying household may include two or more students." },
];

function StudentDot({ color }: { color: "coral" | "teal" }) {
  return <span className={`student-dot student-dot-${color}`} aria-hidden="true" />;
}

/** Selector shared by the early product-proof widget and the full family-plan tab. */
function SelectionTabs({ selection, onSelect, idPrefix }: { selection: DemoSelection; onSelect: (next: DemoSelection) => void; idPrefix: string }) {
  return (
    <div className="selection-tabs" role="tablist" aria-label="Choose a household view">
      <button type="button" role="tab" aria-selected={selection === "household"} id={`${idPrefix}-household`} className={selection === "household" ? "is-selected" : ""} onClick={() => onSelect("household")}>
        Whole household
      </button>
      {demoStudents.map((student) => (
        <button key={student.id} type="button" role="tab" aria-selected={selection === student.id} id={`${idPrefix}-${student.id}`} className={selection === student.id ? "is-selected" : ""} onClick={() => onSelect(student.id)}>
          <StudentDot color={student.color} />
          {student.name.split(" ")[0]}&apos;s plan
        </button>
      ))}
    </div>
  );
}

function ActionRow({ row, onInspect }: { row: DemoActionRow; onInspect?: (source: string) => void }) {
  const student = studentById(row.student);
  return (
    <article className={`demo-row tone-${row.tone}`}>
      <span className={`demo-marker ${TONE_META[row.tone].marker}`} aria-hidden="true" />
      <div className="demo-row-who">
        <StudentDot color={student.color} />
        <span>{student.name.split(" ")[0]}</span>
        <span className="demo-row-school">{row.school}</span>
      </div>
      <div className="demo-row-body">
        <p className="demo-row-kind">{row.kind}</p>
        <strong>{row.title}</strong>
        <span>{row.detail}</span>
      </div>
      <div className={`demo-row-status status-${row.tone}`}>{row.status}</div>
      {onInspect && (
        <button type="button" className="demo-source-button" onClick={() => onInspect(row.source)}>
          Source context
        </button>
      )}
    </article>
  );
}

/** The early, above-the-fold interactive proof: a fixed two-applicant illustration, filtered and explained. */
function HouseholdHorizonProof() {
  const [selection, setSelection] = useState<DemoSelection>("household");
  const [sourceContext, setSourceContext] = useState<string | null>(null);
  const rows = useMemo(() => actionsFor(selection), [selection]);
  const horizon = useMemo(() => horizonFor(selection), [selection]);
  const hidden = useMemo(() => hiddenWorkFor(selection === "household" ? "priya" : selection), [selection]);
  const counts = useMemo(() => summarizeSelection(selection), [selection]);

  return (
    <div className="proof-widget" aria-label="Interactive household Horizon demonstration">
      <div className="proof-widget-head">
        <div>
          <p className="proof-eyebrow">Try it — a fictional two-applicant illustration</p>
          <h2>The Alvarez household: two applicants, different pathways, one view.</h2>
        </div>
        <SelectionTabs selection={selection} onSelect={setSelection} idPrefix="proof" />
      </div>
      <p className="proof-summary">
        <strong>{counts.dueThisWeek} need{counts.dueThisWeek === 1 ? "s" : ""} the household this week.</strong>
        <span>{counts.waiting} waiting on a school.</span>
        <span>{counts.complete} complete.</span>
        <span>{counts.awareness} awareness notice{counts.awareness === 1 ? "" : "s"}.</span>
      </p>
      <div className="proof-grid">
        <div className="proof-queue">
          {rows.map((row) => (
            <ActionRow key={`${row.student}-${row.school}-${row.title}`} row={row} onInspect={setSourceContext} />
          ))}
        </div>
        <aside className="proof-rail">
          <h3>Horizon: what&apos;s ahead</h3>
          <ul className="horizon-list">
            {horizon.map((event) => (
              <li key={`${event.student}-${event.label}`}>
                <span className={`horizon-state state-${event.state === "Not yet published" ? "unknown" : "known"}`}>{event.state}</span>
                <strong>{event.label}</strong>
                <span className="horizon-date">{event.date ?? "Not yet published"}</span>
                <p>{event.note}</p>
              </li>
            ))}
          </ul>
          <div className="proof-context" aria-live="polite">
            <p className="proof-context-label">Source context</p>
            <p>{sourceContext ?? "Select \u201cSource context\u201d beside any item to see exactly where it came from."}</p>
          </div>
          {hidden.length > 0 && (
            <details className="proof-hidden">
              <summary>{hidden.length} item{hidden.length === 1 ? "" : "s"} intentionally hidden — show why</summary>
              <ul>
                {hidden.map((item) => (
                  <li key={item.title}><strong>{item.title}:</strong> {item.hideReason}</li>
                ))}
              </ul>
            </details>
          )}
        </aside>
      </div>
      <p className="proof-caption">
        Illustrative demonstration with fictional Class of 2027 applicants, schools, and dates. No real household, school, or portal data is shown or connected.
      </p>
    </div>
  );
}

const trustNotes = [
  ["Source", "Official source, one tap away", "Every item can point the family back to the school's, sponsor's, or vendor's own instructions. Campus Passage organizes; the original source stays the authority."],
  ["Term", "The right term, every time", "An item always carries its applicable student, school, and term, so a family never mistakes a prior or different-cycle detail for their current plan."],
  ["Unknown", "An honest unknown, shown plainly", "\u201cDate not posted yet\u201d is an intentional state, not an invented deadline or a promise of continuous monitoring."],
] as const;

export default function CampusPassageLanding() {
  const [view, setView] = useState<View>("public");
  const [planSelection, setPlanSelection] = useState<DemoSelection>("household");
  const [planSourceContext, setPlanSourceContext] = useState<string | null>(null);
  const publicMain = useRef<HTMLElement>(null);
  const dashboardMain = useRef<HTMLElement>(null);

  useEffect(() => {
    const target = view === "public" ? publicMain.current : dashboardMain.current;
    target?.focus({ preventScroll: true });
  }, [view]);

  function switchView(next: View) {
    setView(next);
    if (next === "dashboard") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const planRows = useMemo(() => actionsFor(planSelection), [planSelection]);
  const planHorizon = useMemo(() => horizonFor(planSelection), [planSelection]);
  const planHidden = useMemo(() => hiddenWorkFor(planSelection === "household" ? "mateo" : planSelection), [planSelection]);
  const planCounts = useMemo(() => summarizeSelection(planSelection), [planSelection]);

  return (
    <div className="campus-page" data-view={view}>
      <a className="skip-link" href="#main">Skip to main content</a>
      <header className="site-header">
        <div className="utility-bar">Public concept preview · access requests are for a read-only demonstration, not enrollment in a live service.</div>
        <div className="site-shell topbar">
          <Link className="brand" href="#top" aria-label="Campus Passage home"><span className="brand-mark" aria-hidden="true">◇</span>Campus Passage</Link>
          <div className="view-switch" role="tablist" aria-label="Concept view">
            <button id="public-tab" type="button" role="tab" aria-selected={view === "public"} aria-controls="public-view" onClick={() => switchView("public")}>Public story</button>
            <button id="dashboard-tab" type="button" role="tab" aria-selected={view === "dashboard"} aria-controls="dashboard-view" onClick={() => switchView("dashboard")}>Family plan</button>
          </div>
          <nav className="navlinks" aria-label="Primary navigation">
            <a href="#journey">Journey</a>
            <a href="#money">Aid &amp; Horizon</a>
            <a href="#trust">Trust</a>
            <Link href="/login?next=%2Fdashboard" className="login-link">Log in</Link>
            <Link href="/request-access" className="nav-cta">Request access</Link>
          </nav>
        </div>
      </header>

      {view === "public" ? (
        <div id="public-view" role="tabpanel" aria-labelledby="public-tab">
          <main id="main" ref={publicMain} tabIndex={-1}>
            <section id="top" className="site-shell hero" aria-labelledby="hero-title">
              <div className="hero-copy">
                <p className="eyebrow">For households following more than one college journey</p>
                <h1 id="hero-title" className="display hero-title">Two kids. Two timelines. <em>One clear plan.</em></h1>
                <p className="lede">College information arrives scattered across schools, vendors, sponsors, and inboxes — and a different set of it matters for each of your kids. Campus Passage reads official public college and vendor sources, filters out what doesn&apos;t apply, and organizes what matters for every student and every school your household is watching. Official school and sponsor instructions always stay in control.</p>
                <div className="actions"><Link className="button button-primary" href="/request-access">Request private-preview access</Link><a className="button button-secondary" href="#proof">See two applicants, one household</a></div>
                <p className="hero-proof"><span>No school-portal passwords</span><span>Official-source context</span><span>Term-specific, student-specific</span></p>
              </div>
              <aside className="signal-card" aria-label="The household problem">
                <p className="signal-card-label">A household note</p>
                <blockquote>&ldquo;There&apos;s financial aid in one inbox, a scholarship deadline in another, and my younger one is starting to look at schools too — with none of it in the same place.&rdquo;</blockquote>
                <p>An illustrative household note, not a customer quote.</p>
              </aside>
            </section>

            <hr className="rule site-shell" />

            <section id="proof" className="story-section site-shell" aria-labelledby="proof-title">
              <h2 id="proof-title" className="sr-only">Interactive household demonstration</h2>
              <HouseholdHorizonProof />
            </section>

            <section id="money" className="story-section site-shell money-section" aria-labelledby="money-title">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Beyond the checklist</p>
                  <h2 id="money-title" className="display">The stakes are money and timing, not only dates.</h2>
                </div>
                <p>Aid decisions, scholarship windows, billing questions, and 529 timing carry real consequences, and every school and sponsor announces them on its own public page. Each card below names plainly what is live today, what you can already try as an interactive preview, and what is described for later.</p>
              </div>
              <div className="money-grid">
                {moneyCards.map((card) => (
                  <article className="money-card" key={card.title}>
                    <Badge tone={card.tone} />
                    <h3>{card.title}</h3>
                    <p>{card.text}</p>
                  </article>
                ))}
              </div>
            </section>

            <section id="journey" className="story-section site-shell" aria-labelledby="journey-title">
              <div className="section-head">
                <div>
                  <p className="eyebrow">The whole passage</p>
                  <h2 id="journey-title" className="display">One shared plan, from the first campus visit to the first year of college.</h2>
                </div>
                <p>Campus Passage is designed around the full arc of a college decision, not one launch. Each stage below names itself plainly; only the after-submission moment is interactive in this preview today.</p>
              </div>
              <ol className="journey-grid">
                {journeyStages.map((stage) => (
                  <li className="journey-stage" key={stage.phase}>
                    <Badge tone={stage.tone} />
                    <p className="journey-phase">{stage.phase}</p>
                    <strong>{stage.title}</strong>
                    <p>{stage.text}</p>
                  </li>
                ))}
              </ol>
            </section>

            <section className="story-section site-shell" aria-labelledby="status-title">
              <div className="status-layout">
                <div>
                  <p className="eyebrow">Status has a grammar</p>
                  <h2 id="status-title" className="display">&ldquo;We sent it&rdquo; is not always the end of the story.</h2>
                  <p>Campus Passage makes the difference between the household&apos;s own action and the school&apos;s recognized status legible. It does not replace a school&apos;s instructions or decide what a school will accept.</p>
                </div>
                <div className="progression-card">
                  <p className="progression-label">Illustrative status progression</p>
                  <div className="progression" aria-label="Submitted then Received then Complete">
                    <div className="progression-stage"><span className="progression-number">01</span><strong>Submitted</strong><small>The family has taken the action.</small></div>
                    <div className="progression-arrow" aria-hidden="true">→</div>
                    <div className="progression-stage is-active"><span className="progression-number">02</span><strong>Received</strong><small>The school shows it has received the item.</small></div>
                    <div className="progression-arrow" aria-hidden="true">→</div>
                    <div className="progression-stage"><span className="progression-number">03</span><strong>Complete</strong><small>The applicable record is ready on the school&apos;s terms.</small></div>
                  </div>
                  <div className="progression-key"><span><b>Submitted</b> = family action</span><span><b>Received</b> = school-side acknowledgment</span><span><b>Complete</b> = current status shown</span></div>
                </div>
              </div>
            </section>

            <section className="site-shell outcomes" aria-label="What one plan changes">
              <article className="outcome"><span className="count">01</span><h3>See the next meaningful step</h3><p>Prioritize what calls for the household&apos;s attention without making every school update feel equally urgent.</p></article>
              <article className="outcome"><span className="count">02</span><h3>Know whose turn it is</h3><p>Make the difference between a family action and a school-side wait visible in plain language.</p></article>
              <article className="outcome"><span className="count">03</span><h3>Give each student their own pace</h3><p>Applicants in the same admissions cycle can share a household plan while keeping their own schools, priorities, and sense of urgency.</p></article>
              <article className="outcome"><span className="count">04</span><h3>Ask, in plain language</h3><p><Badge tone="coming" /></p><p>Ask Campus Passage will explain an unfamiliar term, help prepare a question, and point back to the controlling official source. It will not decide, certify, or give legal, tax, financial-aid, or admissions advice.</p></article>
            </section>

            <section id="trust" className="story-section site-shell" aria-labelledby="trust-title">
              <div className="section-head"><div><p className="eyebrow">Trust lives beside the item</p><h2 id="trust-title" className="display">Clear context, including when the answer is not yet known.</h2></div><p>Every trust cue below is expressed in plain text with a distinct mark, so provenance never becomes a vague footer claim.</p></div>
              <div className="trust-grid">{trustNotes.map(([symbol, title, text]) => <article className="trust-note" key={title}><div className="symbol" aria-hidden="true">{symbol}</div><h3>{title}</h3><p>{text}</p></article>)}</div>
              <div className="standard-callout" aria-label="The 12² Standard">
                <p className="eyebrow">The 12² Standard</p>
                <p className="callout-line">144 checks. Every college. Every applicable term.</p>
                <p className="caption">Named here as the review discipline behind an expert-inspected plan — not a published checklist or method.</p>
              </div>
              <div className="roadmap-disclosure"><strong>Household Horizon and multi-student switching are interactive in this preview with fictional data. Ask Campus Passage, Page Assist, and email/SMS reminders are Coming — named and described, not shown or interactive anywhere in this preview today.</strong></div>
            </section>

            <section className="story-section site-shell" aria-labelledby="reminders-title">
              <div className="reminders">
                <div><p className="eyebrow">Calm reminders, in the right channel</p><h2 id="reminders-title" className="display">Let the plan surface what matters without taking over the household.</h2><p>The plan itself is what&apos;s interactive today. Email and SMS reminders are named plainly as coming, not an assumed or currently delivered channel.</p></div>
                <div className="reminder-map" aria-label="Reminder channel concept">
                  <div className="reminder-row"><Badge tone="live" /><p><strong>One decisive item, in-app</strong><br /><span>Show the next step where the household is already reviewing the plan — interactive above.</span></p></div>
                  <div className="reminder-row"><Badge tone="coming" /><p><strong>A concise plan reminder by email</strong><br /><span>Context and a direct route back to the shared plan, not a stream of alerts. Not verified as operational today.</span></p></div>
                  <div className="reminder-row"><Badge tone="coming" /><p><strong>SMS, only with explicit opt-in</strong><br /><span>Reserved for a future setting with clear consent and meaningful control — never an assumed channel.</span></p></div>
                </div>
              </div>
              <div className="future-stack">
                <aside className="future-panel"><Badge tone="coming" /><p className="eyebrow future-eyebrow">Privacy-first email validation</p><h3>Validate a message without opening a family inbox.</h3><p>A future paid, optional service could let a family submit a specific message for validation against their plan. It is not a live purchase or payment offer.</p><ul className="future-list"><li>No inbox connection or school-portal credential</li><li>Family chooses the individual message they want checked</li><li>Clear scope and consent before any validation request</li></ul></aside>
                <aside className="future-panel"><Badge tone="coming" /><p className="eyebrow future-eyebrow">Page Assist: read-and-explain, not do-it-for-you</p><h3>Understand a page without leaving the plan.</h3><p>Page Assist will help a person understand an explicitly supported public page, in plain language, and link back to the shared plan. It is user-initiated, on a narrow allow-list of compatible pages, and stays a premium capability.</p><ul className="future-list"><li>Read-and-explain only — never fills a form or submits anything</li><li>No sign-in, portal, or payment page is ever supported</li><li>Off by default, on only where a person turns it on that session</li></ul></aside>
              </div>
            </section>

            <section className="site-shell closing" aria-labelledby="closing-title"><p className="eyebrow">Private preview</p><h2 id="closing-title" className="display">A calmer way to carry the whole passage, not just one moment.</h2><p>Explore a read-only example of how a shared household plan can make college steps easier to understand — from official-source awareness to a clear next move. Access requests are reviewed; no availability or response-time promise is implied here.</p><div className="actions actions-centered"><Link className="button button-primary" href="/request-access">Request private-preview access</Link><button className="button button-secondary" type="button" onClick={() => switchView("dashboard")}>Open family plan concept</button></div></section>
          </main>
          <footer className="site-footer"><div className="site-shell footer-inner"><span>© 2026 Campus Passage concept preview</span><span>Examples are illustrative · Not affiliated with or endorsed by schools</span></div></footer>
        </div>
      ) : (
        <div id="dashboard-view" role="tabpanel" aria-labelledby="dashboard-tab">
          <main id="dashboard-main" ref={dashboardMain} className="site-shell dashboard" tabIndex={-1}>
            <div className="dashboard-lede">
              <div><p className="eyebrow">Campus Passage · family plan concept</p><h1>The Alvarez household</h1><p>Two applicants, one admissions cycle, one household · Priya and Mateo (Class of 2027 · Fall 2027)</p></div>
              <span className="read-only">Illustrative · read-only</span>
            </div>
            <SelectionTabs selection={planSelection} onSelect={setPlanSelection} idPrefix="plan" />
            <div className="dash-summary">
              <strong>{planCounts.dueThisWeek} need{planCounts.dueThisWeek === 1 ? "s" : ""} the household this week · {planCounts.waiting} waiting on a school · {planCounts.awareness} awareness notice{planCounts.awareness === 1 ? "" : "s"}.</strong>
              <span>{planSelection === "household" ? "Priya's and Mateo's different priorities and pathways stay legible side by side within the same Class of 2027 / Fall 2027 cycle." : `Viewing ${studentById(planSelection).name}'s plan only. ${studentById(planSelection).stage} · admissions cycle ${studentById(planSelection).term}.`}</span>
            </div>
            <div className="dash-grid">
              <section aria-labelledby="queue-title">
                <div className="dash-heading"><h2 id="queue-title">Household action queue</h2><span>{planRows.length} illustrative item{planRows.length === 1 ? "" : "s"}</span></div>
                {planRows.map((row) => (
                  <ActionRow key={`${row.student}-${row.school}-${row.title}`} row={row} onInspect={setPlanSourceContext} />
                ))}
              </section>
              <aside className="rail" aria-labelledby="school-title">
                <h2 id="school-title">Horizon &amp; school view</h2>
                <ul className="horizon-list">
                  {planHorizon.map((event) => (
                    <li key={`${event.student}-${event.label}`}>
                      <span className={`horizon-state state-${event.state === "Not yet published" ? "unknown" : "known"}`}>{event.state}</span>
                      <strong>{event.label}</strong>
                      <span className="horizon-date">{event.date ?? "Not yet published"}</span>
                    </li>
                  ))}
                </ul>
                {planHidden.length > 0 && (
                  <details className="proof-hidden">
                    <summary>{planHidden.length} item{planHidden.length === 1 ? "" : "s"} intentionally hidden — show why</summary>
                    <ul>{planHidden.map((item) => <li key={item.title}><strong>{item.title}:</strong> {item.hideReason}</li>)}</ul>
                  </details>
                )}
                <div className="dash-source" aria-live="polite"><strong>Source context</strong><p>{planSourceContext ?? "Select \u201cSource context\u201d beside an item to inspect its illustrative provenance label."}</p></div>
              </aside>
            </div>
            <p className="caption dashboard-transcript">Family plan transcript: this fixed illustration shows two qualifying applicants with independently switchable plans, a combined household view, and per-item source context. The household model supports two or more students under a purchaser&apos;s genuine caregiving responsibility when they share the same high-school graduation year and admissions cycle. Examples are illustrative and do not represent live school, sponsor, or financial information.</p>
          </main>
        </div>
      )}
    </div>
  );
}
