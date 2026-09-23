import { requireOnboardedHousehold } from '@/lib/auth/session';
import { assistantEnabled } from '@/lib/db/ask-campus';
import AskForm from './AskForm';
export const dynamic = 'force-dynamic';
export default async function AskPage() {
 const ctx = await requireOnboardedHousehold();
 const enabled = assistantEnabled();
 return <main className="mx-auto max-w-2xl space-y-5 py-8"><p className="text-xs font-semibold uppercase tracking-widest text-accent">Campus Passage · {enabled ? 'Grounded source lookup' : 'Not available'}</p><h1 className="font-display text-3xl">Ask Campus Passage</h1><p className="text-sm text-ink/65">{enabled ? 'Ask about a tracked school task. Answers quote current, certified official sources for the student’s entering term. If sources are insufficient or conflict, we will say so. No eligibility or completion decisions. Do not share private information.' : 'Ask Campus Passage is not enabled. No questions can be submitted.'}</p>{enabled && <AskForm studentId={ctx.student.id}/>}</main>;
}
