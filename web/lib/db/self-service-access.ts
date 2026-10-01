import { completeOnboarding, getPurchaserAttestation, isDemoOwnerEmail, requireWritableHousehold, type HouseholdContext, type StudentSetup } from './accounts';
import { exec, newId, nowIso, queryOne, queryRows, usingPostgres, withTransaction } from './client';
import { currentAccessCycle } from './cycle-access';

/** No invitation, order or payment is created. The route supplies a verified Supabase user. */
export async function canSelfServiceOnboard(ctx: HouseholdContext): Promise<boolean> {
  if (!ctx.email || !ctx.isOwner || ctx.isDemo || ctx.household.id === process.env.DEMO_TEMPLATE_HOUSEHOLD_ID) return false;
  // The email in a caller's context must match the persisted identity link;
  // an unverified or changed address cannot claim another person's shell.
  const link = await queryOne<{ email: string | null }>('SELECT email FROM auth_links WHERE auth_user_id=$1 AND household_id=$2 AND role=$3', [ctx.authUserId, ctx.household.id, 'owner']);
  if (!link?.email || link.email.trim().toLowerCase() !== ctx.email.trim().toLowerCase()) return false;
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

/** A revoked household cannot fall through to a legacy complimentary/paid grant. */
export async function selfServiceAccessRevoked(householdId: string): Promise<boolean> {
  return !!await queryOne('SELECT 1 AS ok FROM self_service_access WHERE household_id=$1 AND revoked_at IS NOT NULL', [householdId]);
}

/** A different term never inherits this household's research capacity. */
export async function assertSelfServiceAccessCycle(householdId: string, cycle: string): Promise<boolean> {
  if (await hasSelfServiceAccess(householdId, cycle)) return true;
  if (await hasSelfServiceAccess(householdId)) throw new Error('This plan is available for its original admissions cycle only.');
  return false;
}

/** Only an identical repeated submission is a no-op; never repair revoked access via retry. */
async function sameCompletedSetup(ctx: HouseholdContext, input: { role: 'parent' | 'student'; students: StudentSetup[] }, cycle: string): Promise<boolean> {
  const grant = await queryOne<{ cycle: string; auth_user_id: string; starts_at: string; expires_at: string; revoked_at: string | null }>(
    'SELECT cycle,auth_user_id,starts_at,expires_at,revoked_at FROM self_service_access WHERE household_id=$1', [ctx.household.id]);
  if (!grant || grant.revoked_at || grant.auth_user_id !== ctx.authUserId || grant.cycle !== cycle || grant.starts_at > nowIso() || grant.expires_at <= nowIso()) return false;
  const saved = await queryRows<{ name: string; attributes: string }>('SELECT name,attributes FROM students WHERE household_id=$1 ORDER BY created_at,id', [ctx.household.id]);
  const [attestation, link] = await Promise.all([
    getPurchaserAttestation(ctx.household.id),
    queryOne<{ email: string | null; role: string; person_role: string | null }>(`SELECT l.email,l.role,p.role AS person_role FROM auth_links l LEFT JOIN people p ON p.id=l.person_id
      WHERE l.auth_user_id=$1 AND l.household_id=$2`, [ctx.authUserId,ctx.household.id]),
  ]);
  return !!attestation && attestation.attestedBy === ctx.authUserId && !!ctx.email &&
    link?.email?.trim().toLowerCase() === ctx.email.trim().toLowerCase() && link.role === 'owner' &&
    link.person_role === input.role && saved.length === input.students.length && saved.every((student, i) => {
    try { return student.name === input.students[i].name.trim().slice(0, 60) && JSON.parse(student.attributes || '{}').enteringTerm === cycle; }
    catch { return false; }
  });
}

export async function completeSelfServiceOnboarding(ctx: HouseholdContext, input: {
  role: 'parent' | 'student'; students: StudentSetup[]; purchaserAttested: boolean;
}): Promise<void> {
  const cycle = currentAccessCycle();
  if (!input.purchaserAttested || !input.students.length || input.students.some(s => s.enteringTerm !== cycle))
    throw new Error('Choose the current supported admissions cycle.');
  await withTransaction(async () => {
    if (usingPostgres) await exec('SELECT pg_advisory_xact_lock(hashtext($1))', [`self-service:${ctx.household.id}`]);
    if (await sameCompletedSetup(ctx, input, cycle)) return;
    if (!await canSelfServiceOnboard(ctx)) throw new Error('This household is not eligible for first-time setup.');
    await requireWritableHousehold(ctx);
    await completeOnboarding(ctx, input);
    const now = nowIso();
    const expiry = `${Number(cycle.slice(-4)) + 1}-08-01T00:00:00.000Z`;
    if (expiry <= now) throw new Error('This admissions cycle has ended.');
    await exec(`INSERT INTO self_service_access(household_id,cycle,auth_user_id,starts_at,expires_at,created_at)
      VALUES($1,$2,$3,$4,$5,$6)`, [ctx.household.id, cycle, ctx.authUserId, now, expiry, now]);
    await exec(`INSERT INTO cycle_audit_events(id,order_id,household_id,event_type,reference,actor,detail_code,created_at)
      VALUES($1,NULL,$2,'self_service_granted',$3,$4,'verified_email_onboarding',$5)`,
      [newId('audit'), ctx.household.id, `self-service:${ctx.household.id}`, ctx.authUserId, now]);
  });
}

/** Exceptional fraud/abuse/support suspension; never part of routine sign-up. No migration or payment. */
export async function suspendSelfServiceHousehold(input: { householdId: string; actor: { id: string; email: string }; reason: string }): Promise<boolean> {
  if (!isDemoOwnerEmail(input.actor.email) || input.reason.trim().length < 4 || input.reason.length > 200)
    throw new Error('Administrator authorization and a reason are required.');
  return withTransaction(async () => {
    const actor = await queryOne('SELECT 1 AS ok FROM auth_links WHERE auth_user_id=$1 AND role=$2', [input.actor.id, 'owner']);
    if (!actor) throw new Error('Administrator authorization required.');
    const now = nowIso();
    const changed = await queryOne<{ household_id: string }>(`UPDATE self_service_access SET revoked_at=$1
      WHERE household_id=$2 AND revoked_at IS NULL RETURNING household_id`, [now, input.householdId]);
    if (!changed) return false;
    await exec(`INSERT INTO cycle_audit_events(id,order_id,household_id,event_type,reference,actor,detail_code,created_at)
      VALUES($1,NULL,$2,'access_revoked',$3,$4,$5,$6)`,
      [newId('audit'), input.householdId, `self-service-suspend:${input.householdId}`, input.actor.id, input.reason.trim(), now]);
    return true;
  });
}
