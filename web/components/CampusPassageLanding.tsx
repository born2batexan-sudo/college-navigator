"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type View = "public" | "dashboard";
type Tone = "action" | "waiting" | "complete" | "aware";

const TONE_META: Record<Tone, { marker: string; due: string }> = {
  action: { marker: "", due: "" },
  waiting: { marker: "waiting", due: "wait" },
  complete: { marker: "done", due: "complete" },
  aware: { marker: "aware", due: "aware" },
};

const branches = [
  { school: "Cedar Hill College", title: "Portal update", text: "Transcript status needs a clear next step.", tone: "coral" },
  { school: "North Valley University", title: "Date not posted", text: "The family should see the unknown—not a guess.", tone: "gold" },
  { school: "Lakeview Institute", title: "Confirmation needed", text: "“Sent” and “received” can be different states.", tone: "teal" },
];

const actionRows: { school: string; kind: string; title: string; detail: string; status: string; tone: Tone; queueTag: string; source: string }[] = [
  {
    school: "Cedar Hill College",
    kind: "Family action",
    title: "Send official transcript",
    detail: "Ask the school to send it through its official process.",
    status: "Due: sample date",
    tone: "action",
    queueTag: "Sample date",
    source: "Cedar Hill College · Official school source · Fall sample · last reviewed: sample label",
  },
  {
    school: "North Valley University",
    kind: "School update",
    title: "Housing date not posted yet",
    detail: "There is no published date in this illustrative record.",
    status: "Waiting on school",
    tone: "waiting",
    queueTag: "Waiting",
    source: "North Valley University · Official school source · Fall sample · last reviewed: sample label · no date is displayed because this illustrative record has no published date",
  },
  {
    school: "Lakeview Institute",
    kind: "Status check",
    title: "Enrollment deposit received",
    detail: "The school-side status is shown separately from the family’s submission.",
    status: "Complete",
    tone: "complete",
    queueTag: "Complete",
    source: "Lakeview Institute · Official school source · Fall sample · last reviewed: sample label",
  },
  {
    school: "Cedar Hill College",
    kind: "Aid & scholarship awareness — roadmap",
    title: "A regional scholarship is posted",
    detail: "Sponsor, link, and deadline are shown as published. The sponsor alone decides eligibility and awards — never CampusPassage.",
    status: "Notice: review by sample date",
    tone: "aware",
    queueTag: "Notice",
    source: "Cedar Hill College region · Named community-foundation listing · Fall sample · last reviewed: sample label · awareness only, not an eligibility determination",
  },
  {
    school: "Lakeview Institute",
    kind: "Billing & 529 awareness — roadmap",
    title: "First tuition statement is posted",
    detail: "Questions to bring to the bursar’s office and, if used, the 529 plan administrator before paying.",
    status: "Notice: review before paying",
    tone: "aware",
    queueTag: "Notice",
    source: "Lakeview Institute · Official bursar source · Fall sample · last reviewed: sample label · not a payment, withdrawal, or tax determination",
  },
];

const trustNotes = [
  ["↗", "Official source cue", "Each item can point the family back to the school’s, sponsor’s, or vendor’s own instruction. CampusPassage helps organize; the original source remains the authority."],
  ["◎", "Term in view", "An item is presented with its applicable student, school, and term so families do not mistake a prior or different-cycle detail for their current plan."],
  ["—", "Unknown is shown plainly", "“Date not posted yet” and “not enough information to assess relevance” are intentional states, not an invented deadline or a false promise of continual monitoring."],
] as const;

