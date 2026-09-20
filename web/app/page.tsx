import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const schools = [
  ["AL", "Alabama"],
  ["AR", "Arkansas"],
  ["OU", "Oklahoma"],
  ["UT", "UT Austin"],
  ["AM", "Texas A&M"],
  ["AZ", "Arizona"],
  ["UD", "UT Dallas"],
];

const stakes = [
  {
    title: "Housing",
    text: "Applications open and close on each school’s schedule. Miss the window and a student may be choosing from what is left—or scrambling off campus.",
    note: "One school’s housing date can arrive months before another’s.",
  },
  {
    title: "Aid and scholarships",
    text: "Some awards must be accepted by a deadline, and some require another form first. A quiet lapse can cost real money.",
    note: "Aid, scholarship and billing dates rarely live in one place.",
  },
  {
    title: "Enrollment holds",
    text: "A missing immunization record, transcript or score can hold registration. It is often the small item nobody knew to watch.",
    note: "One “missing item” in a portal a family rarely opens.",
  },
];

const plan = [
  ["One plan across every school", "Steps, forms and dates from every school on the family’s list, sorted by what is due first."],
  ["It knows what is already done", "Submitted, Received and Complete are different. We show the current state and the one thing to do next."],
  ["Straight answers when a date is not out", "We say “Date not posted yet” and may show last year’s date for reference. We never guess."],
  ["One plan for parent and student", "Everyone works from the same plan without sharing school-portal passwords."],
];

const steps = [
  ["1", "Create the household plan", "Add every student, entering term and school in one place."],
  ["2", "We verify every school", "Each school-and-term record is checked against authoritative sources before guidance is released."],
  ["3", "Follow what matters next", "The household sees the next deadline, what is waiting on a school and what is already complete."],
];

