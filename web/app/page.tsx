import { listRelationshipsForStudent, getInstitution, listActionInstancesForRelationship } from "@/lib/db/repo";
import { requireOnboardedHousehold } from "@/lib/auth/session";
import { SchoolCard } from "@/components/SchoolCard";
import { ActionListItem } from "@/components/ActionListItem";
import Link from "next/link";
import { parseDateStatus } from "@/lib/date-status";
import { listFamilyRequests } from "@/lib/db/requests";
import { enteringTermFrom, termNotice } from "@/lib/terms";

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
  const enteringTerm = enteringTermFrom(student) ?? "Fall 2027";
  const termMessage = termNotice(enteringTerm);

  const perSchool = await Promise.all(
    relationships.map(async (rel) => {
      const institution = (await getInstitution(rel.institutionId))!;
      const actions = await listActionInstancesForRelationship(rel.id, enteringTerm);
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

  return (
    <main className="flex flex-col gap-8">
      <header>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-ink/40">College Navigator</p>
            <h1 className="mt-1 text-2xl font-semibold text-ink">{household.name}</h1>
            <p className="mt-1 text-ink/60">
              {student.name} · Class of {student.gradYear} · tracking {relationships.length} schools
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Link
              href="/welcome"
              className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink/70 transition hover:border-ink/30"
            >
              Manage schools
            </Link>
            <Link
              href="/account"
              className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink/70 transition hover:border-ink/30"
            >
              Account
            </Link>
          </div>
        </div>
      </header>

      {termMessage && <p className="rounded-md border border-warn/30 bg-warn/10 p-3 text-sm text-warn">{termMessage} <Link href="/welcome" className="underline">Update your term</Link>.</p>}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/50">Schools in play</h2>
        {perSchool.length === 0 && (
          <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-ink/50">
            You are not tracking any schools yet.{" "}
            <Link href="/welcome" className="underline">
              Choose your schools
            </Link>
            .
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">Household action queue</h2>
          <span className="text-sm text-ink/40">{nonGreekActions.length} open</span>
        </div>
        {nonGreekActions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-ink/50">
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
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">Greek recruitment</h2>
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
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">School requests</h2>
          <Link href="/request" className="text-sm text-accent underline">Request a school</Link>
        </div>
        {schoolRequests.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line p-5 text-center text-sm text-ink/50">Missing a school? Request it and we will add it after research passes verification.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {schoolRequests.slice(0, 5).map((item) => {
              const ready = item.job?.status === "ready" && item.institution?.coverageStatus === "certified";
              return <div key={item.id} className="flex items-center justify-between rounded-lg border border-line bg-white px-4 py-3 text-sm"><span><span className="font-medium text-ink">{item.school.name}</span><span className="ml-2 text-xs text-ink/40">{item.term}</span></span><span className={ready ? "text-ok" : "text-ink/50"}>{ready ? "Verified plan ready" : item.job?.status === "running" ? "Research in progress" : item.job?.status === "review" ? "Held for review" : "In line"}</span></div>;
            })}
          </div>
        )}
      </section>

      <footer className="border-t border-line pt-4 text-sm text-ink/40">
        Protected admissions-content zone: this product manages process, timing, and logistics only. It never reads, stores,
        or scores essays or personal statements. School plans are published only after they pass the 144-check 12² Standard,
        with checkpoint-level source provenance.
      </footer>
    </main>
  );
}
