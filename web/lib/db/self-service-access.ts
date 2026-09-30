import { completeOnboarding, requireWritableHousehold, type HouseholdContext, type StudentSetup } from './accounts';
import { exec, newId, nowIso, queryOne, usingPostgres, withTransaction } from './client';
import { currentAccessCycle } from './cycle-access';

/** No invitation, order or payment is created. Only a verified email session may call the onboarding action. */
export async function canSelfServiceOnboard(ctx: HouseholdContext): Promise<boolean> {
  if (!ctx.email || !ctx.isOwner || ctx.isDemo || ctx.household.id === process.env.DEMO_TEMPLATE_HOUSEHOLD_ID) return false;
  const link = await queryOne('SELECT 1 AS ok FROM auth_links WHERE auth_user_id=$1 AND household_id=$2 AND role=$3', [ctx.authUserId, ctx.household.id, 'owner']);
  if (!link) return false;
  const [student, order, grant, invitation] = await Promise.all([
    queryOne('SELECT 1 AS ok FROM students WHERE household_id=$1', [ctx.household.id]),
    queryOne('SELECT 1 AS ok FROM cycle_orders WHERE household_id=$1', [ctx.household.id]),
    queryOne('SELECT 1 AS ok FROM self_service_access WHERE household_id=$1', [ctx.household.id]),
    queryOne('SELECT 1 AS ok FROM beta_access_invites WHERE accepted_household_id=$1', [ctx.household.id]),
  ]);
  return !student && !order && !grant && !invitation;
}

export async function hasSelfServiceAccess(householdId: string, cycle?: string): Promise<boolean> {
  const now = nowIso();
  return !!await queryOne(`SELECT 1 AS ok FROM self_service_access WHERE household_id=$1
    AND starts_at<=$2 AND expires_at>$3 AND revoked_at IS NULL${cycle ? ' AND cycle=$4' : ''}`,
    cycle ? [householdId, now, now, cycle] : [householdId, now, now]);
}

/** A different term never inherits this household's research capacity. */
export async function assertSelfServiceAccessCycle(householdId: string, cycle: string): Promise<boolean> {
  if (await hasSelfServiceAccess(householdId, cycle)) return true;
  if (await hasSelfServiceAccess(householdId)) throw new Error('This plan is available for its original admissions cycle only.');
  return false;
}

export async function completeSelfServiceOnboarding(ctx: HouseholdContext, input: {
  role: 'parent' | 'student'; students: StudentSetup[]; purchaserAttested: boolean;
}): Promise<void> {
  const cycle = currentAccessCycle();
  if (!input.purchaserAttested || !input.students.length || input.students.some(s => s.enteringTerm !== cycle))
    throw new Error('Choose the current supported admissions cycle.');
  await withTransaction(async () => {
    if (usingPostgres) await exec('SELECT pg_advisory_xact_lock(hashtext($1))', [`self-service:${ctx.household.id}`]);
    if (!await canSelfServiceOnboard(ctx)) throw new Error('This household is not eligible for first-time setup.');
    await requireWritableHousehold(ctx);
    await completeOnboarding(ctx, input);
    const now = nowIso();
    const expiry = `${Number(cycle.slice(-4)) + 1}-08-01T00:00:00.000Z`;
    if (expiry <= now) throw new Error('This admissions cycle has ended.');
    await exec(`INSERT INTO self_service_access(household_id,cycle,auth_user_id,starts_at,expires_at,created_at)
      VALUES($1,$2,$3,$4,$5,$6)`, [ctx.household.id, cycle, ctx.authUserId, now, expiry, now]);
  });
}
