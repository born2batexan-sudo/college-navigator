"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type View = "public" | "dashboard";

const branches = [
  { school: "Cedar Hill College", title: "Portal update", text: "Transcript status needs a clear next step.", tone: "coral" },
  { school: "North Valley University", title: "Date not posted", text: "The family should see the unknown—not a guess.", tone: "gold" },
  { school: "Lakeview Institute", title: "Confirmation needed", text: "“Sent” and “received” can be different states.", tone: "teal" },
];

const actionRows = [
  {
    school: "Cedar Hill College",
    kind: "Family action",
    title: "Send official transcript",
    detail: "Ask the school to send it through its official process.",
    status: "Due: sample date",
    statusTone: "action",
    source: "Cedar Hill College · Official school source · Fall sample · last reviewed: sample label",
  },
  {
    school: "North Valley University",
    kind: "School update",
    title: "Housing date not posted yet",
    detail: "There is no published date in this illustrative record.",
    status: "Waiting on school",
    statusTone: "waiting",
    source: "North Valley University · Official school source · Fall sample · last reviewed: sample label · no date is displayed because this illustrative record has no published date",
  },
  {
    school: "Lakeview Institute",
    kind: "Status check",
    title: "Enrollment deposit received",
    detail: "The school-side status is shown separately from the family’s submission.",
    status: "Complete",
    statusTone: "complete",
    source: "Lakeview Institute · Official school source · Fall sample · last reviewed: sample label",
  },
];

const trustNotes = [
  ["↗", "Official source cue", "Each action can point the family back to the school’s own instruction. CampusPassage helps organize; the school remains the authority."],
  ["◎", "Term in view", "An action is presented with its applicable term so families do not mistake a prior or different-cycle detail for their current plan."],
  ["—", "Unknown is shown plainly", "“Date not posted yet” is an intentional state, not an invented deadline or a false promise of continual monitoring."],
] as const;

