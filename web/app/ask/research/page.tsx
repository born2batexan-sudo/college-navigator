import { requireOnboardedHousehold } from '@/lib/auth/session';
import { assistantEnabled } from '@/lib/db/ask-campus';
import AskForm from './AskForm';

export const dynamic = 'force-dynamic';

export default async function AskPage() {
  const ctx = await requireOnboardedHousehold();
  const enabled = assistantEnabled();
  return (
    <main className="mx-auto max-w-2xl space-y-5 py-8">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">Campus Passage · Your journey</p>
      <h1 className="font-display text-3xl">Ask about your journey</h1>
      <p className="text-sm text-ink/65">
        {enabled
          ? 'Ask about a task at a college you track for this student. When a current, certified official source supports the answer for the entering term, you’ll see its quotation and citation. If the evidence is missing or conflicts, check the school’s current instructions.'
          : 'Ask about your journey is temporarily unavailable. Your household plan remains available; check each school’s official instructions for current details.'}
      </p>
      {enabled && <AskForm studentId={ctx.student.id} />}
    </main>
  );
}
