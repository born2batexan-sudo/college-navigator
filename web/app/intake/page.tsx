import Link from "next/link";
import { requireSelectedStudent } from "@/lib/auth/session";
import { listStudentsForHousehold } from "@/lib/db/repo";
import { StudentSwitcher } from "@/components/StudentSwitcher";
import { CHOICE_OPTIONS, HOUSING_OPTIONS, INTAKE_QUESTIONS, intakeSummary, readIntake } from "@/lib/intake";
import { saveIntake } from "./actions";

export const dynamic = "force-dynamic";
type Params = { student?: string; saved?: string };
export default async function IntakePage({ searchParams }: { searchParams: Promise<Params> }) {
  const query = await searchParams;
  const { student, household, isDemo } = await requireSelectedStudent(query.student);
  const students = await listStudentsForHousehold(household.id);
  const answers = readIntake(student);
  const summary = intakeSummary(answers);
  const studentUrl = (id?: string) => id ? `/intake?student=${encodeURIComponent(id)}` : "/dashboard";
  return <main className="flex flex-col gap-6">
    <header className="border-b border-line pb-5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Campus Passage · {student.name}&apos;s plan</p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink sm:text-4xl">Plan preferences</h1>
      <p className="mt-2 max-w-3xl text-ink/65">Tell us what {student.name} might need. You can change these answers as plans evolve. Each student&apos;s answers stay in their own plan.</p>
      <p className="mt-2 text-sm text-ink/55">Campus Passage explains steps and links to official instructions. We do not apply, submit, decide eligibility, or make school decisions for you.</p>
      <Link href={`/dashboard?student=${encodeURIComponent(student.id)}`} className="mt-3 inline-block text-sm font-medium text-accent underline">Back to {student.name}&apos;s dashboard</Link>
    </header>
    <StudentSwitcher students={students} selectedStudentId={student.id} hrefFor={studentUrl} />
    {isDemo && <p className="rounded-xl border border-accent/25 bg-accent/10 p-3 text-sm text-ink/75">Private Preview · These sample preferences are read-only.</p>}
    {query.saved === "1" && <p role="status" className="rounded-xl border border-ok/30 bg-ok/10 p-3 text-sm text-ink">Preferences saved for {student.name}. Tracked school plans were refreshed.</p>}
    <aside className="rounded-xl border border-warn/30 bg-warn/10 p-4 text-sm text-ink/80">
      <strong>School requirements come first.</strong> A No answer may set aside optional planning items; it cannot waive a school requirement. Unsure and Ask me later keep potentially relevant steps visible. School-specific answers in <Link href={`/welcome?student=${encodeURIComponent(student.id)}`} className="underline">school settings</Link> take precedence over these general preferences. Check the school&apos;s official policy for exceptions or conflicts.
    </aside>
    <form action={saveIntake} className="flex flex-col gap-5">
      <input type="hidden" name="studentId" value={student.id} />
      <div className="grid gap-4 md:grid-cols-2">{INTAKE_QUESTIONS.map((question, index) => <div key={question.key} className="rounded-2xl border border-line bg-white/80 p-5 shadow-card">
        <label htmlFor={`answer-${question.key}`} className="block text-sm font-semibold text-ink">{index + 1}. {question.title}</label>
        <p className="mt-1 text-sm text-ink/60">{question.prompt}</p>
        <select id={`answer-${question.key}`} name={question.key} defaultValue={answers[question.key] ?? "ask_later"} disabled={isDemo} className="mt-3 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink disabled:opacity-60">
          {(question.kind === "housing" ? HOUSING_OPTIONS : CHOICE_OPTIONS).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>)}</div>
      <div><button disabled={isDemo} type="submit" className="rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Save {student.name}&apos;s preferences</button></div>
    </form>
    <section aria-label="Preference overview" className="rounded-2xl border border-line bg-white/80 p-5 text-sm text-ink/70">
      <h2 className="font-display text-xl font-semibold text-ink">Current planning picture</h2>
      <p className="mt-2">{summary.explore.length} areas to explore · {summary.open.length} left open · {summary.setAside.length} set aside for now.</p>
      <p className="mt-1 text-ink/55">This is a preference summary, not a count of school requirements or a decision about what applies. Save changes to refresh tracked school steps.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">{[
        { heading: "To explore", items: summary.explore },
        { heading: "Keep open", items: summary.open },
        { heading: "Optional planning set aside", items: summary.setAside },
      ].map(({ heading, items }) => <div key={heading}><h3 className="font-semibold text-ink">{heading}</h3>{items.length ? <ul className="mt-1 list-inside list-disc">{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="mt-1 text-ink/50">None yet</p>}</div>)}</div>
    </section>
  </main>;
}
