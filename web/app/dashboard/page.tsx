import Link from "next/link";
import { getInstitution, listActionInstancesForRelationship, listRelationshipsForStudent, listStudentsForHousehold } from "@/lib/db/repo";
import { isDemoOwnerEmail } from "@/lib/db/accounts";
import { reviewLabEnabled } from "@/lib/auth/env";
import { requireOnboardedHousehold, requireSelectedStudent } from "@/lib/auth/session";
import { ActionListItem } from "@/components/ActionListItem";
import { StudentSwitcher, StudentDot, studentAccent } from "@/components/StudentSwitcher";
import { parseDateStatus } from "@/lib/date-status";
import { enteringTermFrom, termNotice } from "@/lib/terms";
import { daysUntil, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const OPEN_STATES = new Set(["not_started", "started", "submitted", "received", "blocked"]);
const isOpen = (action: { state: string; rule: { requirement: string } }) => OPEN_STATES.has(action.state) && parseDateStatus(action.rule).kind !== "not_applicable";

type Params = { student?: string };
type PlannedAction = Awaited<ReturnType<typeof listActionInstancesForRelationship>>[number] & { schoolName: string };
type StudentPlan = { id: string; name: string; term: ReturnType<typeof enteringTermFrom>; relationships: number; actions: PlannedAction[] };

async function planForStudent(student: Awaited<ReturnType<typeof listStudentsForHousehold>>[number]): Promise<StudentPlan> {
  const relationships = await listRelationshipsForStudent(student.id);
  const enteringTerm = enteringTermFrom(student);
  const actions = (await Promise.all(relationships.map(async (relationship) => {
    const institution = await getInstitution(relationship.institutionId);
    const instances = enteringTerm ? await listActionInstancesForRelationship(relationship.id, enteringTerm) : [];
    return instances.filter(isOpen).map((action) => ({ ...action, schoolName: institution?.name ?? "School" }));
  }))).flat();
  actions.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) - (b.dueAt ? new Date(b.dueAt).getTime() : Infinity));
  return { id: student.id, name: student.name, term: enteringTerm, relationships: relationships.length, actions };
}

