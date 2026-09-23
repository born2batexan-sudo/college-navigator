import Link from "next/link";

/** Provisional Route mark; the adjacent wordmark gives the link its name. */
export function RouteMark() {
  return (
    <svg className="brand-mark brand-mark-svg" viewBox="0 0 48 48" width="32" height="32" aria-hidden="true" focusable="false">
      <circle className="brand-mark-boundary" cx="24" cy="24" r="21" />
      <path className="brand-route brand-route-coral" d="M10 34 C14 33 18 30 23 27" />
      <path className="brand-route brand-route-gold" d="M9 23 C14 23 18 24 23 27" />
      <path className="brand-route brand-route-teal" d="M11 13 C16 16 19 21 23 27" />
      <path className="brand-route brand-route-violet" d="M23 27 C27 25 31 21 37 14" />
      <circle className="brand-route-node" cx="23" cy="27" r="2.2" />
    </svg>
  );
}

export default function MarketingHeader({ current }: { current: "overview" | "sample" }) {
  return (
    <header className="site-header">
      <div className="utility-bar"><strong>Coming Soon · Interactive Preview</strong> — Fictional data only. This sandbox is not enrollment in a live service.</div>
      <div className="site-shell topbar">
        <Link className="brand" href="/" aria-label="Campus Passage home"><RouteMark />Campus Passage</Link>
        <nav className="navlinks" aria-label="Primary navigation">
          <Link aria-current={current === "overview" ? "page" : undefined} href="/">Overview</Link>
          <Link href="/#why-it-matters">Why it matters</Link>
          <Link href="/#how-it-helps">How it helps</Link>
          <Link aria-current={current === "sample" ? "page" : undefined} href="/sample-plan">Sample plan</Link>
          <Link href="/#trust">Trust</Link>
          <Link href="/login?next=%2Fdashboard" className="login-link">Log in</Link>
          <Link href="/request-access" className="nav-cta">Request access</Link>
        </nav>
      </div>
    </header>
  );
}
