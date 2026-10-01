import Link from "next/link";
import RouteLockup from "@/components/RouteLogo";

export default function MarketingFooter() {
  return (
    <footer className="site-footer">
      <div className="site-shell footer-inner">
        <RouteLockup variant="footer" />
        <p className="footer-legal">© 2026 Campus Passage · Not affiliated with or endorsed by any college or university. Illustrative examples are read-only demonstrations, not live school information or verified sources.</p>
        <nav className="footer-links" aria-label="Footer">
          <Link href="/account/mail-privacy">Email connectivity — Coming Soon</Link>
          <span aria-hidden="true">·</span>
          <Link href="/login?next=%2Fonboarding">Start Now</Link>
          <span aria-hidden="true">·</span>
          <Link href="/login?next=%2Fdashboard">Log in</Link>
        </nav>
      </div>
    </footer>
  );
}
