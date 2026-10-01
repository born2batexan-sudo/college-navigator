import type { Metadata } from "next";
import SamplePlan from "@/components/SamplePlan";

// Public, fixed illustrative data only. Do not load sessions, household records, or live school data here.
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Explore the illustrative sample plan",
  description: "Try a read-only illustration for one student or a same-cycle household. Sample names, schools, dates, and source labels; no private data or live source checks.",
  alternates: { canonical: "/sample-plan" },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false, noimageindex: true } },
};

export default function SamplePlanPage() {
  return <SamplePlan />;
}