const journeyStages: { phase: string; title: string; text: string; tag: "live" | "roadmap" }[] = [
  { phase: "Before you apply", title: "Research, terms, and timelines", text: "Plain-language explanations, published timelines, and links back to each school’s own admissions pages.", tag: "roadmap" },
  { phase: "While applying", title: "One list, every school", text: "Public information worth noticing across the whole list a household is watching, organized by school and term.", tag: "roadmap" },
  { phase: "After you submit", title: "What came next, and what is a wait", text: "This preview is illustrated below: household action, school update, unknown, and completion, told apart in plain language.", tag: "live" },
  { phase: "Aid & scholarships", title: "Reviewed, source-linked opportunities", text: "Sponsor, link, and status for a credible opportunity — with a question list, never an eligibility claim.", tag: "roadmap" },
  { phase: "Decision, billing & 529", title: "What to understand before you commit", text: "Published deposit, orientation, housing, and billing prompts gathered in one place, pointed back to the school and plan administrator.", tag: "roadmap" },
  { phase: "Persistence & career", title: "What the school or employer publishes", text: "Institution- and employer-provided opportunities worth noticing — never a replacement for the school’s own career center.", tag: "roadmap" },
];

const moneyCards: { title: string; tag: "roadmap" | "planned"; text: string }[] = [
  {
    title: "Financial aid & scholarship awareness",
    tag: "roadmap",
    text: "Planned: reviewed, source-linked aid and scholarship opportunities with sponsor, link, and status — plus a question list for the household. CampusPassage never states or predicts that a student qualifies or will be selected; the sponsor and school alone decide eligibility and awards.",
  },
  {
    title: "Billing & 529 awareness",
    tag: "roadmap",
    text: "Planned: see what a bill or education-savings question is really asking before money moves, with a direct path to the school’s bursar office, the 529 plan administrator, or IRS guidance. CampusPassage does not process a payment, a withdrawal, or a determination of qualified expenses.",
  },
  {
    title: "CampusPassage Horizon",
    tag: "planned",
    text: "Planned: a calm view of upcoming school announcements and milestones, shown only once an official public source has published a date or window — with its confidence and review state always visible. Horizon does not predict a date or continuously watch a portal in the background.",
  },
  {
    title: "Every student, every desired school",
    tag: "planned",
    text: "Planned: switch cleanly between every student in a household, each with a separate plan, source list, and notification settings — with no student’s urgency becoming another’s notification burden. This preview illustrates one student’s plan across three schools.",
  },
];

function StageTag({ tag }: { tag: "live" | "roadmap" | "planned" }) {
  if (tag === "live") return <span className="stage-tag tag-live">Illustrated in this preview</span>;
  if (tag === "planned") return <span className="stage-tag tag-planned">Planned capability</span>;
  return <span className="stage-tag tag-roadmap">Roadmap architecture</span>;
}

