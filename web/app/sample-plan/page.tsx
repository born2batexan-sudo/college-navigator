import type { Metadata } from "next";
import SamplePlan from "@/components/SamplePlan";

// Public, fixed fictional data only. Do not load sessions, household records, or live school data here.
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Explore a fictional sample plan",
  description: "Try a read-only example for one student or a same-cycle household. Fictional names, schools, dates, and source labels; no private data.",
  alternates: { canonical: "/sample-plan" },
};

export default function SamplePlanPage() {
  return <SamplePlan />;
}
