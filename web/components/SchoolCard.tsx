import Link from "next/link";
import { COVERAGE_LABELS, COVERAGE_STYLES } from "@/lib/format";
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
  return (
    <Link
      href={`/school/${institution.slug}`}
      className="flex flex-col gap-2 rounded-lg border border-line bg-white p-4 transition hover:border-ink/20"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-ink">{institution.name}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${COVERAGE_STYLES[institution.coverageStatus]}`}>
          {COVERAGE_LABELS[institution.coverageStatus]} · {institution.coveragePct}%
        </span>
      </div>
      <div className="flex items-center justify-between text-sm text-ink/60">
        <StatePill state={relationship.lifecycleState} styles={LIFECYCLE_STYLES} labels={LIFECYCLE_LABELS} />
        <span>{openCount > 0 ? `${openCount} open action${openCount === 1 ? "" : "s"}` : "No tracked actions yet"}</span>
      </div>
    </Link>
  );
}