export default function CampusPassageLanding() {
  const [view, setView] = useState<View>("public");
  const [resolved, setResolved] = useState(false);
  const [sourceContext, setSourceContext] = useState("Select “Source context” beside an action to inspect its illustrative provenance label.");
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

  return (
    <div className="campus-page" data-view={view}>
      <a className="skip-link" href="#main">Skip to main content</a>
      <header className="site-header">
        <div className="utility-bar">Concept preview · all schools, dates, actions, and household details shown here are illustrative.</div>
        <div className="site-shell topbar">
          <Link className="brand" href="#top" aria-label="CampusPassage home"><span className="brand-mark" aria-hidden="true">◇</span>CampusPassage</Link>
          <div className="view-switch" role="tablist" aria-label="Concept view">
            <button id="public-tab" type="button" role="tab" aria-selected={view === "public"} aria-controls="public-view" onClick={() => switchView("public")}>Public story</button>
            <button id="dashboard-tab" type="button" role="tab" aria-selected={view === "dashboard"} aria-controls="dashboard-view" onClick={() => switchView("dashboard")}>Family plan</button>
          </div>
          <nav className="navlinks" aria-label="Primary navigation">
            <a href="#how">How it works</a>
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
              <div>
                <p className="eyebrow">For families after applications are submitted</p>
                <h1 id="hero-title" className="display hero-title">Your student earned the opportunity. <em>Fragmented follow-through should not put it at risk.</em></h1>
                <p className="lede">After submission, each college becomes its own system of portals, notices, and next steps. CampusPassage gives a household one calm plan for what needs attention, what is waiting on a school, and what is complete.</p>
                <div className="actions"><Link className="button button-primary" href="/request-access">Request private-preview access</Link><a className="button button-secondary" href="#story">See the plan take shape</a></div>
                <p className="hero-proof"><span>No school-portal passwords</span><span>Official-source context</span><span>Term-specific notes</span></p>
              </div>
              <aside className="hero-note" aria-label="The household problem"><span className="margin-mark" aria-hidden="true" /><blockquote>“We submitted. Why are there suddenly three different things to watch?”</blockquote><p>One family’s understandable question—shown as an illustrative household note, not a customer quote.</p></aside>
            </section>

            <hr className="rule site-shell" />
            <section id="story" className="story-section site-shell" aria-labelledby="story-title">
              <div className="section-head"><div><p className="eyebrow">The quiet gap after submit</p><h2 id="story-title" className="display">One application path fractures into many school paths.</h2></div><p>Different terms, different instructions, and different moments of “is this actually done?” should not force a family to become its own coordination system.</p></div>
              <figure className={`pathway ${resolved ? "is-resolved" : ""}`} aria-labelledby="path-caption">
                <div className="pathway-toolbar"><strong>Illustrative pathway</strong><button className="text-button" type="button" aria-pressed={resolved} onClick={() => setResolved((current) => !current)}>{resolved ? "Show the separate school paths" : "Bring it into one plan"}</button></div>
                <div className="path-stage">
                  <div className="submitted-line">Applications submitted</div>
                  <div className="branch-grid" aria-hidden={resolved}>{branches.map((branch) => <article className={`branch branch-${branch.tone}`} key={branch.school}><p className="tiny">{branch.school}</p><strong>{branch.title}</strong><p>{branch.text}</p></article>)}</div>
                  <div className="plan-reveal" aria-hidden={!resolved}><div className="one-plan"><div className="one-plan-header"><div><p>CampusPassage household plan</p><strong>This week, one thing needs attention.</strong></div><span className="caption caption-on-dark">Illustrative sample</span></div><div className="mini-slips"><div className="mini-slip"><b>Cedar Hill</b><span>Send transcript</span></div><div className="mini-slip"><b>North Valley</b><span>Date not posted yet</span></div><div className="mini-slip"><b>Lakeview</b><span>School received it</span></div></div></div></div>
                </div>
                <figcaption id="path-caption" className="caption">Interactive diagram transcript: three separate school notices resolve into a single ordered household view. It is a concept illustration; no live school data is shown.</figcaption>
              </figure>
            </section>

            <section className="site-shell outcomes" aria-label="What one plan changes">
              <article className="outcome"><span className="count">01</span><h3>See the next meaningful step</h3><p>Prioritize what calls for the household’s attention without making every school update feel equally urgent.</p></article>
              <article className="outcome"><span className="count">02</span><h3>Know whose turn it is</h3><p>Make the difference between a family action and a school-side wait visible in plain language.</p></article>
              <article className="outcome"><span className="count">03</span><h3>Share the same picture</h3><p>Give parent and student a common, source-conscious plan while protecting school-account boundaries.</p></article>
            </section>

            <section className="story-section site-shell experience-film" aria-labelledby="film-title">
              <div className="film-copy">
                <p className="eyebrow">See the why, then see the plan</p>
                <h2 id="film-title" className="display">The application was submitted. The family’s work is not finished.</h2>
                <p>In under a minute, see how CampusPassage turns scattered post-application instructions into one shared household view—without asking for school-portal passwords or pretending an unpublished date is known.</p>
                <p className="caption">Narrated private-preview overview · captions included · illustrative product data</p>
              </div>
              <div className="film-frame">
                <video controls preload="metadata" playsInline aria-label="CampusPassage private-preview product story">
                  <source src="/media/product-story.mp4" type="video/mp4" />
                  <track default kind="captions" src="/media/product-story.vtt" srcLang="en" label="English" />
                  Your browser does not support embedded video.
                </video>
                <a className="film-transcript" href="/media/product-story-transcript.txt">Read the video transcript</a>
              </div>
            </section>

            <section id="how" className="story-section plan-section" aria-labelledby="plan-title"><div className="site-shell"><div className="section-head"><div><p className="eyebrow">A household desk, not another portal</p><h2 id="plan-title" className="display">The plan turns details into one readable next move.</h2></div><p>Written language and a paper-like action view work together: the story explains why; the plan demonstrates exactly what that relief feels like.</p></div><div className="household-plan" aria-label="Illustrative CampusPassage household plan"><span className="sample-label">Illustrative household · read-only concept</span><div className="plan-titlebar"><div><h3>The Reyes family plan</h3><p>One student · three schools · shared view</p></div><div className="term-stamp">Applicable term<br />Fall sample</div></div><p className="plan-summary"><b>One thing needs attention this week.</b><span>One item is waiting on a school.</span><span>One item is complete.</span></p>{actionRows.map((row, index) => <div className="slip" key={row.school}><span className={`slip-marker ${index === 1 ? "waiting" : index === 2 ? "done" : ""}`} aria-hidden="true" /><div className="slip-school">{row.school}<small>{row.kind}</small></div><div className="slip-action"><strong>{row.title}</strong><span>{row.detail}</span></div><div className={`slip-status ${row.statusTone === "waiting" ? "waiting" : ""}`}>{row.status}</div></div>)}<div className="source-note"><span>Official school source</span><span>Applicable term: Fall sample</span><span>Last reviewed: sample label</span></div></div><p className="plan-transcript">Plan transcript: Cedar Hill needs a family transcript action; North Valley has not published a date; Lakeview records a completed school-side status. Dates, names, and requirements are illustrative.</p></div></section>

            <section className="story-section site-shell" aria-labelledby="status-title"><div className="status-layout"><div><p className="eyebrow">Status has a grammar</p><h2 id="status-title" className="display">“We sent it” is not always the end of the story.</h2><p>CampusPassage makes the difference between the household’s action and the school’s recognized status legible. It does not replace a school’s instructions or decide what a school will accept.</p></div><div className="progress-paper"><p>Illustrative status progression</p><div className="progression" aria-label="Submitted then Received then Complete"><div className="stage"><span className="number">01</span><strong>Submitted</strong><small>The family has taken the action.</small></div><div className="arrow" aria-hidden="true">→</div><div className="stage active"><span className="number">02</span><strong>Received</strong><small>The school shows it has received the item.</small></div><div className="arrow" aria-hidden="true">→</div><div className="stage"><span className="number">03</span><strong>Complete</strong><small>The applicable record is ready on the school’s terms.</small></div></div><div className="status-key"><span><b>Submitted</b> = family action</span><span><b>Received</b> = school-side acknowledgment</span><span><b>Complete</b> = current status shown</span></div></div></div></section>

            <section id="trust" className="story-section site-shell" aria-labelledby="trust-title"><div className="section-head"><div><p className="eyebrow">Trust lives beside the action</p><h2 id="trust-title" className="display">Clear context, including when the answer is not yet known.</h2></div><p>Every proposed trust cue is expressed in both plain text and a distinct visual mark, so provenance never becomes a vague footer claim.</p></div><div className="trust-grid">{trustNotes.map(([symbol, title, text]) => <article className="trust-note" key={title}><div className="symbol" aria-hidden="true">{symbol}</div><h3>{title}</h3><p>{text}</p></article>)}</div><div className="standard-line"><span>Provisional 12² Standard</span><strong>144 checks. Every college. Every applicable term.</strong></div></section>

            <section className="story-section site-shell" aria-labelledby="reminders-title"><div className="reminders"><div><p className="eyebrow">Calm reminders, in the right channel</p><h2 id="reminders-title" className="display">Let the plan surface what matters without taking over the household.</h2><p>The core concept uses the plan itself and email for useful context. SMS is deliberately a future, explicit opt-in—not an assumed channel.</p></div><div className="reminder-map" aria-label="Reminder channel concept"><div className="reminder-row"><div className="channel">In-app · core</div><p><strong>One decisive action</strong><br /><span>Show the next step where the household is already reviewing the plan.</span></p></div><div className="reminder-row"><div className="channel">Email · core</div><p><strong>A concise plan reminder</strong><br /><span>Send context and a direct route back to the shared plan, not a stream of alerts.</span></p></div><div className="reminder-row"><div className="channel future">SMS · future</div><p><strong>Only with explicit opt-in</strong><br /><span>Reserve for a future setting with clear consent and meaningful control.</span></p></div></div></div><aside className="privacy-panel" aria-labelledby="privacy-title"><span className="future-label">Future optional concept</span><p className="eyebrow privacy-eyebrow">Privacy-first email validation</p><h3 id="privacy-title">Validate a message without opening a family inbox.</h3><p>A future paid, optional service concept could let a family submit a specific message for validation against their plan. It is not a live purchase or payment offer.</p><ul className="privacy-list"><li>No inbox connection or school-portal credential</li><li>Family chooses the individual message they want checked</li><li>Clear scope and consent before any validation request</li></ul></aside></section>

            <section className="site-shell closing" aria-labelledby="closing-title"><p className="eyebrow">Private preview</p><h2 id="closing-title" className="display">A calmer way to carry the work that follows the opportunity.</h2><p>Explore a read-only example of how a shared household plan can make post-submission college steps easier to understand. Access requests are reviewed; no availability or response-time promise is implied here.</p><div className="actions actions-centered"><Link className="button button-primary" href="/request-access">Request private-preview access</Link><button className="button button-secondary" type="button" onClick={() => switchView("dashboard")}>Open family plan concept</button></div></section>
          </main>
          <footer className="site-footer"><div className="site-shell footer-inner"><span>© 2026 CampusPassage concept preview</span><span>Examples are illustrative · Not affiliated with or endorsed by schools</span></div></footer>
        </div>
      ) : (
        <div id="dashboard-view" role="tabpanel" aria-labelledby="dashboard-tab"><main id="dashboard-main" ref={dashboardMain} className="site-shell dashboard" tabIndex={-1}><div className="dashboard-lede"><div><p className="eyebrow">CampusPassage · family plan concept</p><h1>The Reyes family plan</h1><p>Jordan · applicable term: Fall sample · three illustrative schools</p></div><span className="read-only">Illustrative · read-only</span></div><div className="dash-summary"><strong>Two things are clear this week.</strong><span>One action needs the family. One item is waiting on a school. The rest of the plan can stay quiet.</span></div><div className="dash-grid"><section aria-labelledby="queue-title"><div className="dash-heading"><h2 id="queue-title">Household action queue</h2><span>3 illustrative items</span></div>{actionRows.map((row, index) => <article className="queue-item" key={row.school}><span className={`slip-marker ${index === 1 ? "waiting" : index === 2 ? "done" : ""}`} aria-hidden="true" /><span className={`due ${index === 1 ? "wait" : index === 2 ? "complete" : ""}`}>{index === 1 ? "Waiting" : index === 2 ? "Complete" : "Sample date"}</span><div><strong>{row.title}</strong><small>{row.school} · {row.kind.toLowerCase()}</small></div><button className="source-tab" type="button" onClick={() => setSourceContext(row.source)}>Source context</button></article>)}</section><aside className="rail" aria-labelledby="school-title"><h2 id="school-title">School view</h2><div className="rail-note"><strong>Cedar Hill College</strong><p>One family action is visible. Its source and applicable-term context belong beside it.</p></div><div className="rail-note"><strong>North Valley University</strong><p>A waiting state is not framed as a failure or as an assumed deadline.</p></div><div className="rail-note"><strong>Lakeview Institute</strong><p>Completed work remains visible without competing with the next action.</p></div><div className="dash-source" aria-live="polite"><strong>Source context</strong><p>{sourceContext}</p></div></aside></div><p className="caption dashboard-transcript">Family plan transcript: this concept prioritizes an editorial sentence, a readable action queue, and action-level source context over dashboard metrics. Examples are illustrative and do not represent live school information.</p></main></div>
      )}
    </div>
  );
}
