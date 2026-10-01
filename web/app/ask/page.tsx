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
        <p className="eyebrow">Campus Passage · Explore the service</p>
        <h1 id="ask-title" className="display">Ask about Campus Passage</h1>
        <p className="lead">Wondering how the Passage works? Ask about getting started, building a household plan, official sources, privacy, or the journey from applications to move-in.</p>
        <div className="callout">
          <b>Start with the big picture here.</b> Inside your signed-in Passage, Ask about your journey draws on certified official sources and citations for your tracked student, college, and term when available.
        </div>
        <div className="actions">
          <Link className="button button-primary" href="/login?next=%2Fonboarding">Start Now</Link>
          <Link className="button button-secondary" href="/login?next=%2Fask%2Fresearch">Sign in to ask about your journey</Link>
        </div>
        <section className="mt-8 max-w-3xl" aria-label="Ask about Campus Passage and the service">
          <PublicAskForm />
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
