"use client";

import Link from "next/link";
import { useState } from "react";
import MarketingHeader from "@/components/MarketingHeader";
import { demoStudents, studentById, type DemoSelection, type DemoStudentId } from "@/lib/landing-demo";
import { initialIntake, personalizedPlan, updateStudentAnswer, type IntakeAnswers, type LivingPlan, type PlanItem, type TransportPlan } from "@/lib/sample-intake";

type Pathway = "single" | "multiple";

function StudentDot({ color }: { color: "coral" | "teal" }) {
  return <span className={`student-dot student-dot-${color}`} aria-hidden="true" />;
}

const livingChoices: { value: LivingPlan; label: string }[] = [
  { value: "campus", label: "Live on campus" }, { value: "offCampus", label: "Off-campus housing" },
  { value: "commute", label: "Commute" }, { value: "undecided", label: "Not sure yet" },
];
const transportChoices: { value: TransportPlan; label: string }[] = [
  { value: "car", label: "Bring a car" }, { value: "other", label: "Transit or another way" }, { value: "undecided", label: "Not sure yet" },
];
const fundingChoices: { key: "aid" | "schoolScholarships" | "outsideScholarships" | "educationSavings"; label: string }[] = [
  { key: "aid", label: "Financial aid" }, { key: "schoolScholarships", label: "School scholarships" },
  { key: "outsideScholarships", label: "Community or other outside scholarships" }, { key: "educationSavings", label: "529 or prepaid plan" },
];
const campusChoices: { key: "access" | "studentLife" | "visits" | "orientation" | "familyMoveIn"; label: string }[] = [
  { key: "access", label: "Access or accommodations" }, { key: "studentLife", label: "Greek or other student life" },
  { key: "visits", label: "Campus visits" }, { key: "orientation", label: "Orientation" },
  { key: "familyMoveIn", label: "Family access or move-in" },
];

