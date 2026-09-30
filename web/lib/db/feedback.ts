import { z } from 'zod';
import { exec, newId, nowIso, queryOne, queryRows, withTransaction } from './client';
import type { HouseholdContext } from './accounts';
import { isAdministratorEmail } from '@/lib/auth/admin';

const textSchema = z.string().min(1).max(4000).refine(v => v.trim().length > 0, 'Please enter your feedback.');
export const feedbackSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  feedbackText: textSchema,
  followUpConsent: z.boolean(),
  testimonialConsent: z.boolean(),
});
export type FeedbackInput = z.infer<typeof feedbackSchema>;

/** Raw submitted text is stored verbatim; validation never rewrites the response. */
export async function submitFeedback(ctx: HouseholdContext, input: unknown): Promise<string> {
  const data = feedbackSchema.parse(input);
  return withTransaction(async () => {
    const link = await queryOne('SELECT 1 AS ok FROM auth_links WHERE auth_user_id=$1 AND household_id=$2', [ctx.authUserId, ctx.household.id]);
    if (!link) throw new Error('Household membership required');
    const day = nowIso().slice(0,10);
    const count = await queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM household_feedback WHERE auth_user_id=$1 AND created_at>=$2', [ctx.authUserId, `${day}T00:00:00.000Z`]);
    if (Number(count?.n ?? 0) >= 5) throw new Error('Feedback limit reached for today.');
    const id = newId('feedback');
    await exec(`INSERT INTO household_feedback(id,household_id,auth_user_id,rating,feedback_text,follow_up_consent,testimonial_consent,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [id, ctx.household.id, ctx.authUserId, data.rating, data.feedbackText, data.followUpConsent ? 1 : 0, data.testimonialConsent ? 1 : 0, nowIso()]);
    return id;
  });
}

/** Individual configured admin identity AND live owner link; never just an email or household ID. */
export async function requireFeedbackAdmin(user: {id: string; email: string | null}): Promise<void> {
  if (!isAdministratorEmail(user.email) || !await queryOne('SELECT 1 AS ok FROM auth_links WHERE auth_user_id=$1 AND role=$2', [user.id, 'owner']))
    throw new Error('Individual administrator authorization required');
}

/** Authorization is rechecked at the read boundary, not only by the route. */
export async function listFeedbackForAdmin(user: {id: string; email: string | null}, limit = 30) {
  await requireFeedbackAdmin(user);
  const rows = await queryRows<{ id: string; household_id: string; auth_user_id: string; rating: number; feedback_text: string; follow_up_consent: number; testimonial_consent: number; created_at: string }>(
    'SELECT id,household_id,auth_user_id,rating,feedback_text,follow_up_consent,testimonial_consent,created_at FROM household_feedback ORDER BY created_at DESC,id DESC LIMIT $1',
    [Math.max(1, Math.min(50, Math.floor(limit)))]);
  return rows.map(r => ({ ...r, follow_up_consent: !!r.follow_up_consent, testimonial_consent: !!r.testimonial_consent }));
}
