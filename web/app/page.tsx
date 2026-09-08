import { listHouseholds, listStudentsForHousehold, listRelationshipsForStudent, getInstitution, listActionInstancesForRelationship } from "@/lib/db/repo";
import { SchoolCard } from "@/components/SchoolCard";
import { ActionListItem } from "@/components/ActionListItem";
import Link from "next/link";

// This reads the SQLite database on every request — it's a live household
// dashboard, not static marketing content, so opt out of Next's default
// static prerendering.
export const dynamic = "force-dynamic";

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const OPEN_STATES = new Set(["not_started", "started", "submitted", "received", "blocked"]);

export default function DashboardPage() {
  const households = listHouseholds();
  const household = households[0];

  if (!household) {
    return (
      <main>
        <p className="text-ink/60">
          No household seeded yet. Run <code className="rounded bg-ink/5 px-1">npm run db:seed</code> and reload.
        </p>
      </main>
    );
  }

  const students = listStudentsForHousehold(household.id);
  const student = students[0];
  const relationships = listRelationshipsForStudent(student.id);

  const perSchool = relationships.map((rel) => {
    const institution = getInstitution(rel.institutionId)!;
    const actions = listActionInstancesForRelationship(rel.id);
    return { rel, institution, actions };
  });

  const allActions = perSchool.flatMap(({ institution, actions }) =>
    actions
      .filter((a) => OPEN_STATES.has(a.state))
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
        <p className="text-sm font-medium uppercase tracking-wide text-ink/40">College Navigator</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">{household.name}</h1>
        <p className="mt-1 text-ink/60">
          {student.name} · Class of {student.gradYear} · tracking {relationships.length} schools
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/50">Schools in play</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {perSchool.map(({ rel, institution, actions }) => (
            <SchoolCard
              key={rel.id}
              institution={institution}
              relationship={rel}
              openCount={actions.filter((a) => OPEN_STATES.has(a.state)).length}
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

      <footer className="border-t border-line pt-4 text-sm text-ink/40">
        Protected admissions-content zone: this product manages process, timing, and logistics only. It never reads, stores,
        or scores essays or personal statements. See the{" "}
        <Link href="/school/alabama" className="underline">
          Alabama 144-point tracker
        </Link>{" "}
        for full checkpoint-level provenance.
      </footer>
    </main>
  );
}
