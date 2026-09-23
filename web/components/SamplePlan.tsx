"use client";

import Link from "next/link";
import { useState } from "react";
import MarketingHeader from "@/components/MarketingHeader";
import { actionsFor, demoStudents, hiddenWorkFor, horizonFor, studentById, summarizeSelection, type DemoActionRow, type DemoSelection } from "@/lib/landing-demo";

type Pathway = "single" | "multiple";

function StudentDot({ color }: { color: "coral" | "teal" }) {
  return <span className={`student-dot student-dot-${color}`} aria-hidden="true" />;
}

function SampleItem({ row }: { row: DemoActionRow }) {
  const student = studentById(row.student);
  const whoseMove = row.tone === "action" ? "Family action" : row.tone === "waiting" ? "Waiting on school" : row.tone === "aware" ? "Family may review; sponsor decides" : "School status shown";
  return (
    <article className={`sample-item tone-${row.tone}`}>
      <div className="sample-item-top"><span><StudentDot color={student.color} /> {student.name.split(" ")[0]} · {row.school}</span><span className={`sample-state status-${row.tone}`}>{row.status}</span></div>
      <h3>{row.title}</h3>
      <p>{row.detail}</p>
      <details className="sample-anatomy"><summary>See item context</summary>
        <dl>
          <div><dt>What it is</dt><dd>{row.kind}: {row.title}</dd></div>
          <div><dt>Student, school, term</dt><dd>{student.name} · {row.school} · {student.term}</dd></div>
          <div><dt>Whose move</dt><dd>{whoseMove}</dd></div>
          <div><dt>By when</dt><dd>{row.status}</dd></div>
          <div><dt>What&apos;s at stake</dt><dd>{row.stake}</dd></div>
          <div><dt>Official source</dt><dd>{row.source}. Illustrative label only; no actual school page is connected.</dd></div>
          <div><dt>Freshness</dt><dd>Fictional sample. No live source checked or review date claimed.</dd></div>
        </dl>
      </details>
    </article>
  );
}

export default function SamplePlan() {
  const [pathway, setPathway] = useState<Pathway>("single");
  const [selection, setSelection] = useState<DemoSelection>("household");
  const active: DemoSelection = pathway === "single" ? "priya" : selection;
  const rows = actionsFor(active);
  const horizon = horizonFor(active);
  const hidden = hiddenWorkFor(active);
  const counts = summarizeSelection(active);
  return (
    <div className="campus-page">
      <a className="skip-link" href="#main">Skip to main content</a>
      <MarketingHeader current="sample" />
      <main id="main" className="sample-page site-shell">
        <Link className="sample-back" href="/">← Overview</Link>
        <div className="sample-heading"><div><p className="eyebrow">Fictional, read-only example</p><h1 className="display">See how a meaningful next step comes into focus.</h1><p>Explore the same kind of clarity for one student or for students sharing an admissions cycle. Nothing here reads a school portal, a live source, or a real household record.</p></div><span className="read-only">Illustrative · read-only</span></div>
        <div className="pathway-selector" aria-label="Choose a pathway">
          <button type="button" aria-pressed={pathway === "single"} onClick={() => setPathway("single")}>Single Student</button>
          <button type="button" aria-pressed={pathway === "multiple"} onClick={() => setPathway("multiple")}>Multiple Students</button>
        </div>
        <section className="sample-intro" aria-live="polite">
          {pathway === "single" ? <><h2>Priya&apos;s own next steps</h2><p>One student still has different schools, dates, responsibilities, and unknowns to keep straight. Priya is a fictional Class of 2027 applicant planning for Fall 2027.</p></> : <><h2>Different paths, the same admissions cycle</h2><p>Priya compares admissions and aid timing; Mateo explores campus visits and accessibility contacts. Both fictional students graduate in 2027 and plan for Fall 2027. A qualifying household can include <strong>two or more students</strong> under a purchaser&apos;s <strong>genuine caregiving responsibility</strong> when they share the <strong>same high-school graduation year and admissions cycle</strong>. This two-student illustration is not a limit.</p></>}
        </section>
        {pathway === "multiple" && <nav className="selection-tabs sample-filter" aria-label="Choose students to view">
          <button type="button" aria-pressed={selection === "household"} className={selection === "household" ? "is-selected" : ""} onClick={() => setSelection("household")}>Both students</button>
          {demoStudents.map((student) => <button type="button" key={student.id} aria-pressed={selection === student.id} className={selection === student.id ? "is-selected" : ""} onClick={() => setSelection(student.id)}><StudentDot color={student.color} />{student.name.split(" ")[0]}</button>)}
        </nav>}
        <p className="sample-count" aria-live="polite"><strong>{counts.dueThisWeek} family action{counts.dueThisWeek === 1 ? "" : "s"}</strong> · {counts.waiting} school-side wait{counts.waiting === 1 ? "" : "s"} · {counts.complete} complete · {counts.awareness} awareness notice{counts.awareness === 1 ? "" : "s"}</p>
        <div className="sample-grid">
          <section aria-labelledby="items-title"><h2 id="items-title">What needs attention</h2><div className="sample-items">{rows.map((row) => <SampleItem key={`${row.student}-${row.school}-${row.title}`} row={row} />)}</div></section>
          <aside className="sample-rail" aria-labelledby="ahead-title"><h2 id="ahead-title">What&apos;s ahead</h2><ul className="horizon-list">{horizon.map((event) => <li key={`${event.student}-${event.label}`}><span className={`horizon-state state-${event.state === "Not yet published" ? "unknown" : "known"}`}>{event.state}</span><strong>{event.label}</strong><span className="horizon-date">{event.date ?? "Not yet published"}</span><p>{event.note}</p></li>)}</ul>
            {hidden.length > 0 && <details className="proof-hidden"><summary>{hidden.length} less-relevant item{hidden.length === 1 ? "" : "s"} set aside</summary><ul>{hidden.map((item) => <li key={`${item.student}-${item.title}`}><strong>{item.title}:</strong> {item.hideReason}</li>)}</ul></details>}
          </aside>
        </div>
        <p className="sample-disclaimer">Every student, school, date, policy, and source label on this page is fictional. The source and freshness fields show how context would be presented, not a claim that any page was checked. Confirm actual steps with the school or sponsor.</p>
        <div className="sample-next"><h2>Want to understand the approach?</h2><div className="actions"><Link className="button button-secondary" href="/">Read the overview</Link><Link className="button button-primary" href="/request-access">Request access</Link></div></div>
      </main>
      <footer className="site-footer"><div className="site-shell footer-inner"><span>© 2026 Campus Passage concept</span><span>Illustrative examples · Not affiliated with or endorsed by schools</span></div></footer>
    </div>
  );
}
