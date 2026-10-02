import Link from "next/link";
import { StatePill } from "./StatusPill";
import { StudentDot } from "./StudentSwitcher";
import { CompletionToggle } from "./CompletionToggle";
import { OfficialDestination } from "./OfficialDestination";
import { PRIORITY_STYLES, STATE_LABELS, STATE_STYLES, formatDate, daysUntil } from "@/lib/format";
import { parseDateStatus, DATE_NOT_POSTED_LABEL } from "@/lib/date-status";
import { isOuAidDateHeld, OU_AID_HOLD_TITLE } from "@/lib/ou-aid-quarantine";
import type { ActionInstance, Rule, GuidanceAsset, Source } from "@/lib/db/types";

type Props = {
  action: ActionInstance & { completed: boolean; rule: Rule; guidance: GuidanceAsset | null; source?: Source | null; pendingSourceChange?: boolean };
  schoolName: string;
  readOnly?: boolean;
  /** In a combined household queue, which student this belongs to (for a color dot). */
  studentIndex?: number;
};

export function ActionListItem({ action, schoolName, studentIndex, readOnly = false }: Props) {
  // Defense in depth if a future caller bypasses the term-filtered repository.
  if (!action.rule.researchTerm?.trim()) return <article className="rounded-2xl border border-line bg-white/85 p-4 text-sm text-warn">Research term unconfirmed — this task is not published for your cycle.</article>;
  const pending = !!action.pendingSourceChange;
  const held = isOuAidDateHeld(action.rule);
  const awaiting = !pending && parseDateStatus(action.rule).kind === "awaiting";
  const due = awaiting || pending ? null : daysUntil(action.dueAt);
  const overdue = due !== null && due < 0 && !action.completed && !["waived", "not_applicable"].includes(action.state);
  const taskTitle = held ? OU_AID_HOLD_TITLE : pending || awaiting ? action.rule.title : (action.guidance?.what ?? action.rule.title);

  return <article className="rounded-2xl border border-line bg-white/85 p-4 shadow-card" data-action-id={action.id}>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${PRIORITY_STYLES[action.priority]}`}>{action.priority}</span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink/40">{studentIndex !== undefined && <StudentDot index={studentIndex} />}{schoolName}</span>
          {schoolName === "Example Demo University" && <span className="rounded-full border border-accent/20 bg-accent/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">Fictional demo</span>}
        </div>
        <Link href={`/action/${action.id}`} className="mt-1 block font-display text-lg font-semibold leading-snug text-ink underline decoration-transparent hover:decoration-current">{taskTitle}</Link>
        <p className="mt-0.5 text-sm text-ink/50">{action.rule.domain}{held ? " · conflicting official dates; waiting for term-specific confirmation" : pending ? " · official source update under review" : awaiting ? " · waiting on the school" : " · included in your school plan"}</p>
        <p className="mt-1 text-xs text-ink/50">Why included: {action.applicabilityReason}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3"><div className={overdue ? "font-medium text-urgent" : awaiting || pending ? "text-warn" : "text-ink/70"}>{held ? "Date unresolved" : pending ? "Under review" : awaiting ? DATE_NOT_POSTED_LABEL : formatDate(action.dueAt)}</div><StatePill state={action.completed ? "complete" : action.state === "complete" ? "not_started" : action.state} styles={STATE_STYLES} labels={STATE_LABELS} /></div>
    </div>
    <div className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-2 sm:items-start">
      {held ? <p className="text-sm text-warn">No action or reminder until OU confirms this term&apos;s deadline.</p> : <CompletionToggle key={`${action.id}:${action.completed}`} actionId={action.id} completed={action.completed} readOnly={readOnly} />}
      <OfficialDestination source={action.source} rule={action.rule} schoolName={schoolName} />
    </div>
  </article>;
}