function actionCounts(actions: PlannedAction[]) {
  const waiting = actions.filter((action) => ["submitted", "received"].includes(action.state) || parseDateStatus(action.rule).kind === "awaiting");
  const due = actions.filter((action) => { const days = daysUntil(action.dueAt); return !waiting.includes(action) && days !== null && days <= 7; });
  return { waiting, due, onTrack: actions.filter((action) => !waiting.includes(action) && !due.includes(action)) };
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Params> }) {
  const query = await searchParams;
  const base = await requireOnboardedHousehold();
  const selected = query.student ? await requireSelectedStudent(query.student) : null;
  const [students, plans] = await Promise.all([listStudentsForHousehold(base.household.id), Promise.all((await listStudentsForHousehold(base.household.id)).map(planForStudent))]);
  const selectedPlan = selected ? plans.find((plan) => plan.id === selected.student.id)! : null;
  const allActions = plans.flatMap((plan) => plan.actions);
  const householdCounts = actionCounts(allActions);
  const studentUrl = (id?: string) => id ? `/dashboard?student=${encodeURIComponent(id)}` : "/dashboard";

  return <main className="flex flex-col gap-8">
    <header className="border-b border-line pb-6"><div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Campus Passage</p><h1 className="mt-2 font-display text-3xl font-semibold leading-tight text-ink sm:text-4xl">{selectedPlan ? `${selectedPlan.name}'s plan` : base.household.name}</h1><p className="mt-1 text-ink/60">{selectedPlan ? `${selectedPlan.relationships} schools tracked · separate status from every other student` : `${students.length} student${students.length === 1 ? "" : "s"} · one protected household plan`}</p></div><div className="flex shrink-0 gap-2">{!base.isDemo && <><Link href={selectedPlan ? `/welcome?student=${selectedPlan.id}` : "/welcome"} className="rounded-full border border-line bg-white/80 px-4 py-2 text-sm font-medium text-ink/70">Manage schools</Link><Link href="/request" className="rounded-full border border-line bg-white/80 px-4 py-2 text-sm font-medium text-ink/70">Request a school</Link></>}{reviewLabEnabled && isDemoOwnerEmail(base.email) && <Link href="/review-lab" className="rounded-full border border-violet/35 bg-violetPale/45 px-4 py-2 text-sm font-medium text-violet">Owner review lab</Link>}<Link href="/account" className="rounded-full border border-line bg-white/80 px-4 py-2 text-sm font-medium text-ink/70">Account</Link></div></div></header>
    {base.isDemo && <p className="rounded-xl border border-accent/25 bg-accent/10 p-3 text-sm text-ink/75"><strong className="font-semibold text-accent">Private Preview</strong> · This sample household is read-only.</p>}
    <StudentSwitcher students={students} selectedStudentId={selectedPlan?.id} hrefFor={studentUrl} />

    {!selectedPlan ? <>
      <section aria-label="Household action summary" className="grid gap-3 md:grid-cols-3">{[{ label: "Need attention this week", value: householdCounts.due.length, tone: "text-urgent" }, { label: "Waiting on schools", value: householdCounts.waiting.length, tone: "text-warn" }, { label: "On track", value: householdCounts.onTrack.length, tone: "text-ok" }].map((tile) => <div key={tile.label} className="rounded-2xl border border-line bg-white/80 p-4 shadow-card"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/45">{tile.label}</p><p className={`mt-3 font-display text-3xl font-semibold ${tile.tone}`}>{tile.value}</p><p className="mt-1 text-xs text-ink/45">open item{tile.value === 1 ? "" : "s"} across the household</p></div>)}</section>
      <section><h2 className="mb-4 font-display text-2xl font-semibold text-ink">Student plans</h2><p className="mb-4 max-w-2xl text-sm text-ink/55">{plans.length > 1 ? "Each student keeps a color, a pace, and a plan of their own — even while the household sees them together." : "Add another qualifying student from Account to see additional plans side by side, without one crowding another."}</p><div className="grid gap-4 md:grid-cols-2">{plans.map((plan, index) => { const counts = actionCounts(plan.actions); const accent = studentAccent(index); return <article key={plan.id} className={`rounded-2xl border border-line border-t-4 bg-white/80 p-5 shadow-card ${accent.border}`}><div className="flex items-start justify-between gap-3"><div><h3 className="flex items-center gap-2 font-display text-xl font-semibold text-ink"><StudentDot index={index} />{plan.name}</h3><p className="mt-1 text-sm text-ink/55">{plan.relationships} school{plan.relationships === 1 ? "" : "s"} tracked · {plan.term ?? "start term not set"}</p></div><Link href={studentUrl(plan.id)} className={`text-sm font-semibold underline ${accent.text}`}>Open plan</Link></div><dl className="mt-4 grid grid-cols-3 gap-2 text-center text-sm"><div><dt className="text-ink/45">This week</dt><dd className="mt-1 font-semibold text-urgent">{counts.due.length}</dd></div><div><dt className="text-ink/45">Waiting</dt><dd className="mt-1 font-semibold text-warn">{counts.waiting.length}</dd></div><div><dt className="text-ink/45">On track</dt><dd className="mt-1 font-semibold text-ok">{counts.onTrack.length}</dd></div></dl></article>; })}</div></section>
      <section><h2 className="mb-3 font-display text-2xl font-semibold text-ink">Household action queue</h2>{allActions.length === 0 ? <p className="rounded-2xl border border-dashed border-line bg-white/40 p-7 text-center text-sm text-ink/50">Nothing open right now.</p> : <div className="flex flex-col gap-2">{allActions.slice(0, 25).map((action) => { const planIndex = plans.findIndex((plan) => plan.actions.includes(action)); return <ActionListItem key={action.id} action={action} studentIndex={planIndex === -1 ? undefined : planIndex} schoolName={`${plans[planIndex]?.name ?? "Student"} · ${action.schoolName}`} />; })}</div>}</section>
    </> : <StudentDashboard plan={selectedPlan} />}
    <footer className="border-t border-line pt-4 text-sm text-ink/40">School plans are reviewed under the 12² Standard. We surface verified actions and deadlines without reading, storing, or scoring essays or personal statements.</footer>
  </main>;
}

function StudentDashboard({ plan }: { plan: StudentPlan }) {
  const counts = actionCounts(plan.actions); const next = plan.actions.filter((action) => !counts.waiting.includes(action) && action.dueAt).sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime())[0]; const notice = termNotice(plan.term);
  return <><section aria-label="Student plan summary" className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_1.35fr]">{[{ label: "Need you this week", value: counts.due.length, tone: "text-urgent" }, { label: "Waiting on schools", value: counts.waiting.length, tone: "text-warn" }, { label: "On track", value: counts.onTrack.length, tone: "text-ok" }].map((tile) => <div key={tile.label} className="rounded-2xl border border-line bg-white/80 p-4 shadow-card"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/45">{tile.label}</p><p className={`mt-3 font-display text-3xl font-semibold ${tile.tone}`}>{tile.value}</p></div>)}<div className="rounded-2xl bg-tealDark p-5 text-white shadow-card"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold">Next deadline that matters</p>{next ? <><p className="mt-3 font-display text-xl font-semibold">{next.guidance?.what ?? next.rule.title}</p><p className="mt-1 text-sm text-white/65">{next.schoolName} · {formatDate(next.dueAt)}</p></> : <p className="mt-3 font-display text-xl font-semibold">Nothing pressing</p>}</div></section>{notice && <p className="rounded-xl border border-warn/30 bg-warn/10 p-4 text-sm text-warn">{notice} <Link href={`/welcome?student=${plan.id}`} className="font-semibold underline">Update the term</Link>.</p>}<section><div className="mb-3 flex items-center justify-between"><h2 className="font-display text-2xl font-semibold text-ink">{plan.name}&apos;s action queue</h2><Link href={`/welcome?student=${plan.id}`} className="text-sm font-semibold text-accent underline">Manage schools</Link></div>{plan.actions.length === 0 ? <p className="rounded-2xl border border-dashed border-line bg-white/40 p-7 text-center text-sm text-ink/50">Nothing open right now.</p> : <div className="flex flex-col gap-2">{plan.actions.map((action) => <ActionListItem key={action.id} action={action} schoolName={action.schoolName} />)}</div>}</section></>;
}