export default function CampusPassageLanding() {
  const [view, setView] = useState<View>("public");
  const [resolved, setResolved] = useState(false);
  const [sourceContext, setSourceContext] = useState("Select “Source context” beside an item to inspect its illustrative provenance label.");
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
        <div className="utility-bar">Public concept preview · access requests are for a read-only demonstration, not enrollment in a live service.</div>
        <div className="site-shell topbar">
          <Link className="brand" href="#top" aria-label="CampusPassage home"><span className="brand-mark" aria-hidden="true">◇</span>CampusPassage</Link>
          <div className="view-switch" role="tablist" aria-label="Concept view">
            <button id="public-tab" type="button" role="tab" aria-selected={view === "public"} aria-controls="public-view" onClick={() => switchView("public")}>Public story</button>
            <button id="dashboard-tab" type="button" role="tab" aria-selected={view === "dashboard"} aria-controls="dashboard-view" onClick={() => switchView("dashboard")}>Family plan</button>
          </div>
          <nav className="navlinks" aria-label="Primary navigation">
            <a href="#journey">Journey</a>
            <a href="#money">Aid &amp; Horizon</a>
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
                <p className="eyebrow">Protect the opportunity your student earned</p>
                <h1 id="hero-title" className="display hero-title">A college opportunity can be lost to a missed detail. <em>See what matters before it stops mattering.</em></h1>
                <p className="lede">From the first research question to the last bill, college information arrives scattered across schools, vendors, sponsors, and inboxes — much of it irrelevant to your household. CampusPassage inspects authoritative public college and vendor sources, filters out the noise, and organizes what matters for every student and every school you are watching, before, during, and after applications. Official school and sponsor instructions always remain in control.</p>
                <div className="actions"><Link className="button button-primary" href="/request-access">Request private-preview access</Link><a className="button button-secondary" href="#journey">See the whole passage</a></div>
                <p className="hero-proof"><span>No school-portal passwords</span><span>Official-source context</span><span>Term-specific notes</span></p>
              </div>
              <aside className="hero-note" aria-label="The household problem"><span className="margin-mark" aria-hidden="true" /><blockquote>“It’s not just after we submit. There’s financial aid in one inbox, a scholarship deadline in another, and a bill nobody flagged.”</blockquote><p>One family’s understandable question—shown as an illustrative household note, not a customer quote.</p></aside>
            </section>

            <hr className="rule site-shell" />

            <section id="money" className="story-section site-shell money-section" aria-labelledby="money-title">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Beyond the checklist</p>
                  <h2 id="money-title" className="display">The stakes are money and timing, not only dates.</h2>
                </div>
                <p>Aid decisions, scholarship windows, billing questions, and 529 timing carry real consequences — and every school and sponsor announces them on its own public page. This is the roadmap for bringing those moments into one household view, always naming the source and never guessing what has not been published.</p>
              </div>
              <div className="money-grid">
                {moneyCards.map((card) => (
                  <article className="money-card" key={card.title}>
                    <StageTag tag={card.tag} />
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
                <p>CampusPassage is designed around the full arc of a college decision — not one launch. The roadmap below names each moment plainly; only the after-submission moment is illustrated in this preview today.</p>
              </div>
              <ol className="journey-grid">
                {journeyStages.map((stage) => (
                  <li className="journey-stage" key={stage.phase}>
                    <StageTag tag={stage.tag} />
                    <p className="journey-phase">{stage.phase}</p>
                    <strong>{stage.title}</strong>
                    <p>{stage.text}</p>
                  </li>
                ))}
              </ol>
            </section>

            <section id="story" className="story-section site-shell" aria-labelledby="story-title">
              <div className="section-head"><div><p className="eyebrow">Zoom in: after you submit</p><h2 id="story-title" className="display">One application path fractures into many school paths.</h2></div><p>Different terms, different instructions, and different moments of “is this actually done?” should not force a family to become its own coordination system.</p></div>
              <figure className={`pathway ${resolved ? "is-resolved" : ""}`} aria-labelledby="path-caption">
                <div className="pathway-toolbar"><strong>Illustrative pathway</strong><button className="text-button" type="button" aria-pressed={resolved} onClick={() => setResolved((current) => !current)}>{resolved ? "Show the separate school paths" : "Bring it into one plan"}</button></div>
                <div className="path-stage">
                  <div className="submitted-line">Applications submitted</div>
                  <div className="branch-grid" aria-hidden={resolved}>{branches.map((branch) => <article className={`branch branch-${branch.tone}`} key={branch.school}><p className="tiny">{branch.school}</p><strong>{branch.title}</strong><p>{branch.text}</p></article>)}</div>
                  <div className="plan-reveal" aria-hidden={!resolved}><div className="one-plan"><div className="one-plan-header"><div><p>CampusPassage household plan</p><strong>This week, one thing needs attention.</strong></div><span className="caption caption-on-dark">Illustrative sample</span></div><div className="mini-slips"><div className="mini-slip"><b>Cedar Hill</b><span>Send transcript</span></div><div className="mini-slip"><b>North Valley</b><span>Date not posted yet</span></div><div className="mini-slip"><b>Lakeview</b><span>School received it</span></div></div></div></div>
                </div>
                <figcaption id="path-caption" className="caption">Interactive diagram transcript: three separate school notices resolve into a single ordered household view. It is a concept illustration of one moment in the passage; no live school data is shown.</figcaption>
              </figure>
            </section>

            <section className="site-shell outcomes" aria-label="What one plan changes">
              <article className="outcome"><span className="count">01</span><h3>See the next meaningful step</h3><p>Prioritize what calls for the household’s attention without making every school update feel equally urgent.</p></article>
              <article className="outcome"><span className="count">02</span><h3>Know whose turn it is</h3><p>Make the difference between a family action and a school-side wait visible in plain language.</p></article>
              <article className="outcome"><span className="count">03</span><h3>Share the same picture</h3><p>Give parent and student a common, source-conscious plan while protecting school-account boundaries.</p></article>
              <article className="outcome"><span className="count">04</span><h3>Ask, in plain language</h3><p><StageTag tag="planned" /></p><p>Planned: CampusPassage Guide will explain an unfamiliar term, help prepare a question, and point back to the controlling official source. It will not decide, certify, or give legal, tax, financial-aid, or admissions advice.</p></article>
            </section>

            <section className="story-section site-shell experience-film" aria-labelledby="film-title">
              <div className="film-copy">
                <p className="eyebrow">See one moment, then see the plan</p>
                <h2 id="film-title" className="display">Watch after-you-submit, the moment illustrated in this preview.</h2>
                <p>In under a minute, see how CampusPassage turns scattered post-application instructions into one shared household view—without asking for school-portal passwords or pretending an unpublished date is known. The wider before/during/after passage above is roadmap architecture, not shown in this clip.</p>
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

            <section id="how" className="story-section plan-section" aria-labelledby="plan-title"><div className="site-shell"><div className="section-head"><div><p className="eyebrow">A household desk, not another portal</p><h2 id="plan-title" className="display">The plan turns details into one readable next move.</h2></div><p>Written language and a paper-like action view work together: the story explains why; the plan demonstrates exactly what that relief feels like.</p></div><div className="household-plan" aria-label="Illustrative CampusPassage household plan"><span className="sample-label">Illustrative household · read-only concept</span><div className="plan-titlebar"><div><h3>The Reyes family plan</h3><p>One student shown · three schools · aid &amp; billing notices included</p></div><div className="term-stamp">Applicable term<br />Fall sample</div></div><p className="plan-summary"><b>One thing needs attention this week.</b><span>One item is waiting on a school.</span><span>One item is complete.</span><span>Two items are aid &amp; billing notices worth a look.</span><span>Planned: switch to another student in this household.</span></p>{actionRows.map((row) => <div className="slip" key={`${row.school}-${row.title}`}><span className={`slip-marker ${TONE_META[row.tone].marker}`} aria-hidden="true" /><div className="slip-school">{row.school}<small>{row.kind}</small></div><div className="slip-action"><strong>{row.title}</strong><span>{row.detail}</span></div><div className={`slip-status ${row.tone !== "action" ? row.tone : ""}`}>{row.status}</div></div>)}<div className="source-note"><span>Official school &amp; sponsor sources</span><span>Applicable term: Fall sample</span><span>Last reviewed: sample label</span></div></div><p className="plan-transcript">Plan transcript: Cedar Hill needs a family transcript action and shows a roadmap scholarship notice; North Valley has not published a date; Lakeview records a completed school-side status and a roadmap billing/529 notice. Dates, names, sponsors, and requirements are illustrative.</p></div></section>

            <section className="story-section site-shell" aria-labelledby="status-title"><div className="status-layout"><div><p className="eyebrow">Status has a grammar</p><h2 id="status-title" className="display">“We sent it” is not always the end of the story.</h2><p>CampusPassage makes the difference between the household’s action and the school’s recognized status legible. It does not replace a school’s instructions or decide what a school will accept.</p></div><div className="progress-paper"><p>Illustrative status progression</p><div className="progression" aria-label="Submitted then Received then Complete"><div className="stage"><span className="number">01</span><strong>Submitted</strong><small>The family has taken the action.</small></div><div className="arrow" aria-hidden="true">→</div><div className="stage active"><span className="number">02</span><strong>Received</strong><small>The school shows it has received the item.</small></div><div className="arrow" aria-hidden="true">→</div><div className="stage"><span className="number">03</span><strong>Complete</strong><small>The applicable record is ready on the school’s terms.</small></div></div><div className="status-key"><span><b>Submitted</b> = family action</span><span><b>Received</b> = school-side acknowledgment</span><span><b>Complete</b> = current status shown</span></div></div></div></section>

            <section id="trust" className="story-section site-shell" aria-labelledby="trust-title">
              <div className="section-head"><div><p className="eyebrow">Trust lives beside the item</p><h2 id="trust-title" className="display">Clear context, including when the answer is not yet known.</h2></div><p>Every proposed trust cue is expressed in both plain text and a distinct visual mark, so provenance never becomes a vague footer claim.</p></div>
              <div className="trust-grid">{trustNotes.map(([symbol, title, text]) => <article className="trust-note" key={title}><div className="symbol" aria-hidden="true">{symbol}</div><h3>{title}</h3><p>{text}</p></article>)}</div>
              <div className="standard-line"><span>Source-conscious by design</span><strong>School-specific context, an applicable term, and a visible review date where available.</strong></div>
              <div className="standard-callout" aria-label="The 12² Standard">
                <p className="eyebrow">The 12² Standard</p>
                <p className="callout-line">144 checks. Every college. Every applicable term.</p>
                <p className="caption">Named here as the review discipline behind an expert-inspected plan — not a published checklist or method.</p>
              </div>
              <div className="roadmap-disclosure"><strong>Guide, Horizon, Page Assist, multi-student switching, and email/SMS reminders are named on this page as planned or roadmap architecture — none are part of this preview today.</strong></div>
            </section>

            <section className="story-section site-shell" aria-labelledby="reminders-title"><div className="reminders"><div><p className="eyebrow">Calm reminders, in the right channel</p><h2 id="reminders-title" className="display">Let the plan surface what matters without taking over the household.</h2><p>The core concept illustrated today is the plan itself. Email and SMS reminders are named plainly as planned — not an assumed or currently delivered channel.</p></div><div className="reminder-map" aria-label="Reminder channel concept"><div className="reminder-row"><div className="channel">In-app · shown here</div><p><strong>One decisive item</strong><br /><span>Show the next step where the household is already reviewing the plan — the illustrative concept in this preview.</span></p></div><div className="reminder-row"><div className="channel future">Email · planned</div><p><strong>A concise plan reminder</strong><br /><span>Planned: send context and a direct route back to the shared plan, not a stream of alerts. Not verified as operational today.</span></p></div><div className="reminder-row"><div className="channel future">SMS · planned, future opt-in</div><p><strong>Only with explicit opt-in</strong><br /><span>Reserve for a future setting with clear consent and meaningful control — never an assumed channel.</span></p></div></div></div>
              <div className="future-stack">
                <aside className="privacy-panel" aria-labelledby="privacy-title"><span className="future-label">Planned, optional concept</span><p className="eyebrow privacy-eyebrow">Privacy-first email validation</p><h3 id="privacy-title">Validate a message without opening a family inbox.</h3><p>A future paid, optional service concept could let a family submit a specific message for validation against their plan. It is not a live purchase or payment offer.</p><ul className="privacy-list"><li>No inbox connection or school-portal credential</li><li>Family chooses the individual message they want checked</li><li>Clear scope and consent before any validation request</li></ul></aside>
                <aside className="privacy-panel assist" aria-labelledby="assist-title"><span className="future-label">Planned premium capability</span><p className="eyebrow privacy-eyebrow">Page Assist: read-and-explain, not do-it-for-you</p><h3 id="assist-title">Understand a page without leaving the plan.</h3><p>Planned: Page Assist will help a person understand an explicitly supported public page, in plain language, and link back to the shared plan. It is user-initiated, on a narrow allow-list of compatible pages, and remains premium.</p><ul className="privacy-list"><li>Read-and-explain only — never fills in, submits, or pays anything</li><li>No sign-in, portal, or payment page is ever supported</li><li>Off by default, on only where a person turns it on that session</li></ul></aside>
              </div>
            </section>

            <section className="site-shell closing" aria-labelledby="closing-title"><p className="eyebrow">Private preview</p><h2 id="closing-title" className="display">A calmer way to carry the whole passage, not just one moment.</h2><p>Explore a read-only example of how a shared household plan can make college steps easier to understand — from official-source awareness to a clear next move. Access requests are reviewed; no availability or response-time promise is implied here.</p><div className="actions actions-centered"><Link className="button button-primary" href="/request-access">Request private-preview access</Link><button className="button button-secondary" type="button" onClick={() => switchView("dashboard")}>Open family plan concept</button></div></section>
          </main>
          <footer className="site-footer"><div className="site-shell footer-inner"><span>© 2026 CampusPassage concept preview</span><span>Examples are illustrative · Not affiliated with or endorsed by schools</span></div></footer>
        </div>
      ) : (
        <div id="dashboard-view" role="tabpanel" aria-labelledby="dashboard-tab">
          <main id="dashboard-main" ref={dashboardMain} className="site-shell dashboard" tabIndex={-1}>
            <div className="dashboard-lede"><div><p className="eyebrow">CampusPassage · family plan concept</p><h1>The Reyes family plan</h1><p>Jordan · applicable term: Fall sample · three illustrative schools · one of a household planned to hold every student</p></div><span className="read-only">Illustrative · read-only</span></div>
            <div className="dash-summary"><strong>This week: one family action, one school wait, two aid &amp; billing notices.</strong><span>The rest of the plan can stay quiet. Switching between siblings in the same household is planned, not shown here.</span></div>
            <div className="dash-grid">
              <section aria-labelledby="queue-title"><div className="dash-heading"><h2 id="queue-title">Household action queue</h2><span>{actionRows.length} illustrative items</span></div>{actionRows.map((row) => <article className="queue-item" key={`${row.school}-${row.title}`}><span className={`slip-marker ${TONE_META[row.tone].marker}`} aria-hidden="true" /><span className={`due ${TONE_META[row.tone].due}`}>{row.queueTag}</span><div><strong>{row.title}</strong><small>{row.school} · {row.kind.toLowerCase()}</small></div><button className="source-tab" type="button" onClick={() => setSourceContext(row.source)}>Source context</button></article>)}</section>
              <aside className="rail" aria-labelledby="school-title"><h2 id="school-title">School view</h2><div className="rail-note"><strong>Cedar Hill College</strong><p>A family action and a roadmap scholarship notice are visible. Sponsor and source context belong beside each.</p></div><div className="rail-note"><strong>North Valley University</strong><p>A waiting state is not framed as a failure or as an assumed deadline.</p></div><div className="rail-note"><strong>Lakeview Institute</strong><p>Completed work and a roadmap billing/529 notice remain visible without competing with the next action.</p></div><div className="rail-note"><strong>Planned ahead</strong><p>CampusPassage Guide and Horizon are named as planned capabilities; multi-student switching is on the same roadmap.</p></div><div className="dash-source" aria-live="polite"><strong>Source context</strong><p>{sourceContext}</p></div></aside>
            </div>
            <p className="caption dashboard-transcript">Family plan transcript: this concept prioritizes an editorial sentence, a readable action queue including roadmap aid/billing notices, and item-level source context over dashboard metrics. Examples are illustrative and do not represent live school, sponsor, or financial information.</p>
          </main>
        </div>
      )}
    </div>
  );
}
