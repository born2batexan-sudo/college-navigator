import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const proof = [
  ["144", "checks in the 12² Standard"],
  ["One", "household plan across every school"],
  ["National", "school requests researched on demand"],
];

const steps = [
  {
    number: "01",
    title: "Add every school",
    text: "Bring each student’s schools and entering term into one household plan. If a school is missing, request it.",
  },
  {
    number: "02",
    title: "We verify what matters",
    text: "Each school-and-term plan must pass the 12² Standard before verified guidance is released. No source, no certification.",
  },
  {
    number: "03",
    title: "Your family follows one plan",
    text: "See what needs you, what is waiting on a school, and the next deadline that matters—without rebuilding every portal by hand.",
  },
];

export default async function LandingPage() {
  if (await getSessionUser()) redirect("/dashboard");

  return (
    <main className="flex flex-col gap-20 pb-10 sm:gap-28">
      <nav className="flex items-center justify-between border-b border-line pb-5" aria-label="Primary navigation">
        <a href="#top" className="font-display text-xl font-semibold text-ink">College Navigator</a>
        <div className="flex items-center gap-3 text-sm">
          <a href="#how-it-works" className="hidden text-ink/60 hover:text-accent sm:inline">How it works</a>
          <a href="#access" className="hidden text-ink/60 hover:text-accent sm:inline">Access</a>
          <Link href="/login?next=%2Fdashboard" className="rounded-full border border-line bg-white/80 px-4 py-2 font-semibold text-ink transition hover:border-accent/40 hover:text-accent">
            Sign in
          </Link>
        </div>
      </nav>

      <section id="top" className="grid items-center gap-10 lg:grid-cols-[1.08fr_.92fr] lg:gap-16">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">After the application</p>
          <h1 className="mt-5 max-w-3xl font-display text-5xl font-semibold leading-[1.04] text-ink sm:text-6xl lg:text-7xl">
            You hit Submit. Now the real deadlines begin.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-ink/65 sm:text-xl">
            Every college has its own portal, checklist, dates, and definitions. We turn those fragmented workflows into one calm, verified household plan.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/login?next=%2Fdashboard" className="rounded-full bg-accent px-6 py-3 text-center text-sm font-semibold text-white shadow-card transition hover:bg-tealDark">
              Sign in to your plan
            </Link>
            <a href="#how-it-works" className="rounded-full border border-line bg-white/70 px-6 py-3 text-center text-sm font-semibold text-ink transition hover:border-accent/40 hover:text-accent">
              See how it works
            </a>
          </div>
          <p className="mt-4 text-sm text-ink/45">Founding Family access is invitation-only and individually authorized.</p>
        </div>

        <div className="rounded-[2rem] border border-line bg-white/85 p-5 shadow-card sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">One family view</p>
          <h2 className="mt-2 font-display text-2xl font-semibold text-ink">The next deadline that matters</h2>
          <div className="mt-5 rounded-2xl bg-tealDark p-5 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold">Needs attention</p>
            <p className="mt-3 font-display text-xl font-semibold">Confirm the school received your materials</p>
            <p className="mt-1 text-sm text-white/65">Submitted is not the same as received.</p>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            {[
              ["Submitted", "Done"],
              ["Received", "Check"],
              ["Complete", "Waiting"],
            ].map(([label, state]) => (
              <div key={label} className="rounded-xl border border-line bg-paper p-3">
                <p className="font-semibold text-ink">{label}</p>
                <p className="mt-1 text-ink/45">{state}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3" aria-label="Product proof">
        {proof.map(([value, label]) => (
          <div key={value} className="rounded-2xl border border-line bg-white/70 p-6 shadow-card">
            <p className="font-display text-3xl font-semibold text-accent">{value}</p>
            <p className="mt-2 text-sm leading-6 text-ink/60">{label}</p>
          </div>
        ))}
      </section>

      <section id="how-it-works">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">How it works</p>
        <h2 className="mt-3 max-w-3xl font-display text-4xl font-semibold leading-tight text-ink sm:text-5xl">
          Applying to many colleges got easier. We make managing many colleges easier.
        </h2>
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {steps.map((step) => (
            <article key={step.number} className="rounded-2xl border border-line bg-white/75 p-6 shadow-card">
              <p className="text-sm font-semibold text-gold">{step.number}</p>
              <h3 className="mt-4 font-display text-2xl font-semibold text-ink">{step.title}</h3>
              <p className="mt-3 leading-7 text-ink/60">{step.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-8 rounded-[2rem] bg-tealDark p-7 text-white shadow-card sm:p-10 lg:grid-cols-[1fr_.9fr] lg:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gold">The 12² Standard</p>
          <h2 className="mt-3 font-display text-4xl font-semibold leading-tight">144 checks. Every college. Every applicable term.</h2>
          <p className="mt-5 max-w-2xl leading-7 text-white/70">
            Verified guidance is tied to authoritative school sources, an entering term, and a last-checked date. Conflicts and missing evidence are held for review instead of silently reaching families.
          </p>
        </div>
        <div className="rounded-2xl border border-white/15 bg-white/5 p-6">
          <ul className="space-y-4 text-sm text-white/80">
            <li><span className="mr-2 text-gold">✓</span> School-owned sources and checkpoint-level provenance</li>
            <li><span className="mr-2 text-gold">✓</span> “Date not posted yet” instead of a guess</li>
            <li><span className="mr-2 text-gold">✓</span> Certification withheld when evidence is incomplete</li>
            <li><span className="mr-2 text-gold">✓</span> Changed facts refreshed and shared safely across households</li>
          </ul>
        </div>
      </section>

      <section id="access" className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Simple household access</p>
          <h2 className="mt-3 font-display text-4xl font-semibold leading-tight text-ink sm:text-5xl">One upfront fee. One household. One admissions cycle.</h2>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-ink/60">
            Core access covers every student in the household for that admissions cycle and every school in their verified plan. We do not charge per student or per college.
          </p>
          <p className="mt-4 text-sm leading-6 text-ink/50">
            Final launch pricing will be published before paid enrollment opens. Optional inbox connection and browser assistance are separate add-ons after the core product is stable.
          </p>
        </div>
        <div className="rounded-[2rem] border border-line bg-white/85 p-7 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gold">Founding Family access</p>
          <h3 className="mt-3 font-display text-3xl font-semibold text-ink">Up to 25 authorized households</h3>
          <p className="mt-4 leading-7 text-ink/60">
            Complimentary early access is invitation-only, household-specific, expiring, and individually approved. There is no public or shareable free-access code, and no card is required for approved complimentary access.
          </p>
          <p className="mt-4 rounded-xl bg-paper p-4 text-sm leading-6 text-ink/60">
            Complimentary and paid households receive the same verification standard. Free access never means lower-confidence guidance.
          </p>
        </div>
      </section>

      <section className="rounded-[2rem] border border-line bg-white/75 p-8 text-center shadow-card sm:p-12">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Many schools. One calm plan.</p>
        <h2 className="mx-auto mt-3 max-w-3xl font-display text-4xl font-semibold leading-tight text-ink sm:text-5xl">Know what matters next without living in six different portals.</h2>
        <Link href="/login?next=%2Fdashboard" className="mt-7 inline-block rounded-full bg-accent px-7 py-3 text-sm font-semibold text-white transition hover:bg-tealDark">
          Sign in
        </Link>
      </section>

      <footer className="flex flex-col gap-3 border-t border-line pt-6 text-sm text-ink/45 sm:flex-row sm:items-center sm:justify-between">
        <p>Working product name. J-Dock LLC is the legal entity.</p>
        <p>Process, timing, and logistics only. Essays are never read, stored, or scored.</p>
      </footer>
    </main>
  );
}
