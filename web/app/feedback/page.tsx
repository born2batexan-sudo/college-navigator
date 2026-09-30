import Link from 'next/link';
import { requireOnboardedHousehold } from '@/lib/auth/session';
import { saveFeedback } from './actions';
export const dynamic = 'force-dynamic';
export default async function FeedbackPage({searchParams}: {searchParams: Promise<{sent?: string; error?: string}>}) {
  const ctx = await requireOnboardedHousehold();
  const query = await searchParams;
  return <main className="mx-auto flex max-w-2xl flex-col gap-6 py-8">
    <Link href="/dashboard" className="text-sm underline">← Back to your plan</Link>
    <h1 className="font-display text-3xl font-semibold">Share feedback</h1>
    <p className="text-sm text-ink/70">Your response stays private for individual review. Giving testimonial permission does not publish it. Please do not include sensitive student, financial, or medical details.</p>
    {ctx.isDemo ? <p className="rounded border border-line p-4">Feedback submission is unavailable in the read-only preview.</p> : query.sent ? <p role="status" className="rounded border border-line p-4">Thank you. Your feedback was saved for review.</p> : <form action={saveFeedback} className="flex flex-col gap-5 rounded-2xl border border-line bg-white p-6">
      {query.error && <p role="alert" className="text-urgent">{query.error}</p>}
      <label className="flex flex-col gap-2">Rating
        <select name="rating" required defaultValue="" className="rounded border border-line p-2"><option value="" disabled>Choose a rating</option>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n} / 5</option>)}</select>
      </label>
      <label className="flex flex-col gap-2">Your feedback
        <textarea name="feedbackText" required maxLength={4000} rows={7} className="rounded border border-line p-3" />
      </label>
      <label className="flex items-start gap-3"><input type="checkbox" name="followUpConsent" value="yes" className="mt-1" />You may contact me about this response.</label>
      <label className="flex items-start gap-3"><input type="checkbox" name="testimonialConsent" value="yes" className="mt-1" />You may consider this response as a testimonial. This does not publish it; please review with me before any use.</label>
      <button className="self-start rounded bg-accent px-5 py-2 text-white" type="submit">Send feedback</button>
    </form>}
    <p className="text-xs text-ink/50">Submitted with your signed-in household and timestamp; your choices are recorded separately. Household {ctx.household.name}.</p>
  </main>;
}
