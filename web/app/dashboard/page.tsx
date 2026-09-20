import { listRelationshipsForStudent, getInstitution, listActionInstancesForRelationship } from "@/lib/db/repo";
import { requireOnboardedHousehold } from "@/lib/auth/session";
import { SchoolCard } from "@/components/SchoolCard";
import { ActionListItem } from "@/components/ActionListItem";
import Link from "next/link";
import { parseDateStatus } from "@/lib/date-status";
import { listFamilyRequests } from "@/lib/db/requests";
import { enteringTermFrom, termNotice } from "@/lib/terms";
import { daysUntil, formatDate } from "@/lib/format";

// This reads the SQLite database on every request — it's a live household
// dashboard, not static marketing content, so opt out of Next's default
// static prerendering.
export const dynamic = "force-dynamic";

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const OPEN_STATES = new Set(["not_started", "started", "submitted", "received", "blocked"]);

// Something the school genuinely doesn't have is not a to-do, even if an older to-do was created for it.
const isOpen = (a: { state: string; rule: { requirement: string } }) =>
  OPEN_STATES.has(a.state) && parseDateStatus(a.rule).kind !== "not_applicable";

export default async function DashboardPage() {
  // Signed-in family only; the household comes from the sign-in, never from a URL or form.
  const { household, student } = await requireOnboardedHousehold();
  const relationships = await listRelationshipsForStudent(student.id);
  const schoolRequests = await listFamilyRequests(household.id);
  const enteringTerm = enteringTermFrom(student);
  const termMessage = termNotice(enteringTerm);

  const perSchool = await Promise.all(
    relationships.map(async (rel) => {
      const institution = (await getInstitution(rel.institutionId))!;
      const actions = enteringTerm ? await listActionInstancesForRelationship(rel.id, enteringTerm) : [];
      return { rel, institution, actions };
    })
  );

  const allActions = perSchool.flatMap(({ institution, actions }) =>
    actions
      .filter(isOpen)
      .map((a) => ({ ...a, schoolName: institution.name }))
  );

  allActions.sort((a, b) => {
    const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (pr !== 0) return pr;
    if (a.dueAt && b.dueAt) return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return 0;
  });

  const greekActions = allActions.filter((a) => a.rule.domain === "Greek and Student Life");
  const nonGreekActions = allActions.filter((a) => a.rule.domain !== "Greek and Student Life");
  const waitingOnSchools = allActions.filter((a) => ["submitted", "received"].includes(a.state) || parseDateStatus(a.rule).kind === "awaiting");
  const needThisWeek = allActions.filter((a) => {
    const days = daysUntil(a.dueAt);
    return !waitingOnSchools.includes(a) && days !== null && days <= 7;
  });
  const onTrack = allActions.filter((a) => !waitingOnSchools.includes(a) && !needThisWeek.includes(a));
  const nextDeadline = allActions
    .filter((a) => !waitingOnSchools.includes(a) && a.dueAt)
    .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime())[0];
  const nextDeadlineDays = nextDeadline ? daysUntil(nextDeadline.dueAt) : null;

  return (
    <main className="flex flex-col gap-10">
      <header className="border-b border-line pb-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">College Navigator</p>
            <h1 className="mt-2 font-display text-3xl font-semibold leading-tight text-ink sm:text-4xl">{household.name}</h1>
            <p className="mt-1 text-ink/60">
              {student.name} · Class of {student.gradYear} · tracking {relationships.length} schools
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Link
              href="/welcome"
              className="rounded-full border border-line bg-white/80 px-4 py-2 text-sm font-medium text-ink/70 transition hover:border-accent/40 hover:text-accent"
            >
              Manage schools
            </Link>
            <Link
              href="/account"
              className="rounded-full border border-line bg-white/80 px-4 py-2 text-sm font-medium text-ink/70 transition hover:border-accent/40 hover:text-accent"
            >
              Account
            </Link>
          </div>
        </div>
      </header>

      {termMessage && <p className="rounded-xl border border-warn/30 bg-warn/10 p-4 text-sm text-warn">{termMessage} <Link href="/welcome" className="font-semibold underline">Update your term</Link>.</p>}

      <section aria-label="Plan summary" className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_1.35fr]">
        {[
          { label: "Need you this week", value: needThisWeek.length, tone: "text-urgent" },
          { label: "Waiting on schools", value: waitingOnSchools.length, tone: "text-warn" },
          { label: "On track, nothing due yet", value: onTrack.length, tone: "text-ok" },
        ].map((tile) => (
          <div key={tile.label} className="rounded-2xl border border-line bg-white/80 p-4 shadow-card">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/45">{tile.label}</p>
            <p className={`mt-3 font-display text-3xl font-semibold ${tile.tone}`}>{tile.value}</p>
            <p className="mt-1 text-xs text-ink/45">open item{tile.value === 1 ? "" : "s"}</p>
          </div>
        ))}
        <div className="rounded-2xl bg-tealDark p-5 text-white shadow-card">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold">Next deadline that matters</p>
          {nextDeadline ? (
            <>
              <p className="mt-3 font-display text-xl font-semibold leading-snug">{nextDeadline.guidance?.what ?? nextDeadline.rule.title}</p>
              <p className="mt-1 text-sm text-white/65">{nextDeadline.schoolName} · {formatDate(nextDeadline.dueAt)}</p>
              <p className="mt-4 text-sm font-semibold text-gold">{nextDeadlineDays !== null && nextDeadlineDays < 0 ? `${Math.abs(nextDeadlineDays)} days overdue` : nextDeadlineDays === 0 ? "Due today" : `${nextDeadlineDays} days to go`}</p>
            </>
          ) : (
            <>
              <p className="mt-3 font-display text-xl font-semibold">Nothing pressing</p>
              <p className="mt-1 text-sm text-white/65">We will surface the next verified deadline here.</p>
            </>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-4 font-display text-2xl font-semibold text-ink">Schools in play</h2>
        {perSchool.length === 0 && (
          <p className="rounded-2xl border border-dashed border-line bg-white/40 p-7 text-center text-sm text-ink/50">
            You are not tracking any schools yet.{" "}
            <Link href="/welcome" className="underline">
              Choose your schools
            </Link>
            .
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {perSchool.map(({ rel, institution, actions }) => (
            <SchoolCard
              key={rel.id}
              institution={institution}
              relationship={rel}
              openCount={actions.filter(isOpen).length}
            />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-2xl font-semibold text-ink">Household action queue</h2>
          <span className="text-sm text-ink/40">{nonGreekActions.length} open</span>
        </div>
        {nonGreekActions.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line bg-white/40 p-7 text-center text-sm text-ink/50">
            Nothing open right now.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {nonGreekActions.slice(0, 25).map((a) => (
              <ActionListItem key={a.id} action={a} schoolName={a.schoolName} />
            ))}
          </div>
        )}
      </section>

      {greekActions.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-2xl font-semibold text-ink">Greek recruitment</h2>
            <span className="text-sm text-ink/40">{greekActions.length} open</span>
          </div>
          <div className="flex flex-col gap-2">
            {greekActions.map((a) => (
              <ActionListItem key={a.id} action={a} schoolName={a.schoolName} />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-2xl font-semibold text-ink">School requests</h2>
          <Link href="/request" className="text-sm font-semibold text-accent underline decoration-accent/30 underline-offset-4">Request a school</Link>
        </div>
        {schoolRequests.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line bg-white/40 p-6 text-center text-sm text-ink/50">Missing a school? Request it and we will add it after research passes verification.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {schoolRequests.slice(0, 5).map((item) => {
              const ready = item.job?.status === "ready" && item.institution?.coverageStatus === "certified";
              return <div key={item.id} className="flex items-center justify-between rounded-xl border border-line bg-white/80 px-4 py-3 text-sm shadow-card"><span><span className="font-medium text-ink">{item.school.name}</span><span className="ml-2 text-xs text-ink/40">{item.term}</span></span><span className={ready ? "text-ok" : "text-ink/50"}>{ready ? "Plan ready" : item.job?.status === "running" ? "Preparing your plan" : item.job?.status === "review" ? "Quality review" : "In line"}</span></div>;
            })}
          </div>
        )}
      </section>

      <footer className="border-t border-line pt-4 text-sm text-ink/40">
        School plans are reviewed under the 12² Standard. We examine 144 college-specific requirements and signals, then
        surface only the actions and deadlines that matter to your family. We never read, store, or score essays or personal statements.
      </footer>
    </main>
  );
}
