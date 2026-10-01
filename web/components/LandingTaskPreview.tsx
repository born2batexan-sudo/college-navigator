import { CompletionToggle } from "./CompletionToggle";
import { OfficialDestination } from "./OfficialDestination";
import { StatePill } from "./StatusPill";
import { STATE_LABELS, STATE_STYLES } from "@/lib/format";

// Static illustration only: no household IDs, live records, fabricated school URL, or asserted source review.
const tasks = [
  { id: "transcript", title: "Review final transcript submission instructions", domain: "Admissions", date: "July 1, 2027 · example due date", status: "complete", checked: true, reason: "Admitted student · transcript may be required before enrollment", priority: "High", applicability: "applies" },
  { id: "housing", title: "Check the first-year housing application window", domain: "Housing", date: "April 2027 · example window", status: "started", checked: false, reason: "On-campus housing is a family preference", priority: "Normal", applicability: "applies" },
  { id: "aid", title: "Watch for the financial-aid priority date", domain: "Financial aid", date: "Fall 2027 date not yet published", status: "not_started", checked: false, reason: "Aid information is relevant; a date has not been confirmed", priority: "Normal", applicability: "not_yet_published" },
] as const;

export function LandingTaskPreview() {
  return <aside className="hero-plan-card" aria-label="Illustrative read-only dashboard task preview">
    <div className="hero-preview-heading"><div><p className="hero-preview-kicker">A family plan at a glance</p><h2>Lakeview College · Fall 2027</h2></div><span className="hero-preview-badge">Read-only example</span></div>
    <div className="hero-preview-tasks">{tasks.map((task, index) => <article key={task.id} className={`hero-preview-task${index === 0 ? "" : " hero-preview-task-summary"}`} data-preview-task>
      <div className="hero-preview-meta"><span className="hero-preview-priority">{task.priority}</span><span>{task.domain}</span><StatePill state={task.status} styles={STATE_STYLES} labels={STATE_LABELS} /></div>
      <h3>{task.title}</h3>
      <p className="hero-preview-date">{task.date}</p>
      {index === 0 && <>
        <p className="hero-preview-reason">Why included: {task.reason}</p>
        <div className="hero-preview-controls">
          <CompletionToggle actionId={`preview-${task.id}`} completed={task.checked} readOnly />
          <OfficialDestination source={null} rule={{ title: task.title, domain: task.domain, researchTerm: "Fall 2027", applicability: task.applicability, evidenceQuote: null }} schoolName="Lakeview College" illustrative />
        </div>
      </>}
    </article>)}</div>
    <p className="hero-plan-caption">Illustrative school, dates, and statuses; no live source checked. The detailed task&apos;s checked box represents a family choice, not a school receipt. Only a family&apos;s saved Completed selections count in a real plan.</p>
  </aside>;
}