export default async function LandingPage() {
  if (await getSessionUser()) redirect("/dashboard");

  return (
    <main className="flex flex-col gap-20 pb-10 sm:gap-28">
      <div className="-mx-4 -mt-6 bg-accent/10 px-4 py-2 text-center text-xs text-accent sm:-mx-6 sm:-mt-9">
        Staging preview for review. Sample names, dates and counts are illustrative.
      </div>

      <nav className="-mt-16 flex items-center justify-between border-b border-line pb-5 sm:-mt-24" aria-label="Primary navigation">
        <a href="#top" className="flex items-center gap-3 font-display text-xl font-semibold text-ink">
          <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-accent text-sm text-accent">◇</span>
          College Navigator
        </a>
        <div className="flex items-center gap-4 text-sm">
          <a href="#how-it-works" className="hidden font-medium text-ink/70 hover:text-accent md:inline">How it works</a>
          <a href="#pricing" className="hidden font-medium text-ink/70 hover:text-accent md:inline">Pricing</a>
          <Link href="/login?next=%2Fdashboard" className="font-semibold text-ink hover:text-accent">Log in</Link>
          <Link href="/login?next=%2Fonboarding" className="hidden rounded-lg bg-accent px-4 py-2.5 font-semibold text-white hover:bg-tealDark sm:inline">Get started</Link>
        </div>
      </nav>

      <section id="top" className="grid items-center gap-10 lg:grid-cols-[1.08fr_.92fr] lg:gap-16">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">For families with a college-bound student</p>
          <h1 className="mt-5 max-w-3xl font-display text-5xl font-semibold leading-[1.04] text-ink sm:text-6xl lg:text-7xl">
            You hit Submit. Now the real deadlines begin.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-ink/65 sm:text-xl">
            Every college now runs its own portal, checklist and deadlines. We put all of it into one verified plan for the whole household—and tell you what to do next.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/login?next=%2Fonboarding" className="rounded-lg bg-accent px-7 py-3.5 text-center font-semibold text-white shadow-card transition hover:bg-tealDark">Build your household plan</Link>
            <a href="#how-it-works" className="rounded-lg border border-line bg-white/80 px-7 py-3.5 text-center font-semibold text-ink transition hover:border-accent/40 hover:text-accent">See how it works</a>
          </div>
          <p className="mt-4 text-sm text-ink/50">One household. Every student. Every verified school. One admissions cycle.</p>
        </div>

        <div>
          <p className="mb-3 inline-block rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-ink/60">Example household</p>
          <div className="rounded-t-2xl bg-tealDark p-5 text-white shadow-card">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold">Next deadline that matters</p>
                <p className="mt-2 text-sm text-white/75">Texas A&amp;M · official transcript · Oct 1</p>
              </div>
              <p className="font-display text-5xl font-semibold">13<span className="ml-1 font-sans text-sm font-normal">days</span></p>
            </div>
          </div>
          <div className="rounded-b-2xl border border-t-0 border-line bg-white p-6 shadow-card">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/60">Texas A&amp;M</p>
              <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-amber-800">Needs attention</span>
            </div>
            <h2 className="mt-5 font-display text-2xl font-semibold leading-tight">Your application says Submitted. Texas A&amp;M says otherwise.</h2>
            <div className="mt-6 space-y-0">
              {[
                ["✓", "Submitted", "Your application · Sep 12", "bg-accent text-white"],
                ["×", "Missing item", "Official high school transcript · school portal", "bg-amber-700 text-white"],
                ["", "Complete", "Application ready for review", "border-2 border-line text-ink/30"],
              ].map(([mark, label, detail, style], index) => (
                <div key={label} className="relative flex gap-4 pb-5 last:pb-0">
                  {index < 2 && <span className="absolute left-3 top-7 h-[calc(100%-1rem)] w-px bg-line" />}
                  <span className={`relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-semibold ${style}`}>{mark}</span>
                  <div><p className="font-semibold text-ink">{label}</p><p className="mt-1 text-sm text-ink/55">{detail}</p></div>
                </div>
              ))}
            </div>
            <p className="mt-5 rounded-xl bg-orange-100 p-4 text-sm leading-6 text-amber-900">If it is not received by <strong>Oct 1</strong>, the application may not be reviewed.</p>
          </div>
          <p className="mt-3 text-xs text-ink/50">Sample household. Names, dates and counts are illustrative.</p>
        </div>
      </section>

      <section className="grid gap-5 border-y border-line py-7 md:grid-cols-3" aria-label="Product promises">
        {[
          ["✓", "Every date checked against the school’s own site.", "Each step shows where it came from."],
          ["☷", "144 checkpoints per school.", "Housing, aid, billing, health, orientation and more."],
          ["▢", "No school-portal passwords.", "We never sign in to a school as you."],
        ].map(([icon, title, text]) => (
          <div key={title} className="flex gap-3"><span className="text-xl text-accent">{icon}</span><p className="text-sm leading-6"><strong>{title}</strong> <span className="text-ink/65">{text}</span></p></div>
        ))}
      </section>

      <section className="grid gap-10 lg:grid-cols-[.9fr_1.1fr] lg:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">The part nobody owns</p>
          <h2 className="mt-3 font-display text-4xl font-semibold leading-tight sm:text-5xl">Applying got easier. Then families were on their own.</h2>
          <p className="mt-6 leading-7 text-ink/65">The moment a student presses Submit, one tidy application becomes a different to-do list at every school: housing here, a missing transcript there, a scholarship acceptance date buried in a PDF.</p>
          <p className="mt-4 leading-7 text-ink/65">Each school names things differently and emails from a different address. Nobody keeps the whole picture—except, usually, a parent with a spreadsheet at 11 p.m.</p>
        </div>
        <div className="rounded-2xl border border-line bg-white/75 p-6 shadow-card">
          <div className="rounded-xl bg-accent/10 p-5"><p className="text-xs font-semibold uppercase tracking-wider text-accent">Before Submit</p><p className="mt-2 font-display text-2xl font-semibold">One application. One place.</p></div>
          <div className="my-3 text-center text-2xl text-ink/30">↓</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {schools.slice(0, 6).map(([initials, name]) => <div key={name} className="rounded-xl border border-line bg-paper p-3"><span className="font-display text-xl font-semibold text-accent">{initials}</span><p className="mt-1 text-sm font-semibold">{name}</p><p className="text-xs text-ink/45">own portal</p></div>)}
          </div>
          <p className="mt-5 text-center text-sm font-medium text-ink/60">Six schools means six portals, six checklists and six sets of dates that never line up.</p>
        </div>
      </section>

      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">What is at stake</p>
        <h2 className="mt-3 max-w-3xl font-display text-4xl font-semibold leading-tight sm:text-5xl">The things that slip are small. What they cost is not.</h2>
        <div className="mt-9 grid gap-5 lg:grid-cols-3">
          {stakes.map((item) => <article key={item.title} className="rounded-2xl border border-line bg-white/75 p-6 shadow-card"><h3 className="font-display text-2xl font-semibold">{item.title}</h3><p className="mt-3 leading-7 text-ink/65">{item.text}</p><p className="mt-5 border-t border-line pt-4 text-sm font-medium text-accent">{item.note}</p></article>)}
        </div>
      </section>

      <section className="grid gap-10 lg:grid-cols-[.9fr_1.1fr] lg:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">One family. One action plan.</p>
          <h2 className="mt-3 font-display text-4xl font-semibold leading-tight sm:text-5xl">Everything after Submit, in one place, in the order it is due.</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {plan.map(([title, text]) => <article key={title} className="rounded-2xl border border-line bg-white/70 p-5"><h3 className="font-display text-xl font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-ink/60">{text}</p></article>)}
        </div>
      </section>

      <section className="rounded-[2rem] bg-tealDark p-7 text-white shadow-card sm:p-10">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gold">Researched, not guessed</p>
            <h2 className="mt-3 font-display text-4xl font-semibold leading-tight sm:text-5xl">Every school is checked to the 12² Standard.</h2>
            <p className="mt-5 leading-7 text-white/70">We inspect 144 checkpoints across admissions, aid, housing, billing, health, orientation and more. Each fact is tied to an authoritative source, entering term and last-checked date.</p>
            <p className="mt-4 leading-7 text-white/70">If a school has not published something yet, we say so. Uncertain information is held for review instead of silently reaching families.</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gold">Fall 2027 demonstration library</p>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {schools.map(([initials, name]) => <div key={name} className="rounded-xl border border-white/15 bg-white/5 p-3"><span className="font-display text-xl font-semibold text-gold">{initials}</span><p className="mt-1 text-sm font-semibold">{name}</p><p className="mt-1 text-xs text-white/55">Research record available</p></div>)}
            </div>
            <p className="mt-4 text-xs leading-5 text-white/55">Demo records are being refreshed before customer use. “Date not posted yet” is shown wherever the school has not published the applicable term.</p>
          </div>
        </div>
      </section>

      <section id="how-it-works">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">How it works</p>
        <h2 className="mt-3 max-w-3xl font-display text-4xl font-semibold leading-tight sm:text-5xl">From Submitted to settled, without rebuilding every portal by hand.</h2>
        <div className="mt-9 grid gap-5 lg:grid-cols-3">
          {steps.map(([number, title, text]) => <article key={number} className="rounded-2xl border border-line bg-white/75 p-6 shadow-card"><p className="text-sm font-semibold text-gold">{number}</p><h3 className="mt-4 font-display text-2xl font-semibold">{title}</h3><p className="mt-3 leading-7 text-ink/60">{text}</p></article>)}
        </div>
      </section>

      <section id="pricing" className="grid gap-8 rounded-[2rem] border border-line bg-white/80 p-7 shadow-card sm:p-10 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Simple household access</p>
          <h2 className="mt-3 font-display text-4xl font-semibold leading-tight sm:text-5xl">One upfront fee. One household. One admissions cycle.</h2>
          <p className="mt-5 text-lg leading-8 text-ink/65">Core access covers every student in the household and every school in the verified plan. We do not charge per student or per college.</p>
          <p className="mt-4 text-sm leading-6 text-ink/50">Final pricing will be published before paid enrollment opens. Inbox connection and browser assistance are optional, separately priced add-ons after the core product is stable.</p>
        </div>
        <div className="rounded-2xl bg-paper p-6">
          <p className="text-sm font-semibold text-accent">Household access includes</p>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-ink/70">
            <li>✓ All students in the household for the cycle</li>
            <li>✓ Every verified school in the household plan</li>
            <li>✓ The same 12² verification standard for every family</li>
            <li>✓ No automatic renewal claim</li>
          </ul>
          <Link href="/login?next=%2Fonboarding" className="mt-6 block rounded-lg bg-accent px-6 py-3 text-center font-semibold text-white hover:bg-tealDark">Get started</Link>
          <p className="mt-4 text-xs leading-5 text-ink/45">A small number of invitation-only early-adopter households may receive complimentary access. Offers are household-specific, expiring and non-shareable.</p>
        </div>
      </section>

      <section className="rounded-[2rem] bg-tealDark px-7 py-12 text-center text-white shadow-card sm:px-12 sm:py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">Many schools. One calm plan.</p>
        <h2 className="mx-auto mt-3 max-w-3xl font-display text-4xl font-semibold leading-tight sm:text-5xl">Submit was the easy part. Let us handle what comes next.</h2>
        <Link href="/login?next=%2Fonboarding" className="mt-7 inline-block rounded-lg bg-white px-7 py-3.5 font-semibold text-tealDark hover:bg-paper">Build your household plan</Link>
      </section>

      <footer className="flex flex-col gap-3 border-t border-line pt-6 text-sm text-ink/45 sm:flex-row sm:items-center sm:justify-between">
        <p>© 2026 College Navigator. Working name. Not affiliated with any college or application service.</p>
        <div className="flex gap-5"><a href="#how-it-works">How it works</a><a href="#pricing">Pricing</a><Link href="/login">Log in</Link></div>
      </footer>
    </main>
  );
}
