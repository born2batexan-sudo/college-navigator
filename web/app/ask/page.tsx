import Link from "next/link";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingHeader from "@/components/MarketingHeader";
import PublicAskForm from "./PublicAskForm";

export default function PublicAskPage() {
  return (
    <div className="campus-page">
      <a className="skip-link" href="#main">Skip to main content</a>
      <MarketingHeader current="ask" />
      <main id="main" className="site-shell section" aria-labelledby="ask-title">
        <p className="eyebrow">Campus Passage · Public product FAQ</p>
        <h1 id="ask-title" className="display">Ask Campus Passage</h1>
        <p className="lead">Ask about what Campus Passage does, the full household experience and Start Now flow, privacy and access, official sources, multiple students, feedback, product boundaries, or optional Email Connectivity — Coming Soon.</p>
        <div className="callout">
          <b>Public Ask is not a college research tool.</b> It cannot look up a particular school, deadlines, scholarships, eligibility, personalized advice, portal actions, payments, or household records. For school-specific research, choose Start Now and continue in the signed-in, onboarded household experience.
        </div>
        <div className="actions">
          <Link className="button button-primary" href="/login?next=%2Fonboarding">Start Now</Link>
          <Link className="button button-secondary" href="/login?next=%2Fask%2Fresearch">Sign in for school-specific Ask</Link>
        </div>
        <section className="mt-8 max-w-3xl" aria-label="Ask a general Campus Passage question">
          <PublicAskForm />
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
