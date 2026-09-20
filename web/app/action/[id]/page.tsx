import Link from "next/link";
import { notFound } from "next/navigation";
import { getActionInstanceFull, listEventsForAction } from "@/lib/db/repo";
import { requireOnboardedHousehold } from "@/lib/auth/session";
import { actionBelongsToHousehold } from "@/lib/db/accounts";
import { StatePill } from "@/components/StatusPill";
import { STATE_LABELS, STATE_STYLES, formatDate, formatMoney } from "@/lib/format";
import { advanceActionState } from "@/app/actions";
import { parseDateStatus, awaitingMessage, lastYearLine, DATE_NOT_POSTED_LABEL } from "@/lib/date-status";
import { enteringTermFrom } from "@/lib/terms";

export const dynamic = "force-dynamic";

const NEXT_STATES: Record<string, string[]> = {
  not_started: ["started", "submitted", "blocked", "waived"],
  started: ["submitted", "blocked"],
  submitted: ["received", "blocked"],
  received: ["complete"],
  complete: [],
  blocked: ["not_started", "started"],
  waived: [],
  missed: ["started"],
  not_applicable: [],
};

export default async function ActionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { household } = await requireOnboardedHousehold();
  // Someone else's action looks exactly like one that does not exist.
  if (!(await actionBelongsToHousehold(id, household.id))) notFound();
  const action = await getActionInstanceFull(id);
  if (!action) notFound();
  // Ownership alone is not enough: never expose an action generated for a
  // different admissions cycle after a family changes its entering term.
  if (enteringTermFrom(action.relationship.student) !== action.rule.researchTerm) notFound();

  const events = await listEventsForAction(action.id);
  const g = action.guidance;

  // If the school hasn't published this cycle's dates (or only last cycle's are known), say so
  // plainly and never show an older date as if it were current.
  const dateStatus = parseDateStatus(action.rule);
  const schoolName = action.relationship.institution.name;
  const awaitingMsg = dateStatus.kind === "awaiting" ? awaitingMessage(schoolName, dateStatus.term) : null;
  const lastYear = lastYearLine(dateStatus);

  async function setState(formData: FormData) {
    "use server";
    const toState = String(formData.get("toState"));
    await advanceActionState(action!.id, toState);
  }

  return (
    <main className="flex flex-col gap-6">
      <Link href="/" className="text-sm text-ink/50 hover:underline">
        ← Back to household dashboard
      </Link>

      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm text-ink/40">
          <span>{action.relationship.institution.name}</span>
          <span>·</span>
          <span>
            {action.rule.checkpointCode} — {action.rule.domain}
          </span>
        </div>
        <h1 className="text-xl font-semibold text-ink">
          {dateStatus.kind === "awaiting" ? action.rule.title : (g?.what ?? action.rule.title)}
        </h1>
        <div className="flex items-center gap-2">
          <StatePill state={action.state} styles={STATE_STYLES} labels={STATE_LABELS} />
          {action.rule.critical && <span className="text-xs font-medium text-accent">Critical checkpoint</span>}
          {dateStatus.kind === "awaiting" ? (
            <span className="text-xs font-medium text-warn">
              Waiting for {schoolName} to post {dateStatus.term} details
            </span>
          ) : dateStatus.kind === "not_applicable" ? (
            <span className="text-xs font-medium text-ink/50">Doesn&apos;t apply at {schoolName}</span>
          ) : (
            action.rule.status === "unverified" && (
              <span className="text-xs font-medium text-warn">Not yet independently researched</span>
            )
          )}
        </div>
      </header>

      {awaitingMsg && (
        <section className="rounded-lg border border-warn/30 bg-warn/10 p-4">
          <p className="font-semibold text-warn">{DATE_NOT_POSTED_LABEL}</p>
          <p className="mt-1 text-sm text-ink/80">{awaitingMsg}</p>
          {lastYear && <p className="mt-2 text-xs text-ink/50">{lastYear}</p>}
        </section>
      )}

      {dateStatus.kind === "not_applicable" && (
        <section className="rounded-lg border border-line bg-ink/5 p-4">
          <p className="font-semibold text-ink/70">Doesn&apos;t apply at {schoolName}</p>
          <p className="mt-1 text-sm text-ink/70">{dateStatus.detail}</p>
        </section>
      )}

      {g ? (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="What">{dateStatus.kind === "awaiting" ? action.rule.title : g.what}</Field>
          <Field label="When">{awaitingMsg ?? g.when}</Field>
          <Field label="Why it matters">{g.why}</Field>
          <Field label="How">{g.how}</Field>
          <Field label="If you miss it">{g.consequence}</Field>
          {g.deepLink && (
            <Field label="Official link">
              <a href={g.deepLink} target="_blank" rel="noreferrer" className="text-accent underline">
                {g.deepLink}
              </a>
            </Field>
          )}
        </section>
      ) : dateStatus.kind === "not_applicable" ? null : (
        <section className="rounded-lg border border-dashed border-line p-4 text-sm text-ink/60">
          {dateStatus.kind === "current" && <p className="mb-2 font-medium text-ink">{action.rule.requirement}</p>}
          <p>
            No plain-language guidance has been generated for this checkpoint yet. This is queued for the Guidance
            Generation Agent once the underlying rule reaches verified status.
          </p>
        </section>
      )}

      {g && dateStatus.kind === "awaiting" && (
        <p className="-mt-3 text-xs text-ink/50">
          The other details above were written from last year&apos;s information. Check any dates or amounts against the
          school&apos;s own site before acting.
        </p>
      )}

      <section className="grid grid-cols-2 gap-4 rounded-lg border border-line bg-white p-4 text-sm sm:grid-cols-4">
        <Stat label="Due" value={dateStatus.kind === "awaiting" ? "Not posted yet" : formatDate(action.dueAt)} />
        <Stat label="Cost" value={formatMoney(dateStatus.kind === "awaiting" ? null : action.rule.costCents)} />
        <Stat label="Refundable" value={action.rule.refundable} />
        <Stat label="Confidence" value={action.rule.confidence} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/50">Why this is on your plan</h2>
        <p className="rounded-lg bg-ink/5 p-3 text-sm text-ink/70">{action.applicabilityReason}</p>
      </section>

      {NEXT_STATES[action.state]?.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/50">Update status</h2>
          <div className="flex flex-wrap gap-2">
            {NEXT_STATES[action.state].map((s) => (
              <form action={setState} key={s}>
                <input type="hidden" name="toState" value={s} />
                <button
                  type="submit"
                  className="rounded-md border border-ink/20 bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-ink/5"
                >
                  Mark {STATE_LABELS[s]}
                </button>
              </form>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink/40">
            In the full product, Submitted → Received → Complete transitions are also detected automatically by the
            browser companion observing the school's own portal — this button is the manual fallback.
          </p>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/50">History</h2>
        <ol className="flex flex-col gap-1 text-sm text-ink/60">
          {events.map((e) => (
            <li key={e.id} className="flex items-center gap-2">
              <span className="text-ink/30">{formatDate(e.observedAt)}</span>
              <span>
                {e.fromState ? `${STATE_LABELS[e.fromState] ?? e.fromState} → ` : ""}
                {STATE_LABELS[e.toState ?? ""] ?? e.toState}
              </span>
              <span className="text-ink/30">({e.actorType})</span>
            </li>
          ))}
        </ol>
      </section>

      {action.source && (
        <footer className="border-t border-line pt-3 text-xs text-ink/40">
          Source: {action.source.label} — last verified {formatDate(action.source.lastVerified)} —{" "}
          <a href={action.source.url} target="_blank" rel="noreferrer" className="underline">
            {action.source.url}
          </a>
        </footer>
      )}
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-ink/40">{label}</div>
      <div className="mt-1 text-sm text-ink/80">{children}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-ink/40">{label}</div>
      <div className="mt-0.5 font-medium capitalize text-ink">{value}</div>
    </div>
  );
}
