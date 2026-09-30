import Link from "next/link";
import HeaderNav from "@/components/HeaderNav";
import RouteLockup from "@/components/RouteLogo";

/** Banner (scrolls away) + sticky header. Banner carries the mockup's founding-family offer, phrased per household per application cycle . */
export default function MarketingHeader({ current }: { current: "overview" | "sample" }) {
  return (
    <>
      <div className="banner" role="region" aria-label="Founding-family offer"><span>Limited-time offer: $99 per household, per application cycle, for founding families only.</span> <Link href="/#pricing">Request access →</Link></div>
      <header className="site-header">
        <div className="site-shell topbar">
          <RouteLockup variant="header" />
          <HeaderNav current={current} />
        </div>
      </header>
    </>
  );
}
