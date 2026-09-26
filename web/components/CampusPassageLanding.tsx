import Image from "next/image";
import Link from "next/link";
import MarketingHeader from "@/components/MarketingHeader";

const essentials = [
  ["What it is", "The specific task or update."],
  ["Whose move", "A family action, a school-side wait, or a date not yet published."],
  ["By when", "Only a date or window the source actually gives."],
  ["What's at stake", "Why this step matters, without invented urgency."],
] as const;

export default function CampusPassageLanding() {
  return (
    <div className="campus-page">
      <a className="skip-link" href="#main">Skip to main content</a>
      <MarketingHeader current="overview" />
      <main id="main">
        <section id="top" className="hero-cinematic" aria-labelledby="hero-title">
          <div className="hero-media" aria-hidden="true">
            <Image src="/images/campus-passage-hero.webp" alt="" fill priority sizes="100vw" className="hero-media-img" />
            <div className="hero-scrim" />
          </div>
          <span className="photo-caption hero-photo-caption">Illustrative campus photography — not a specific school.</span>
          <div className="site-shell hero-inner">
            <div className="hero-copy">
              <p className="eyebrow">Campus Passage · from interest to move-in.</p>
              <h1 id="hero-title" className="display hero-title">Protect the opportunity.</h1>
              <p className="lede">A college choice takes shape across school pages, sponsor notices, letters, and decisions at home. A personalized student plan can bring the relevant steps forward without losing the source behind them.</p>
              <div className="actions"><Link className="button button-primary" href="/sample-plan">Explore the sample plan</Link><a className="button button-secondary" href="#why-it-matters">Why it matters</a></div>
              <p className="hero-proof"><span>No school-portal passwords</span><span>Official-source context</span><span>Student- and term-specific</span></p>
            </div>
            <aside className="hero-plan-card" aria-label="Illustrative example of different kinds of updates">
              <p className="hero-plan-eyebrow">A clearer view, illustrated</p>
              <ol className="hero-plan-list">
                <li><span className="hero-plan-dot dot-action" aria-hidden="true" /><span className="hero-plan-text"><strong>Transcript</strong><small>Family action</small></span></li>
                <li><span className="hero-plan-dot dot-waiting" aria-hidden="true" /><span className="hero-plan-text"><strong>Housing date</strong><small>Waiting on school</small></span></li>
                <li><span className="hero-plan-dot dot-aware" aria-hidden="true" /><span className="hero-plan-text"><strong>Scholarship listing</strong><small>Awareness, not an eligibility decision</small></span></li>
              </ol>
              <p className="hero-plan-caption">Fictional examples, not a real household or school record.</p>
            </aside>
          </div>
        </section>

        <section id="why-it-matters" className="chapter chapter-question" aria-labelledby="why-title">
          <div className="site-shell chapter-inner">
            <p className="eyebrow">Why it matters</p>
            <div className="section-head"><h2 id="why-title" className="display">The important step is not always in the same place.</h2><p>A school may post a date on one page, send a letter about aid, and update a status elsewhere. Families still have to decide which detail applies, whose turn it is, and whether anything has changed.</p></div>
            <div className="stakes-line"><strong>A missed step can narrow a choice.</strong><span>But a school-side wait is not a family deadline. The difference deserves to be clear.</span></div>
          </div>
        </section>

        <section id="how-it-helps" className="chapter chapter-method" aria-labelledby="how-title">
          <div className="site-shell chapter-inner">
            <div className="section-head"><div><p className="eyebrow">A better way to keep track</p><h2 id="how-title" className="display">One next step, with its context intact.</h2></div><p>Campus Passage connects what schools, sponsors, and vendors publish to your family&apos;s own plan—so the next meaningful step is clear. Broad research can be filtered by each student&apos;s choices: a commuter need not sift through optional dorm steps, while school requirements stay visible. The original instructions remain the authority.</p></div>
            <figure className="guidance-panel">
              <div className="guidance-panel-frame"><Image src="/images/campus-passage-guidance.webp" alt="A parent and student reviewing a laptop together at a table" width={1536} height={864} sizes="(min-width: 860px) 480px, 100vw" className="guidance-panel-img" /></div>
              <figcaption className="guidance-panel-note"><p className="guidance-kicker">Keep the conversation</p><p>A shared view helps a family ask the right question. It does not replace a school counselor or the school&apos;s instructions.</p></figcaption>
            </figure>
            <h3 className="essentials-title">At a glance, every item answers:</h3>
            <ol className="essentials-grid">{essentials.map(([title, text], index) => <li key={title}><span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><h4>{title}</h4><p>{text}</p></li>)}</ol>
            <p className="essentials-foot">Student, school, term, source, and freshness stay with the full item in the <Link href="/sample-plan">sample plan</Link>.</p>
          </div>
        </section>

        <section id="the-journey" className="chapter chapter-passage" aria-labelledby="journey-title">
          <div className="site-shell chapter-inner">
            <div className="section-head"><div><p className="eyebrow">The whole passage</p><h2 id="journey-title" className="display">From interest to move-in.</h2></div><p>Explore schools. Submit applications. Compare aid and decisions. Prepare for a bill and a new campus. The broader journey reaches academics, internships, graduation, and career preparation; this preview illustrates only the earlier steps. Each published step belongs in the right student&apos;s context.</p></div>
            <figure className="passage-banner"><div className="passage-banner-frame"><Image src="/images/campus-passage-pathways.webp" alt="Students walking along different paths across a campus quad" width={1536} height={864} sizes="(min-width: 1180px) 1180px, 100vw" className="passage-banner-img" /><span className="photo-caption passage-banner-note">Illustrative campus photography — not a specific school.</span></div><figcaption className="passage-banner-caption"><p className="passage-banner-kicker">The same care, each path</p><p>One student or several: each school, term, and question stays distinct.</p></figcaption></figure>
          </div>
        </section>

        <section id="sample" className="chapter chapter-example" aria-labelledby="sample-title">
          <div className="site-shell chapter-inner example-inner"><div><p className="eyebrow">See an example</p><h2 id="sample-title" className="display">Try a plan before you request access.</h2><p>Choose Single Student or Multiple Students. Try a short, per-student intake: living plans, funding, and campus interests change what appears and what is set aside. An illustrated school requirement still takes priority. Fictional, read-only examples—not a live service. The two-student illustration is not a product limit.</p><Link className="button button-primary" href="/sample-plan">Open the sample plan</Link></div><div className="example-panel"><strong>Class of 2027 · Fall 2027</strong><p>Priya compares admissions and aid timing. Mateo explores visits and accessibility contacts. Both are fictional; neither plan uses a school portal or private household data.</p></div></div>
        </section>

        <section id="trust" className="chapter chapter-trust" aria-labelledby="trust-title">
          <div className="site-shell chapter-inner">
            <div className="section-head"><div><p className="eyebrow">Trust</p><h2 id="trust-title" className="display">Know what the plan knows—and what it doesn&apos;t.</h2></div><p>An unpublished date stays unpublished. A household action is not labeled complete just because someone pressed send. A school&apos;s own status and instructions stay in control.</p></div>
            <div className="standard-callout" aria-label="The 12² Standard"><p className="eyebrow">The 12² Standard</p><p className="callout-line">144 checks. Every college. Every applicable term.</p><p className="caption">A named review discipline, not a published checklist or claim that every school is currently covered.</p></div>
            <div className="capability-groups" aria-label="What is shown and what is not yet offered">
              <section><h3>In the public sample</h3><p>Explore a fictional, read-only example with one or two students, different kinds of updates, and source labels. The sample is not a live school feed; approved families set up their own plans.</p></section>
              <section><h3>In development</h3><p>School- and term-specific research, reviewed scholarship awareness, and clearer billing and 529 questions. No eligibility, award, or qualified-expense decision is made here.</p></section>
              <section><h3>Planned</h3><p>Ask Campus Passage, optional message validation, Page Assist for supported public pages, and consent-based reminders. None is interactive or offered for purchase in this sample.</p></section>
            </div>
          </div>
        </section>

        <section id="boundaries" className="chapter chapter-boundaries" aria-labelledby="boundaries-title"><div className="site-shell chapter-inner"><p className="eyebrow">Where the line is today</p><h2 id="boundaries-title" className="display">Your decisions and records stay yours.</h2><p>Campus Passage does not apply to a school, submit or complete forms, sign into a portal, decide eligibility or awards, pay a bill, move 529 funds, or change a school record. Check the school, sponsor, vendor, or plan administrator before acting.</p></div></section>

        <section id="next-step" className="site-shell closing" aria-labelledby="closing-title"><p className="eyebrow">Take a look</p><h2 id="closing-title" className="display">See what a clearer next step could feel like.</h2><p>The public sample is fictional and read-only. Requests for complimentary founding-family access are reviewed by the owner; no availability or response time is promised.</p><div className="actions actions-centered"><Link className="button button-primary" href="/sample-plan">Explore the sample plan</Link><Link className="button button-secondary" href="/request-access">Request access</Link></div></section>
      </main>
      <footer className="site-footer"><div className="site-shell footer-inner"><span>© 2026 Campus Passage concept</span><span>Illustrative examples · Not affiliated with or endorsed by schools</span></div></footer>
    </div>
  );
}
