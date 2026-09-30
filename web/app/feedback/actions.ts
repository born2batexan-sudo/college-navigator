'use server';
import { redirect } from 'next/navigation';
import { requireWritableOnboardedHousehold } from '@/lib/auth/session';
import { feedbackSchema, submitFeedback } from '@/lib/db/feedback';

export async function saveFeedback(formData: FormData): Promise<void> {
  const ctx = await requireWritableOnboardedHousehold();
  const parsed = feedbackSchema.safeParse({
    rating: formData.get('rating'),
    feedbackText: formData.get('feedbackText'),
    followUpConsent: formData.get('followUpConsent') === 'yes',
    testimonialConsent: formData.get('testimonialConsent') === 'yes',
  });
  if (!parsed.success) redirect(`/feedback?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'Please check your feedback.')}`);
  try { await submitFeedback(ctx, parsed.data); }
  catch (error) { const message = error instanceof Error ? error.message : 'Could not save feedback.'; redirect(`/feedback?error=${encodeURIComponent(message)}`); }
  redirect('/feedback?sent=1');
}
