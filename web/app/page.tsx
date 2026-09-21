import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import CampusPassageLanding from "@/components/CampusPassageLanding";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  // Keep the existing authentication boundary: signed-in households go to their live plan.
  if (await getSessionUser()) redirect("/dashboard");

  return <CampusPassageLanding />;
}
