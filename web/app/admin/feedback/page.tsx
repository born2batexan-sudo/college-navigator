import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireDemoOwner } from '@/lib/auth/session';
import { listFeedbackForAdmin } from '@/lib/db/feedback';
export const dynamic = 'force-dynamic';
export default async function AdminFeedbackPage() {
  const admin = await requireDemoOwner();
  let entries: Awaited<ReturnType<typeof listFeedbackForAdmin>>;
  try { entries = await listFeedbackForAdmin(admin, 30); }
  catch { notFound(); }
  return <main className="mx-auto max-w-3xl space-y-6 py-8">
    <Link href="/admin/demo" className="underline">← Administration</Link>
    <h1 className="font-display text-3xl font-semibold">Private feedback review</h1>
    <p className="text-sm text-ink/65">Latest 30, read-only. Consent to consider a testimonial is not authorization to publish automatically. No email addresses or student details are shown.</p>
    {entries.length === 0 ? <p>No submissions yet.</p> : <ol className="space-y-4">{entries.map(row => <li key={row.id} className="rounded-xl border border-line bg-white p-5">
      <p className="text-xs text-ink/55">{row.created_at} · Household {row.household_id} · User {row.auth_user_id}</p>
      <p className="mt-2 font-semibold">{row.rating} / 5</p><p className="mt-2 whitespace-pre-wrap break-words">{row.feedback_text}</p>
      <p className="mt-3 text-xs text-ink/65">Follow-up: {row.follow_up_consent ? 'yes' : 'no'} · Testimonial consideration: {row.testimonial_consent ? 'yes' : 'no'}</p>
    </li>)}</ol>}
  </main>;
}
