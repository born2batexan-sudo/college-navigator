import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
export default async function AccessUnavailable() {
  await requireUser({ next: '/access-unavailable' });
  return <main className="mx-auto max-w-xl p-8"><h1 className="font-display text-3xl">Plan unavailable</h1><p className="mt-4">This household plan is not active for this admissions cycle. No changes were made. If you believe this is an error, contact Campus Passage support.</p><Link className="mt-4 inline-block underline" href="/">Return home</Link></main>;
}