function SampleItem({ row }: { row: PlanItem }) {
  const student = studentById(row.student);
  const whoseMove = row.tone === "action" ? "Family action" : row.tone === "waiting" ? "Waiting on school" : row.tone === "aware" ? "Family may review; official source governs next step" : "School status shown";
  return (
    <article className={`sample-item tone-${row.tone}${row.exception ? " sample-exception" : ""}`}>
      <div className="sample-item-top"><span><StudentDot color={student.color} /> {student.name.split(" ")[0]} · {row.school}</span><span className={`sample-state status-${row.tone}`}>{row.status}</span></div>
      <h3>{row.title}</h3>
      <p>{row.detail}</p>
      <p className="sample-why"><strong>{row.exception ? "School rule takes priority: " : "Why this appears: "}</strong>{row.whyShown}</p>
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
  const [editingStudent, setEditingStudent] = useState<DemoStudentId>("priya");
  const [intake, setIntake] = useState(initialIntake);
  const active: DemoSelection = pathway === "single" ? "priya" : selection;
  const editor = pathway === "single" ? "priya" : selection === "household" ? editingStudent : selection;
  const student = studentById(editor);
  const answers = intake[editor];
  const { surfaced: rows, setAside, horizon, counts } = personalizedPlan(active, intake);
  const change = <K extends keyof IntakeAnswers>(key: K, value: IntakeAnswers[K]) => setIntake((current) => updateStudentAnswer(current, editor, key, value));
  const selectView = (view: DemoSelection) => { setSelection(view); if (view !== "household") setEditingStudent(view); };

  return (
    <div className="campus-page">
      <a className="skip-link" href="#main">Skip to main content</a>
      <MarketingHeader current="sample" />
      <main id="main" className="sample-page site-shell">
        <Link className="sample-back" href="/">← Overview</Link>
        <div className="sample-heading"><div><p className="eyebrow">Fictional, read-only example</p><h1 className="display">See how a meaningful next step comes into focus.</h1><p>Try a few choices to see how a student&apos;s plan changes. Your answers stay in this browser view; nothing reads a school portal, a live source, or a real household record.</p></div><span className="read-only">Illustrative · read-only</span></div>
        <div className="pathway-selector" aria-label="Choose a pathway">
          <button type="button" aria-pressed={pathway === "single"} onClick={() => setPathway("single")}>Single Student</button>
          <button type="button" aria-pressed={pathway === "multiple"} onClick={() => setPathway("multiple")}>Multiple Students</button>
        </div>
        <section className="sample-intro" aria-live="polite">
          {pathway === "single" ? <><h2>Priya&apos;s own next steps</h2><p>One student still has different schools, dates, responsibilities, and unknowns to keep straight. Priya is a fictional Class of 2027 applicant planning for Fall 2027.</p></> : <><h2>Different paths, the same admissions cycle</h2><p>Priya compares admissions and aid timing; Mateo explores campus visits and accessibility contacts. Both fictional students graduate in 2027 and plan for Fall 2027. A qualifying household can include <strong>two or more students</strong> under a purchaser&apos;s <strong>genuine caregiving responsibility</strong> when they share the <strong>same high-school graduation year and admissions cycle</strong>. This two-student illustration is not a limit.</p></>}
        </section>
        {pathway === "multiple" && <nav className="selection-tabs sample-filter" aria-label="Choose students to view">
          <button type="button" aria-pressed={selection === "household"} className={selection === "household" ? "is-selected" : ""} onClick={() => selectView("household")}>Both students</button>
          {demoStudents.map((entry) => <button type="button" key={entry.id} aria-pressed={selection === entry.id} className={selection === entry.id ? "is-selected" : ""} onClick={() => selectView(entry.id)}><StudentDot color={entry.color} />{entry.name.split(" ")[0]}</button>)}
        </nav>}
        <section className="sample-intake" aria-labelledby="intake-title">
          <div className="intake-head"><div><p className="eyebrow">Make it relevant</p><h2 id="intake-title">A few answers, a clearer plan</h2><p>The broader concept spans 12 college-journey themes; this short example asks only the choices that shape what you see. School requirements always stay visible.</p></div><span className="intake-tag">Try changing an answer ↓</span></div>
          <div className="intake-theme-map" aria-label="Twelve areas across the college journey"><span><strong>Getting in</strong> Admissions · aid · scholarships</span><span><strong>Choosing and paying</strong> Enrollment · billing and 529 · housing</span><span><strong>Getting started</strong> Health and access · orientation · campus logistics</span><span><strong>Belonging and beyond</strong> Student life · family experience · career and progression</span></div>
          {pathway === "multiple" && selection === "household" && <fieldset className="intake-student-switch"><legend>Whose answers are you changing?</legend><div className="intake-options">{demoStudents.map((entry) => <label key={entry.id} className="intake-choice"><input type="radio" name="editing-student" value={entry.id} checked={editingStudent === entry.id} onChange={() => setEditingStudent(entry.id)} /><StudentDot color={entry.color} />{entry.name.split(" ")[0]}</label>)}</div></fieldset>}
          <p className="intake-owner"><StudentDot color={student.color} /> Editing <strong>{student.name.split(" ")[0]}&apos;s</strong> fictional answers. {pathway === "multiple" ? "The other student's answers stay separate." : "Switch to Multiple Students to compare two plans."}</p>
          <div className="intake-grid">
            <fieldset className="intake-group"><legend>Where might {student.name.split(" ")[0]} live?</legend><div className="intake-options">{livingChoices.map(({ value, label }) => <label key={value} className="intake-choice"><input type="radio" name={`living-${editor}`} checked={answers.living === value} onChange={() => change("living", value)} />{label}</label>)}</div><p>In this example, a school&apos;s first-year residence rule is shown even if you choose commute or off-campus housing.</p></fieldset>
            <fieldset className="intake-group"><legend>Which funding paths should we consider?</legend><div className="intake-options">{fundingChoices.map(({ key, label }) => <label key={key} className="intake-choice"><input type="checkbox" checked={answers[key]} onChange={(event) => change(key, event.target.checked)} />{label}</label>)}</div><p>A listing is not an eligibility decision; the school, sponsor, or plan administrator remains the authority.</p></fieldset>
          </div>
          <details className="intake-more"><summary>More about campus days and support <span>Transport · access · visits · orientation · family</span></summary><div className="intake-grid intake-grid-more"><fieldset className="intake-group"><legend>How might {student.name.split(" ")[0]} get around?</legend><div className="intake-options">{transportChoices.map(({ value, label }) => <label key={value} className="intake-choice"><input type="radio" name={`transport-${editor}`} checked={answers.transport === value} onChange={() => change("transport", value)} />{label}</label>)}</div></fieldset><fieldset className="intake-group"><legend>What else is relevant?</legend><div className="intake-options">{campusChoices.map(({ key, label }) => <label key={key} className="intake-choice"><input type="checkbox" checked={answers[key]} onChange={(event) => change(key, event.target.checked)} />{label}</label>)}</div></fieldset></div></details>
          <p className="intake-note">This is a short illustration, not a questionnaire or a live personalized service. No answers are submitted or saved.</p>
        </section>
        <p className="sample-count" aria-live="polite"><strong>{rows.length} relevant illustrated item{rows.length === 1 ? "" : "s"}</strong> · {setAside.length} optional item{setAside.length === 1 ? "" : "s"} set aside · {counts.dueThisWeek} family action{counts.dueThisWeek === 1 ? "" : "s"} · {counts.waiting} school-side wait{counts.waiting === 1 ? "" : "s"} · {counts.complete} complete · {counts.awareness} planning or awareness item{counts.awareness === 1 ? "" : "s"}</p>
        <div className="sample-grid">
          <section aria-labelledby="items-title"><h2 id="items-title">Relevant steps and updates</h2><div className="sample-items">{rows.map((row) => <SampleItem key={`${row.student}-${row.school}-${row.title}`} row={row} />)}</div></section>
          <aside className="sample-rail" aria-labelledby="ahead-title"><h2 id="ahead-title">What&apos;s ahead</h2><p className="sample-rail-intro">Published dates and honest unknowns are kept separate from these preference examples.</p><ul className="horizon-list">{horizon.map((event) => <li key={`${event.student}-${event.label}`}><span className={`horizon-state state-${event.state === "Not yet published" ? "unknown" : "known"}`}>{event.state}</span><strong>{event.label}</strong><span className="horizon-date">{event.date ?? "Not yet published"}</span><p>{event.note}</p></li>)}</ul>
            <section className="aside-work" aria-labelledby="aside-title"><h3 id="aside-title">Set aside for now · {setAside.length}</h3><p>Optional examples filtered by these answers; school requirements are never set aside. Change an answer to bring one back.</p><ul>{setAside.map((item) => <li key={`${item.student}-${item.title}`}><strong><StudentDot color={studentById(item.student).color} /> {studentById(item.student).name.split(" ")[0]} · {item.title}</strong><span>{item.reason}</span></li>)}</ul></section>
          </aside>
        </div>
        <p className="sample-disclaimer">Every student, school, date, policy, and source label on this page is fictional. The source and freshness fields show how context would be presented, not a claim that any page was checked. Confirm actual steps with the school or sponsor.</p>
        <div className="sample-next"><h2>Want to understand the approach?</h2><div className="actions"><Link className="button button-secondary" href="/">Read the overview</Link><Link className="button button-primary" href="/request-access">Request access</Link></div></div>
      </main>
      <footer className="site-footer"><div className="site-shell footer-inner"><span>© 2026 Campus Passage concept</span><span>Illustrative examples · Not affiliated with or endorsed by schools</span></div></footer>
    </div>
  );
}
