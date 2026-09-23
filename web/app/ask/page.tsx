import { requireOnboardedHousehold } from '@/lib/auth/session';
import AskForm from './AskForm';
export const dynamic='force-dynamic';
export default async function AskPage() {
 const ctx=await requireOnboardedHousehold();
 return <main className="mx-auto max-w-2xl space-y-5 py-8"><p className="text-xs font-semibold uppercase tracking-widest text-accent">Campus Passage · Built—not live</p><h1 className="font-display text-3xl">Ask Campus Passage</h1><p className="text-sm text-ink/65">Review-only source lookup for certified school research. It cannot apply, submit, decide, pay, change records, or inspect your inbox. Do not share private information here. Verify time-sensitive details with the school.</p><AskForm studentId={ctx.student.id}/></main>;
}
