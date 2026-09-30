import HeaderNav from "@/components/HeaderNav";
import RouteLockup from "@/components/RouteLogo";

export default function MarketingHeader({ current }: { current: "overview" | "sample" }) {
  return (
    <>
      <header className="site-header">
        <div className="site-shell topbar">
          <RouteLockup variant="header" />
          <HeaderNav current={current} />
        </div>
      </header>
    </>
  );
}
