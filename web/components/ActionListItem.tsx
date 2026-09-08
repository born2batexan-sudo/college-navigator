import Link from "next/link";
import { StatePill } from "./StatusPill";
import { PRIORITY_STYLES, STATE_LABELS, STATE_STYLES, formatDate, daysUntil } from "@/lib/format";
import type { ActionInstance, Rule, GuidanceAsset } from "@/lib/db/types";

type Props = {
  action: ActionInstance & { rule: Rule; guidance: GuidanceAsset | null };
  schoolName: string;
};

export function ActionListItem({ action, schoolName }: Props) {
  const due = daysUntil(action.dueAt);
  const overdue = due !== null && due < 0 && !["complete", "waived", "not_applicable"].includes(action.state);

  return (
    <Link
      href={`/action/${action.id}`}
      className="flex flex-col gap-2 rounded-lg border border-line bg-white p-4 transition hover:border-ink/20 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${PRIORITY_STYLES[action.priority]}`}>
            {action.priority}
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink/40">{schoolName}</span>
          {action.rule.critical && <span className="text-[11px] font-medium text-accent">Critical</span>}
        </div>
        <p className="mt-1 truncate font-medium text-ink">{action.guidance?.what ?? action.rule.title}</p>
        <p className="mt-0.5 text-sm text-ink/50">
          {action.rule.checkpointCode} · {action.rule.domain}
          {action.rule.status === "unverified" && " · not yet researched"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <div className="text-right text-sm">
          <div className={overdue ? "font-medium text-urgent" : "text-ink/70"}>{formatDate(action.dueAt)}</div>
        </div>
        <StatePill state={action.state} styles={STATE_STYLES} labels={STATE_LABELS} />
      </div>
    </Link>
  );
}
