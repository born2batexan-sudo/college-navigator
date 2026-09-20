import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getInstitutionBySlug,
  listRelationshipsForStudent,
  listActionInstancesForRelationship,
} from "@/lib/db/repo";
import { requireOnboardedHousehold } from "@/lib/auth/session";
import { ActionListItem } from "@/components/ActionListItem";
import { parseDateStatus } from "@/lib/date-status";
import { enteringTermFrom, RESEARCHED_TERM } from "@/lib/terms";
import { canHouseholdViewInstitution } from "@/lib/db/requests";
import { getCoverageVersion } from "@/lib/coverage";

export const dynamic = "force-dynamic";

const OPEN_STATES = new Set(["not_started", "started", "submitted", "received", "blocked"]);

export default async function SchoolTrackerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { student, household } = await requireOnboardedHousehold();
  const institution = await getInstitutionBySlug(slug);
  if (!institution) notFound();

  const term = enteringTermFrom(student) ?? RESEARCHED_TERM;
  if (!(await canHouseholdViewInstitution(household.id, institution.id, term))) notFound();

  const coverage = await getCoverageVersion(institution.id, term);
  if (coverage?.status !== "certified" && institution.coverageStatus !== "certified") notFound();

  const relationships = await listRelationshipsForStudent(student.id);
  const relationship = relationships.find((r) => r.institutionId === institution.id) ?? null;
  const actions = relationship ? await listActionInstancesForRelationship(relationship.id, term) : [];
  const pertinentActions = actions
    .filter((action) => OPEN_STATES.has(action.state) && parseDateStatus(action.rule).kind !== "not_applicable")
    .sort((a, b) => {
      if (a.dueAt && b.dueAt) return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      if (a.dueAt) return -1;
      if (b.dueAt) return 1;
      return 0;
    });

  return (
    <main className="flex flex-col gap-8">
      <Link href="/" className="text-sm text-ink/50 hover:underline">
        ← Back to household dashboard
      </Link>

      <header className="rounded-2xl bg-tealDark p-6 text-white shadow-card sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gold">Your school plan</p>
        <h1 className="mt-2 font-display text-3xl font-semibold leading-tight">{institution.name}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/70">
          Reviewed for {term} under the 12² Standard. We examine 144 college-specific requirements and signals, then
          surface only the actions and deadlines that matter to your family.
        </p>
      </header>

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Prioritized for your family</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-ink">What needs attention</h2>
          </div>
          <span className="text-sm text-ink/45">
            {pertinentActions.length} open action{pertinentActions.length === 1 ? "" : "s"}
          </span>
        </div>

        {pertinentActions.length === 0 ? (
          <div className="rounded-2xl border border-line bg-white/80 p-7 text-center shadow-card">
            <p className="font-display text-xl font-semibold text-ink">Nothing needs your attention right now.</p>
            <p className="mt-2 text-sm text-ink/55">We will add an action here when a relevant requirement or deadline needs you.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {pertinentActions.map((action) => (
              <ActionListItem key={action.id} action={action} schoolName={institution.name} />
            ))}
          </div>
        )}
      </section>

      <aside className="rounded-2xl border border-line bg-white/65 p-5 text-sm text-ink/60">
        <p className="font-semibold text-ink">How this plan stays simple</p>
        <p className="mt-1 leading-relaxed">
          We monitor admissions, financial aid, housing, enrollment, health, orientation, and other applicable areas in
          the background. You see only the items that require awareness or action.
        </p>
      </aside>
    </main>
  );
}
