import Link from "next/link";
import { StatePill } from "./StatusPill";
import { StudentDot } from "./StudentSwitcher";
import { PRIORITY_STYLES, STATE_LABELS, STATE_STYLES, formatDate, daysUntil } from "@/lib/format";
import { parseDateStatus, DATE_NOT_POSTED_LABEL } from "@/lib/date-status";
import type { ActionInstance, Rule, GuidanceAsset } from "@/lib/db/types";

type Props = {
  action: ActionInstance & { rule: Rule; guidance: GuidanceAsset | null };
  schoolName: string;
  /** In a combined household queue, which student this belongs to (for a color dot). Omit on a single student's own plan. */
  studentIndex?: number;
};

export function ActionListItem({ action, schoolName, studentIndex }: Props) {
  // If the school hasn't published this cycle's dates, show that plainly instead of any date.
  const awaiting = parseDateStatus(action.rule).kind === "awaiting";
  const due = awaiting ? null : daysUntil(action.dueAt);
  const overdue = due !== null && due < 0 && !["complete", "waived", "not_applicable"].includes(action.state);

  return (
    <Link
      href={`/action/${action.id}`}
      className="flex flex-col gap-3 rounded-2xl border border-line bg-white/85 p-4 shadow-card transition duration-200 hover:border-accent/30 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${PRIORITY_STYLES[action.priority]}`}>
            {action.priority}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink/40">{studentIndex !== undefined && <StudentDot index={studentIndex} />}{schoolName}</span>
          {schoolName === "Example Demo University" && (
            <span className="rounded-full border border-accent/20 bg-accent/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">Fictional demo</span>
          )}
        </div>
        <p className="mt-1 font-display text-lg font-semibold leading-snug text-ink">{awaiting ? action.rule.title : (action.guidance?.what ?? action.rule.title)}</p>
        <p className="mt-0.5 text-sm text-ink/50">
          {action.rule.domain}{awaiting ? " · waiting on the school" : " · included in your school plan"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <div className="text-right text-sm">
          <div className={overdue ? "font-medium text-urgent" : awaiting ? "text-warn" : "text-ink/70"}>
            {awaiting ? DATE_NOT_POSTED_LABEL : formatDate(action.dueAt)}
          </div>
        </div>
        <StatePill state={action.state} styles={STATE_STYLES} labels={STATE_LABELS} />
      </div>
    </Link>
  );
}
