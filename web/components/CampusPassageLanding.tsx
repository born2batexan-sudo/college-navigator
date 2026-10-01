import Image from "next/image";
import Link from "next/link";
import FaqAccordion, { type FaqItem } from "@/components/FaqAccordion";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingHeader from "@/components/MarketingHeader";

const essentials = [
  ["What it is", "The specific task or update."],
  ["Whose move", "A family action, a school-side wait, or a date not yet published."],
  ["By when", "Only a date or window the source actually gives."],
  ["What's at stake", "Why this step matters, without invented urgency."],
] as const;

const pills = ["Application deadlines", "FAFSA & CSS Profile", "Scholarships", "Housing & dorms", "Deposits", "Immunization records", "Orientation", "Meal plans", "Parking permits", "Greek life recruitment", "Move-in day", "The first bill"] as const;

const steps = [
  ["Add your students and schools.", "Create a separate path for each student and add up to ten unique colleges to your household plan for the current admissions cycle."],
  ["Tell us what matters to your family.", "Answer a few questions about housing, commuting, financial aid, scholarships, accessibility, campus life, and other priorities. Campus Passage uses those answers to surface what is relevant without hiding school requirements."],
  ["Follow one clear, verified plan.", "Campus Passage researches official public sources and organizes the findings by student, school, and term—showing what needs attention, whose move it is, and where the information came from."],
] as const;

/** The 12² Standard: 4 phases x 3 themes, each "up to 12 checks". Example checks are the mockup's three per theme. */
const phases = [
  { name: "Getting in", tiles: [
    { t: "Admissions", b: "Published deadlines by application path.", items: ["Deadline by application path", "Test policy", "Final transcript requirement"] },
    { t: "Aid", b: "Priority dates and paperwork, before they cost you.", items: ["FAFSA / CSS Profile priority date", "Verification document requests", "Aid appeal process"] },
    { t: "Scholarships", b: "Scholarship dates and renewal information.", items: ["Institutional scholarship deadline", "Separate application required", "Renewal requirements"] },
  ] },
  { name: "Choosing and planning", tiles: [
    { t: "Enrollment", b: "Deposits, reply dates, and placement tests, in order.", items: ["Deposit deadline and refundability", "Commitment / reply date", "Placement test requirements"] },
    { t: "Billing and 529", b: "Know when the first school bill lands and what it covers.", items: ["First bill release and due date", "Tuition installment enrollment window", "529 / third-party billing instructions"] },
    { t: "Housing", b: "Dorm applications and deposits, on time.", open: true, items: ["First-year residence requirement", "Housing application window and deposit", "Room / roommate selection timeline"] },
  ] },
  { name: "Getting started", tiles: [
    { t: "Health and access", b: "Immunization forms, insurance waivers, accommodations.", items: ["Immunization records deadline", "Health insurance waiver deadline", "Accommodations registration"] },
    { t: "Orientation", b: "Sign-ups and advising, before registration opens.", items: ["Orientation session registration", "Advising before course registration", "Family orientation program"] },
    { t: "Campus logistics", b: "Parking permits, ID photos, and move-in day.", items: ["Student ID photo upload", "Parking permit process", "Move-in time-slot sign-up"] },
  ] },
  { name: "Belonging and beyond", tiles: [
    { t: "Student life", b: "Meal plans, Greek recruitment, and finding their people.", items: ["Meal plan selection", "Greek life recruitment timeline", "Learning community application"] },
    { t: "Family experience", b: "Your access, your weekends, your updates.", items: ["FERPA / parent proxy access", "Family weekend dates", "Parent communications sign-up"] },
    { t: "Career and progression", b: "Majors, internships, and what comes next.", items: ["Career center onboarding", "Major declaration timeline", "Internship / co-op eligibility timing"] },
  ] },
] as const;

/**
 * Public FAQs for the self-service journey.
 */
