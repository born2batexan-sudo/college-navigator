import type { Metadata } from "next";
import SamplePlan from "@/components/SamplePlan";

// Public, fixed fictional data only. Do not load sessions, household records, or live school data here.
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Sample College Plan: See Every Deadline in One Place",
  description: "Try a free sample plan: see how Campus Passage organizes college application, financial aid, and housing deadlines for one student or several.",
  alternates: { canonical: "/sample-plan" },
};

export default function SamplePlanPage() {
  return <SamplePlan />;
}
