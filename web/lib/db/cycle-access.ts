// Review-only household-cycle access and append-only cash/consideration ledger.
import { createHash, randomBytes } from 'node:crypto';
import { exec, newId, nowIso, queryOne, queryRows, usingPostgres, withTransaction } from './client';
import { isDemoOwnerEmail } from './accounts';

export type Actor = { id: string; email: string };
const cycle = () => { const value = process.env.ACCESS_CYCLE?.trim(); if (!value || !/^Fall 20\d\d$/.test(value)) throw new Error('ACCESS_CYCLE is not configured'); return value; };
function endOfCycle(value: string): string { return `${Number(value.slice(-4)) + 1}-08-01T00:00:00.000Z`; }
async function owner(actor: Actor) {
 if (!isDemoOwnerEmail(actor.email)) throw new Error('Owner authorization required');
 const link = await queryOne('SELECT 1 AS ok FROM auth_links WHERE auth_user_id=$1 AND role=$2', [actor.id,'owner']);
 if (!link) throw new Error('Owner authorization required');
}
async function household(id: string) {
 if (!await queryOne('SELECT 1 AS ok FROM households WHERE id=$1', [id]) || await queryOne('SELECT 1 AS ok FROM demo_households WHERE household_id=$1', [id]) || id === process.env.DEMO_TEMPLATE_HOUSEHOLD_ID) throw new Error('Eligible household required');
}
export async function assertHouseholdCycle(id:string, term:string) {
 const students=await queryRows<{attributes:string}>('SELECT attributes FROM students WHERE household_id=$1',[id]);
 if (!students.length || !students.every(s=>{
  try { return JSON.parse(s.attributes).enteringTerm===term; } catch { return false; }
 })) throw new Error('Household students must share this admissions cycle');
}
async function capLock() {
 if (usingPostgres) await exec('SELECT pg_advisory_xact_lock(hashtext($1))', ['complimentary-lifetime-cap']);
}
async function assertCap(id: string) {
 const found = await queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM (
 SELECT 'h:'||household_id AS household_key FROM complimentary_invites
 UNION SELECT CASE WHEN household_id IS NULL THEN 'deleted:'||id ELSE 'h:'||household_id END AS household_key
 FROM cycle_orders WHERE kind='complimentary') households`);
 const prior = await queryOne('SELECT 1 AS ok FROM complimentary_invites WHERE household_id=$1 UNION SELECT 1 AS ok FROM cycle_orders WHERE household_id=$2 AND kind=$3', [id,id,'complimentary']);
 if (!prior && Number(found?.n ?? 0) >= 25) throw new Error('Complimentary household cap reached');
}
async function audit(householdId: string, orderId: string | null, type: string, ref: string, actor: string, detail: string) {
 await exec('INSERT INTO cycle_audit_events(id,order_id,household_id,event_type,reference,actor,detail_code,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(reference) DO NOTHING', [newId('audit'),orderId,householdId,type,ref,actor,detail,nowIso()]);
}
async function entry(orderId: string, kind: string, cents: number, ref: string, actor: string, reason: string | null = null) {
 if (!Number.isSafeInteger(cents)) throw new Error('Invalid accounting amount');
 await exec('INSERT INTO cycle_accounting_events(id,order_id,kind,cents,reference,actor,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(reference) DO NOTHING', [newId('ledger'),orderId,kind,cents,ref,actor,reason,nowIso()]);
}
async function createComplimentary(householdId: string, actor: Actor, reason: string, reference: string) {
 const term = cycle(); const existing = await queryOne<any>('SELECT * FROM cycle_entitlements WHERE household_id=$1 AND cycle=$2', [householdId,term]);
 if (existing) throw new Error('Household-cycle already has access');
 await assertCap(householdId);
 const now = nowIso(), orderId = newId('order');
 await exec(`INSERT INTO cycle_orders(id,household_id,cycle,kind,price_id,amount_cents,status,idempotency_key,created_at,updated_at) VALUES($1,$2,$3,'complimentary',NULL,0,'complimentary',$4,$5,$6)`, [orderId,householdId,term,reference,now,now]);
 await entry(orderId,'complimentary',0,`consideration:${reference}`,actor.id,reason);
 await exec(`INSERT INTO cycle_entitlements(id,household_id,cycle,order_id,kind,starts_at,expires_at,authorized_by,reason) VALUES($1,$2,$3,$4,'complimentary',$5,$6,$7,$8)`, [newId('access'),householdId,term,orderId,now,endOfCycle(term),actor.id,reason]);
 await audit(householdId,orderId,'complimentary_granted',`grant:${reference}`,actor.id,reason);
 return orderId;
}
export async function grantComplimentary(input: { householdId: string; actor: Actor; reason: string; idempotencyKey: string }) {
 await owner(input.actor); await household(input.householdId); await assertHouseholdCycle(input.householdId,cycle()); if (input.reason.trim().length < 4 || input.reason.length > 200 || !input.idempotencyKey.trim()) throw new Error('Reason and idempotency key required');
 return withTransaction(async () => {
  await capLock(); const key = `manual:${input.idempotencyKey}`;
  const prior = await queryOne<any>('SELECT * FROM cycle_orders WHERE idempotency_key=$1',[key]);
  if (prior) { if (prior.household_id !== input.householdId || prior.cycle !== cycle() || prior.kind !== 'complimentary') throw new Error('Idempotency key conflict'); return prior.id as string; }
  return createComplimentary(input.householdId,input.actor,input.reason.trim(),key);
 });
}
export async function issueComplimentaryInvite(input: { householdId: string; actor: Actor; reason: string; kind: 'complimentary'|'founding_family' }) {
 await owner(input.actor); await household(input.householdId); await assertHouseholdCycle(input.householdId,cycle());
 if (input.reason.trim().length < 4 || input.reason.length > 200 || !['complimentary','founding_family'].includes(input.kind)) throw new Error('Reason and valid kind required');
 return withTransaction(async () => {
  await capLock(); await assertCap(input.householdId);
  if (await queryOne('SELECT 1 AS ok FROM cycle_entitlements WHERE household_id=$1 AND cycle=$2',[input.householdId,cycle()])) throw new Error('Household-cycle already has access');
  const token = randomBytes(32).toString('base64url'), expiresAt = new Date(Date.now()+7*86400000).toISOString(), id = newId('invite');
  await exec('INSERT INTO complimentary_invites(id,household_id,cycle,token_hash,kind,reason,authorized_by,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id,input.householdId,cycle(),createHash('sha256').update(token).digest('hex'),input.kind,input.reason.trim(),input.actor.id,expiresAt,nowIso()]);
  await audit(input.householdId,null,'invite_issued',`invite:${id}`,input.actor.id,input.kind);
  return { token, expiresAt, id };
 });
}
export async function claimComplimentaryInvite(input: { token: string; householdId: string; authUserId: string }) {
 if (!/^[A-Za-z0-9_-]{43}$/.test(input.token)) throw new Error('Invalid invitation');
 return withTransaction(async () => {
  await capLock();
  const link = await queryOne('SELECT 1 AS ok FROM auth_links WHERE household_id=$1 AND auth_user_id=$2 AND role=$3',[input.householdId,input.authUserId,'owner']);
  if (!link) throw new Error('Household owner required');
  await household(input.householdId); await assertHouseholdCycle(input.householdId,cycle());
  const hash = createHash('sha256').update(input.token).digest('hex');
  const invite = await queryOne<any>(`SELECT * FROM complimentary_invites WHERE token_hash=$1${usingPostgres?' FOR UPDATE':''}`,[hash]);
  if (!invite || invite.household_id !== input.householdId || invite.cycle !== cycle() || invite.revoked_at || invite.claimed_at || Date.parse(invite.expires_at) <= Date.now()) throw new Error('Invitation unavailable');
  const orderId = await createComplimentary(input.householdId,{id:invite.authorized_by,email:process.env.DEMO_OWNER_EMAIL!},invite.reason,`invite:${invite.id}`);
  await exec('UPDATE complimentary_invites SET claimed_at=$1 WHERE id=$2 AND claimed_at IS NULL',[nowIso(),invite.id]);
  return orderId;
 });
}
export async function revokeComplimentary(input: { householdId: string; actor: Actor; reason: string }) {
 await owner(input.actor); if (input.reason.trim().length < 4) throw new Error('Revocation reason required');
 return withTransaction(async () => {
  const now = nowIso(), term = cycle();
  await exec('UPDATE complimentary_invites SET revoked_at=$1 WHERE household_id=$2 AND cycle=$3 AND revoked_at IS NULL AND claimed_at IS NULL',[now,input.householdId,term]);
  const row = await queryOne<any>('SELECT * FROM cycle_entitlements WHERE household_id=$1 AND cycle=$2 AND kind=$3',[input.householdId,term,'complimentary']);
  if (row && !row.revoked_at) {
   await exec('UPDATE cycle_entitlements SET revoked_at=$1,revoked_by=$2 WHERE id=$3',[now,input.actor.id,row.id]);
   await audit(input.householdId,row.order_id,'access_revoked',`revoke:${row.id}`,input.actor.id,input.reason.trim());
  }
  return !!row;
 });
}
export async function accessSummary() {
 const [requests, grants, payments, exceptions, webhookExceptions] = await Promise.all([
  queryOne<any>("SELECT COUNT(*) AS n FROM demo_access_requests WHERE status='pending'"),
  queryOne<any>("SELECT COUNT(*) AS n FROM cycle_entitlements WHERE kind='complimentary' AND revoked_at IS NULL"),
  queryOne<any>("SELECT COUNT(*) AS n FROM cycle_orders WHERE status='paid'"),
  queryRows<any>("SELECT id,household_id,cycle,status FROM cycle_orders WHERE status='exception' ORDER BY created_at DESC LIMIT 20"),
  queryRows<any>("SELECT event_id,detail_code FROM stripe_webhook_events WHERE status='exception' ORDER BY received_at DESC LIMIT 20")
 ]);
 return { requests: Number(requests?.n ?? 0), grants: Number(grants?.n ?? 0), payments: Number(payments?.n ?? 0), exceptions, webhookExceptions };
}
export async function reconciliationStatus(orderId:string) {
 const order=await queryOne<any>('SELECT status FROM cycle_orders WHERE id=$1',[orderId]);
 if (!order || order.status==='exception') return 'exception';
 const fee=await queryOne('SELECT 1 AS ok FROM cycle_accounting_events WHERE order_id=$1 AND kind=$2',[orderId,'provider_fee']);
 if (order.status==='pending' || (order.status!=='complimentary' && !fee)) return 'pending';
 const totals=await accountingTotals(orderId);
 return totals.netCash===totals.payments+totals.refunds-totals.providerFees?'reconciled':'exception';
}
export async function accountingTotals(orderId: string) {
 const rows = await queryRows<{kind:string;cents:number}>('SELECT kind,cents FROM cycle_accounting_events WHERE order_id=$1',[orderId]);
 const sum = (kind:string) => rows.filter(r=>r.kind===kind).reduce((n,r)=>n+Number(r.cents),0);
 return { payments:sum('payment'),refunds:sum('refund'),providerFees:sum('provider_fee'),netCash:sum('net_cash'),discounts:sum('discount'),complimentary:sum('complimentary') };
}
export { cycle as currentAccessCycle, endOfCycle, entry as recordAccountingEntry, audit as recordCycleAudit };