const faqItems: readonly FaqItem[] = [
  { id: "faq-track", question: "How do I keep track of college application deadlines for my student?", answer: "Add each school your student is considering. Campus Passage organizes verified application, financial aid, scholarship, housing, and enrollment information in one plan, shows whose move each step is, and labels what is still under review or not yet published." },
  { id: "faq-spreadsheet", question: "Is this better than a college application spreadsheet?", answer: "A spreadsheet only knows what you type into it. Campus Passage reviews up to 144 checks per school and links verified findings to official sources, while unresolved checks remain clearly labeled." },
  { id: "faq-accepted", question: "What do we need to do after my student is accepted?", answer: "Enrollment deposits, housing applications, financial aid verification, immunization records, orientation, and the first bill may all matter. Campus Passage keeps the applicable verified steps together through move-in planning." },
  { id: "faq-missing", question: "How will I know if something is missing from my student's application?", answer: "Campus Passage organizes findings from official public sources and clearly labels unresolved or unpublished information. School portals and official instructions remain the authority. Email connectivity is Coming Soon and requires separate consent." },
  { id: "faq-portal", question: "Do you need my student's school portal login?", answer: "No. Never. Campus Passage doesn't sign into school portals." },
  { id: "faq-submit", question: "Does it apply or submit anything for me?", answer: "No. You stay in control, and the school's official instructions are always the authority." },
  { id: "faq-schools", question: "Which schools can I add, and can I track more than one student?", answer: "A household plan supports up to 10 unique colleges for the current admissions cycle. Eligible students sharing the same high-school graduation year and application cycle can be in one household. Every student, school, and term stays separate, and review depth is shown honestly." },
  { id: "faq-cost", question: "How do I get started?", answer: "Select Start Now, verify your email address, and set up your household. You can use the complete plan for the current admissions cycle without requesting an invitation." },
  { id: "faq-counselor", question: "Does it replace our school counselor?", answer: "No. It helps your family bring better questions to your counselor." },
  { id: "faq-data", question: "What happens to my data if I leave?", answer: "Your household records remain subject to Campus Passage's privacy and deletion controls. If you choose the Coming Soon email connectivity feature later, you will have controls to disconnect inbox access and delete connected-mail data." },
];

function SectionStart() {
  return <div className="actions"><Link className="button button-primary" href="/login?next=%2Fonboarding">Start Now</Link></div>;
}

