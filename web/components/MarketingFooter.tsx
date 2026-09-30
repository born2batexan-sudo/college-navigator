import Link from "next/link";
import RouteLockup from "@/components/RouteLogo";

export default function MarketingFooter() {
  return (
    <footer className="site-footer">
      <div className="site-shell footer-inner">
        <RouteLockup variant="footer" />
        <p className="footer-legal">© 2026 Campus Passage · Not affiliated with or endorsed by any college or university. Examples marked &apos;illustrative&apos; are fictional.</p>
        <nav className="footer-links" aria-label="Footer">
          <Link href="/account/mail-privacy">Connected-mail privacy</Link>
          <span aria-hidden="true">·</span>
          <Link href="/request-access">Request access</Link>
          <span aria-hidden="true">·</span>
          <Link href="/login?next=%2Fdashboard">Log in</Link>
        </nav>
      </div>
    </footer>
  );
}
