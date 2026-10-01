import { CHOICE_OPTIONS, HOUSING_OPTIONS, INTAKE_QUESTIONS, type IntakeAnswers } from "@/lib/intake";

type Props = {
  studentId: string;
  studentName: string;
  answers: Partial<IntakeAnswers>;
  isDemo: boolean;
  action: (formData: FormData) => void | Promise<void>;
};

/** Key the actual form, not just its defaults: client navigation otherwise reuses dirty native selects. */
export function IntakeForm({ studentId, studentName, answers, isDemo, action }: Props) {
  return <form key={studentId} action={action} className="flex flex-col gap-5">
    <input type="hidden" name="studentId" value={studentId} />
    <div className="grid gap-4 md:grid-cols-2">{INTAKE_QUESTIONS.map((question, index) => <div key={question.key} className="rounded-2xl border border-line bg-white/80 p-5 shadow-card">
      <label htmlFor={`answer-${question.key}`} className="block text-sm font-semibold text-ink">{index + 1}. {question.title}</label>
      <p className="mt-1 text-sm text-ink/60">{question.prompt}</p>
      <select id={`answer-${question.key}`} name={question.key} defaultValue={answers[question.key] ?? "ask_later"} disabled={isDemo} className="mt-3 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink disabled:opacity-60">
        {(question.kind === "housing" ? HOUSING_OPTIONS : CHOICE_OPTIONS).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>)}</div>
    <div><button disabled={isDemo} type="submit" className="rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Save {studentName}&apos;s preferences</button></div>
  </form>;
}