export default function CampusPassageLanding() {
  return (
    <div className="campus-page">
      <a className="skip-link" href="#main">Skip to main content</a>
      <MarketingHeader current="overview" />
      <main id="main">
        <section id="top" className="hero" aria-labelledby="hero-title">
          <div className="hero-media">
            <Image src="/images/campus-passage-hero.webp" alt="Illustrative campus photography — not a specific school." fill priority sizes="100vw" className="hero-media-img" />
          </div>
          <div className="site-shell hero-inner">
            <div className="hero-copy">
              <p className="eyebrow">Your College Journey Tracker</p>
              <h1 id="hero-title" className="display hero-title">Be their parent, not their project manager.</h1>
              <p className="hero-subhead display">Every college step, in one plan, with whose move it is.</p>
              <p className="lede">From the first application to move-in day, Campus Passage brings verified dates, school-side waits, and family next steps into one clear plan.</p>
              <div className="actions"><Link className="button button-primary" href="/login?next=%2Fonboarding">Start Now</Link><Link className="button button-secondary" href="/sample-plan">Try the sample plan →</Link></div>
              <ul className="chips" aria-label="What to expect"><li className="chip">No portal passwords</li><li className="chip">Official sources on verified findings</li><li className="chip">Up to 144 checks per school</li><li className="chip">Per student, per school, per term</li></ul>
            </div>
            <aside className="hero-plan-card" aria-label="Illustrative example of different kinds of updates">
              <ol className="hero-plan-list">
                <li><span className="hero-plan-dot dot-action" aria-hidden="true" /><span className="hero-plan-text"><strong>Fictional transcript step</strong><small>Family action · Fall 2027</small><small><label><input type="checkbox" disabled /> Completed (sample only)</label></small><small>Official destination unavailable in this fictional example</small></span></li>
                <li><span className="hero-plan-dot dot-date" aria-hidden="true" /><span className="hero-plan-text"><strong>Housing date</strong><small>Date window</small></span></li>
                <li><span className="hero-plan-dot dot-waiting" aria-hidden="true" /><span className="hero-plan-text"><strong>Waiting on school</strong><small>School-side wait</small></span></li>
                <li><span className="hero-plan-dot dot-aware" aria-hidden="true" /><span className="hero-plan-text"><strong>Scholarship listing</strong><small>Awareness</small></span></li>
              </ol>
              <p className="hero-plan-caption">Illustrative example</p>
            </aside>
          </div>
        </section>

        <section id="why-it-matters" className="section" aria-labelledby="why-title">
          <div className="site-shell">
            <p className="eyebrow">Why it matters</p>
            <h2 id="why-title" className="display">Senior year shouldn&apos;t feel like a second job.</h2>
            <p className="lead">It&apos;s 11 p.m. You&apos;re checking a portal, searching an inbox, and updating a spreadsheet no one else touches. Did the housing deposit go in? Is that scholarship renewable? When does parking open?</p>
            <p className="lead">Every school has dozens of steps, and they&apos;re never in the same place twice. Multiply that by every school on the list.</p>
            <ul className="pills" aria-label="Steps families track">{pills.map((pill) => <li key={pill} className="pill">{pill}</li>)}</ul>
            <div className="callout"><b>A missed step can cost a housing choice, an aid window, or a deposit.</b> And a wait on the school&apos;s side isn&apos;t your deadline. You should be able to tell the difference at a glance.</div>
            <SectionStart />
          </div>
        </section>

        <section id="how" className="section" aria-labelledby="how-title">
          <div className="site-shell">
            <p className="eyebrow">How it works</p>
            <h2 id="how-title" className="display">How to keep track of college deadlines in one place.</h2>
            <ol className="grid3">{steps.map(([title, text], index) => <li key={title} className="card"><span className="num" aria-hidden="true">{index + 1}</span><h3>{title}</h3><p>{text}</p></li>)}</ol>
            <figure className="guidance-panel"><Image src="/images/campus-passage-guidance.webp" alt="A parent and student reviewing a laptop together at a table" width={1536} height={864} sizes="(min-width: 860px) 720px, 100vw" className="guidance-panel-img" /></figure>
            <h3 className="display subhead">Every step answers four questions.</h3>
            <ol className="grid4">{essentials.map(([title, text], index) => <li key={title} className="card"><span className="card-num" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><h4>{title}</h4><p>{text}</p></li>)}</ol>
            <p className="fine">Only real dates. No invented urgency. The official source is always one click away.</p>
            <SectionStart />
          </div>
        </section>

        <section id="ask-campus-passage" className="section" aria-labelledby="ask-campus-passage-title">
          <div className="site-shell">
            <p className="eyebrow">Ask Campus Passage</p>
            <h2 id="ask-campus-passage-title" className="display">Questions about how Campus Passage works?</h2>
            <p className="lead">Ask general questions about the product, privacy, official sources, and getting started. Public Ask does not research a particular college, answer school-specific deadlines or scholarships, determine eligibility, or access household records.</p>
            <div className="actions"><Link className="button button-secondary" href="/ask">Ask Campus Passage</Link><Link className="button button-primary" href="/login?next=%2Fonboarding">Start Now for your household plan</Link></div>
          </div>
        </section>

        <section id="standard" className="section" aria-labelledby="standard-title">
          <div className="site-shell">
            <p className="eyebrow">The 12² Standard</p>
            <div className="big144" aria-hidden="true">12²</div>
            <h2 id="standard-title" className="display standard-title">Up to 144 checks per school, per term.</h2>
            <p className="lead">We review each school across 12 parts of the college journey, from admissions and aid to housing, orientation, and career, with up to 12 checks in each. That&apos;s how the step buried on a housing page or in a billing FAQ still reaches your plan.</p>
            <div className="callout"><b>Why &quot;up to&quot;?</b> Every campus is different. Some checks don&apos;t apply to a school, and some details haven&apos;t been published yet. When that happens, your plan says so plainly instead of guessing or padding the list.</div>
            <div className="phases">
              {phases.map((phase) => (
                <div key={phase.name} className="phase">
                  <h3 className="phase-name">{phase.name}</h3>
                  {phase.tiles.map((tile) => (
                    <details key={tile.t} className="tile" open={"open" in tile ? true : undefined}>
                      <summary><span className="t">{tile.t}</span><span className="b">{tile.b}</span><span className="u">UP TO 12 CHECKS</span></summary>
                      <ul>{tile.items.map((item) => <li key={item}>{item}</li>)}</ul>
                    </details>
                  ))}
                </div>
              ))}
            </div>
            <div className="tally"><b>Nothing is padded or guessed.</b> Each check is shown as verified, under review, not yet published, not applicable, conflicting, or withheld.</div>
            <p className="fine">A completed check means the item was reviewed against the school&apos;s official source. It is not a guarantee of eligibility, admission, aid, or any outcome.</p>
            <SectionStart />
          </div>
        </section>

        <section id="the-journey" className="section" aria-labelledby="journey-title">
          <div className="site-shell split">
            <div><p className="eyebrow">Built around each student</p><h2 id="journey-title" className="display">One student or several. Every school stays distinct.</h2><p className="lead">Answers about housing, funding, and interests change what appears. A commuter doesn&apos;t wade through optional dorm steps, but a school&apos;s requirements always stay visible. Siblings, schools, and terms never blur together.</p></div>
            <Image src="/images/campus-passage-pathways.webp" alt="Students walking along different paths across a campus quad. Illustrative campus photography — not a specific school." width={1536} height={864} sizes="(min-width: 1120px) 536px, 100vw" className="split-img" />
            <SectionStart />
          </div>
        </section>

        <section id="sample" className="section" aria-labelledby="sample-title">
          <div className="site-shell">
            <p className="eyebrow">See an example</p>
            <h2 id="sample-title" className="display">Try a plan before you get started.</h2>
            <p className="lead">Pick one student or two, answer a few quick questions, and watch the plan change: what&apos;s relevant, what&apos;s set aside, and whose move each step is.</p>
            <p><Link className="button button-primary" href="/sample-plan">Open the sample plan →</Link></p>
            <p className="fine">Meet Priya and Mateo, two fictional Class of 2027 students.</p>
            <SectionStart />
          </div>
        </section>

        <section id="trust" className="section" aria-labelledby="trust-title">
          <div className="site-shell">
            <p className="eyebrow">Trust</p>
            <h2 id="trust-title" className="display">Know what the plan knows, and what it doesn&apos;t.</h2>
            <p className="lead">An unpublished date stays unpublished. A household action is not labeled complete just because someone pressed send. A school&apos;s own status and instructions stay in control.</p>
            <p className="lead">Your plan helps your family ask your school counselor better questions. It doesn&apos;t replace them.</p>
            <SectionStart />
          </div>
        </section>

        <section id="boundaries" className="section" aria-labelledby="boundaries-title">
          <div className="site-shell">
            <p className="eyebrow">Where the line is</p>
            <h2 id="boundaries-title" className="display">Your decisions and records stay yours.</h2>
            <p className="lead">Campus Passage does not apply to a school, submit or complete forms, sign into a portal, decide eligibility or awards, initiate a bill transaction, move 529 funds, or change a school record. Check the school, sponsor, vendor, or plan administrator before acting.</p>
            <p className="lead"><b>Email Connectivity — Coming Soon.</b> An optional future feature may help families incorporate sender-scoped college updates into their plans—with explicit consent and controls to disconnect and delete connected-mail data.</p>
            <SectionStart />
          </div>
        </section>

        <section id="founders" className="section" aria-labelledby="founders-title">
          <div className="site-shell">
            <p className="eyebrow">Who&apos;s behind it</p>
            <h2 id="founders-title" className="display">Created by families who have been there.</h2>
            <p className="lead">Campus Passage was created by two families who have been where you are—trying to keep track of deadlines, requirements, emails, housing details, financial-aid steps, and countless other tasks scattered across different websites and systems.</p>
            <p className="lead">We experienced firsthand how fragmented and overwhelming the college onboarding season can become. Important information was often difficult to find, easy to miss, and rarely organized around what a family actually needed to do next.</p>
            <p className="lead">So we built Campus Passage to bring greater clarity and order to the journey—helping families understand what matters, what&apos;s coming, and where to find the official information they need.</p>
            <p className="lead">We&apos;re not outside observers. We&apos;re families who faced the same confusion and believed there had to be a better way.</p>
            <SectionStart />
          </div>
        </section>

        <section id="faq" className="section" aria-labelledby="faq-title">
          <div className="site-shell">
            <p className="eyebrow">Questions</p>
            <h2 id="faq-title" className="display">What parents ask us.</h2>
            <FaqAccordion items={faqItems} />
            <SectionStart />
          </div>
        </section>

        <section id="next-step" className="section final" aria-labelledby="closing-title">
          <div className="site-shell">
            <p className="eyebrow">Your next step</p>
            <h2 id="closing-title" className="display">Senior year happens once. Spend it with them.</h2>
            <p className="lead">Let Campus Passage carry the checklist. Verify your email, set up your household, and start planning.</p>
            <div className="actions"><Link className="button button-primary" href="/login?next=%2Fonboarding">Start Now</Link><Link className="button button-secondary" href="/sample-plan">Explore the sample plan</Link></div>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
