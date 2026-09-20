import Link from "next/link";
import { StatePill } from "./StatusPill";
import type { Institution, InstitutionRelationship } from "@/lib/db/types";

const LIFECYCLE_LABELS: Record<string, string> = {
  considering: "Considering",
  applying: "Applying",
  applied: "Applied",
  admitted: "Admitted",
  waitlisted: "Waitlisted",
  enrolled: "Enrolled",
  declined: "Declined",
  attending: "Attending",
  alumni: "Alumni",
};

const LIFECYCLE_STYLES: Record<string, string> = {
  considering: "bg-ink/5 text-ink/60",
  applying: "bg-blue-50 text-blue-700",
  applied: "bg-blue-50 text-blue-700",
  admitted: "bg-ok/10 text-ok",
  waitlisted: "bg-warn/10 text-warn",
  enrolled: "bg-ok/10 text-ok",
  declined: "bg-ink/5 text-ink/30",
  attending: "bg-ok/10 text-ok",
  alumni: "bg-ink/5 text-ink/40",
};

export function SchoolCard({ institution, relationship, openCount }: { institution: Institution; relationship: InstitutionRelationship; openCount: number }) {
  const submittedStates = new Set(["applied", "admitted", "waitlisted", "enrolled", "declined", "attending", "alumni"]);
  const receivedStates = new Set(["admitted", "waitlisted", "enrolled", "declined", "attending", "alumni"]);
  const milestoneState = {
    submitted: submittedStates.has(relationship.lifecycleState),
    received: receivedStates.has(relationship.lifecycleState),
    complete: receivedStates.has(relationship.lifecycleState),
  };

  return (
    <Link
      href={`/school/${institution.slug}`}
      className="group flex flex-col gap-4 rounded-2xl border border-line bg-white/85 p-5 shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-lg"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-lg font-semibold text-ink transition group-hover:text-accent">{institution.name}</span>
        <span className="rounded-full bg-ok/10 px-2 py-0.5 text-[11px] font-medium text-ok">
          Plan ready
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 text-sm text-ink/60">
        <StatePill state={relationship.lifecycleState} styles={LIFECYCLE_STYLES} labels={LIFECYCLE_LABELS} />
        <span className="text-right">{openCount > 0 ? `${openCount} open action${openCount === 1 ? "" : "s"}` : "No tracked actions yet"}</span>
      </div>
      <div className="grid grid-cols-3 gap-1 border-t border-line pt-3" aria-label="Application progress">
        {(["submitted", "received", "complete"] as const).map((step) => (
          <div key={step} className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/45">
            <span className={`h-2 w-2 rounded-full ${milestoneState[step] ? "bg-accent" : "border border-line bg-paper"}`} />
            <span className={milestoneState[step] ? "text-accent" : ""}>{step}</span>
          </div>
        ))}
      </div>
    </Link>
  );
}
