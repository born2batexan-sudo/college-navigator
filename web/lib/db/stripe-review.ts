// Disabled-by-default Stripe server boundary. No client amount, no redirect-based grants.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { exec, newId, nowIso, queryOne, usingPostgres, withTransaction } from './client';
import { currentAccessCycle, endOfCycle, recordAccountingEntry, recordCycleAudit, accountingTotals, assertHouseholdCycle } from './cycle-access';
import { isDemoOwnerEmail } from './accounts';

export function stripeReady(): boolean {
 return process.env.STRIPE_REVIEW_ENABLED === '1' && !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET && !!process.env.STRIPE_PRICE_ID && !!process.env.STRIPE_EXPECTED_AMOUNT_CENTS && !!process.env.APP_ORIGIN;
}
function price(): number { const n = Number(process.env.STRIPE_EXPECTED_AMOUNT_CENTS); if (!Number.isSafeInteger(n) || n <= 0) throw new Error('Expected price is not configured'); return n; }
function origin(): string { const url = new URL(process.env.APP_ORIGIN!); if (!['https:','http:'].includes(url.protocol) || (url.protocol==='http:' && !['localhost','127.0.0.1'].includes(url.hostname)) || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid APP_ORIGIN'); return url.origin; }
export async function createCheckout(input: { householdId: string; authUserId: string; idempotencyKey: string }): Promise<string> {
 if (!stripeReady()) throw new Error('Checkout is not enabled');
 if (!/^[\w-]{8,100}$/.test(input.idempotencyKey)) throw new Error('Invalid idempotency key');
 const term = currentAccessCycle(), amount = price(), priceId = process.env.STRIPE_PRICE_ID!, site = origin();
 const order = await withTransaction(async () => {
  if (usingPostgres) await exec('SELECT pg_advisory_xact_lock(hashtext($1))',[`checkout:${input.householdId}:${term}`]);
  const link = await queryOne('SELECT 1 AS ok FROM auth_links WHERE household_id=$1 AND auth_user_id=$2 AND role=$3',[input.householdId,input.authUserId,'owner']);
  if (!link || input.householdId === process.env.DEMO_TEMPLATE_HOUSEHOLD_ID || await queryOne('SELECT 1 AS ok FROM demo_households WHERE household_id=$1',[input.householdId])) throw new Error('Household owner required');
  await assertHouseholdCycle(input.householdId,term);
  const existing = await queryOne<any>('SELECT * FROM cycle_orders WHERE idempotency_key=$1',[`checkout:${input.idempotencyKey}`]);
  if (existing) { if (existing.household_id !== input.householdId || existing.cycle !== term || existing.kind !== 'paid') throw new Error('Idempotency key conflict'); return existing; }
  if (await queryOne('SELECT 1 AS ok FROM cycle_entitlements WHERE household_id=$1 AND cycle=$2',[input.householdId,term])) throw new Error('Already entitled');
  const pending=await queryOne<any>("SELECT * FROM cycle_orders WHERE household_id=$1 AND cycle=$2 AND kind='paid' AND status='pending' ORDER BY created_at DESC LIMIT 1",[input.householdId,term]);
  if (pending) {
   if (pending.price_id!==priceId || pending.amount_cents!==amount) throw new Error('Pending order price changed; owner review required');
   return pending;
  }
  const id = newId('order'), now = nowIso();
  await exec(`INSERT INTO cycle_orders(id,household_id,cycle,kind,price_id,amount_cents,status,idempotency_key,created_at,updated_at) VALUES($1,$2,$3,'paid',$4,$5,'pending',$6,$7,$8)`,[id,input.householdId,term,priceId,amount,`checkout:${input.idempotencyKey}`,now,now]);
  await recordCycleAudit(input.householdId,id,'order_created',`order:${id}`,input.authUserId,'checkout_pending');
  return { id, household_id: input.householdId, provider_session_id: null };
 });
 // Provider's idempotency key retrieves the same hosted session on retries.
 // A provider idempotency key ensures retries cannot create two chargeable sessions.
 const form = new URLSearchParams({ mode:'payment', 'line_items[0][price]':priceId,'line_items[0][quantity]':'1',
  success_url:`${site}/account?checkout=return`, cancel_url:`${site}/account?checkout=canceled`,
  'metadata[order_id]':order.id,'metadata[household_id]':input.householdId,'metadata[cycle]':term });
 const response = await fetch('https://api.stripe.com/v1/checkout/sessions', { method:'POST',headers:{Authorization:`Bearer ${process.env.STRIPE_SECRET_KEY}`,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':`campuspassage-${order.id}`},body:form,cache:'no-store' });
 if (!response.ok) throw new Error('Checkout provider unavailable');
 const data: unknown = await response.json();
 const session = data as {id?:string;url?:string};
 if (!session.id?.startsWith('cs_') || !session.url?.startsWith('https://checkout.stripe.com/')) throw new Error('Invalid provider session');
 await exec('UPDATE cycle_orders SET provider_session_id=$1,updated_at=$2 WHERE id=$3 AND provider_session_id IS NULL',[session.id,nowIso(),order.id]);
 return session.url;
}
export async function reconcileProviderFee(input:{orderId:string;feeCents:number;providerReference:string;actor:{id:string;email:string}}) {
 if(!isDemoOwnerEmail(input.actor.email) || !await queryOne('SELECT 1 AS ok FROM auth_links WHERE auth_user_id=$1 AND role=$2',[input.actor.id,'owner'])) throw new Error('Owner authorization required');
 if(!Number.isSafeInteger(input.feeCents) || input.feeCents<0 || !/^[-_a-zA-Z0-9]{6,100}$/.test(input.providerReference)) throw new Error('Verified fee/reference required');
 return withTransaction(async()=>{
  const order=await queryOne<any>(`SELECT * FROM cycle_orders WHERE id=$1${usingPostgres?' FOR UPDATE':''}`,[input.orderId]);
  if (!order || !['paid','refunded'].includes(order.status)) throw new Error('Paid order required');
  const old=await queryOne<any>('SELECT cents,order_id FROM cycle_accounting_events WHERE reference=$1',[`fee:${input.providerReference}`]);
  if (old) { if (old.cents!==input.feeCents || old.order_id!==order.id) throw new Error('Fee reference conflict'); return; }
  const totals=await accountingTotals(order.id);
  if (totals.providerFees+input.feeCents>totals.payments) throw new Error('Fee exceeds payment');
  await recordAccountingEntry(order.id,'provider_fee',input.feeCents,`fee:${input.providerReference}`,input.actor.id,'verified_provider_report');
  await recordAccountingEntry(order.id,'net_cash',-input.feeCents,`fee-net:${input.providerReference}`,input.actor.id,'fee_adjustment');
  await recordCycleAudit(order.household_id,order.id,'fee_reconciled',`fee-audit:${input.providerReference}`,input.actor.id,'verified_provider_report');
 });
}
export function verifyStripeEvent(raw: string, signature: string, secret: string, now = Date.now()): any {
 if (!secret || raw.length > 256_000) throw new Error('Webhook configuration or payload invalid');
 const parts = signature.split(',').map(s=>s.trim().split('='));
 const timestamp = parts.find(([k])=>k==='t')?.[1];
 if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(now-Number(timestamp)*1000)>300_000) throw new Error('Webhook timestamp invalid');
 const expected = createHmac('sha256',secret).update(`${timestamp}.${raw}`).digest();
 if (!parts.some(([k,v])=> k==='v1' && /^[a-f\d]{64}$/i.test(v||'') && timingSafeEqual(expected,Buffer.from(v,'hex')))) throw new Error('Webhook signature invalid');
 const event = JSON.parse(raw);
 if (!event || typeof event.id!=='string' || !/^evt_[\w]+$/.test(event.id) || typeof event.type!=='string' || !event.data?.object || event.livemode !== false && event.livemode !== true) throw new Error('Webhook event invalid');
 return event;
}
export async function reconcileStripeWebhook(raw: string, signature: string) {
 if (!stripeReady()) throw new Error('Stripe review integration is disabled');
 const event = verifyStripeEvent(raw,signature,process.env.STRIPE_WEBHOOK_SECRET!);
 if (event.livemode !== (process.env.STRIPE_EXPECT_LIVEMODE==='1')) throw new Error('Webhook mode mismatch');
 return withTransaction(async () => {
  if (await queryOne('SELECT 1 AS ok FROM stripe_webhook_events WHERE event_id=$1',[event.id])) return 'duplicate';
  const obj = event.data.object as any;
  let status = 'processed', detail = 'ignored';
  if (['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)) {
   const order = await queryOne<any>(`SELECT * FROM cycle_orders WHERE id=$1${usingPostgres?' FOR UPDATE':''}`,[obj.metadata?.order_id || '']);
   let familyTermOkay=false;
   if(order) try { await assertHouseholdCycle(order.household_id,order.cycle); familyTermOkay=true; } catch {}
   if (!familyTermOkay || !order || order.kind !== 'paid' || order.household_id !== obj.metadata?.household_id || order.cycle !== obj.metadata?.cycle || order.price_id !== process.env.STRIPE_PRICE_ID || (order.provider_session_id && order.provider_session_id !== obj.id) || obj.payment_status !== 'paid' || obj.currency !== 'usd' || obj.amount_total !== order.amount_cents || order.amount_cents !== price() || typeof obj.payment_intent !== 'string') {
    status='exception'; detail='payment_mismatch';
   } else if (order.status === 'pending') {
    const now = nowIso();
    await exec('UPDATE cycle_orders SET status=$1,provider_session_id=$2,provider_payment_id=$3,updated_at=$4 WHERE id=$5',['paid',obj.id,obj.payment_intent,now,order.id]);
    await recordAccountingEntry(order.id,'payment',price(),`stripe:payment:${obj.payment_intent}`,'stripe');
    await recordAccountingEntry(order.id,'net_cash',price(),`stripe:net:${obj.payment_intent}`,'stripe','fee_pending_reconciliation');
    await exec(`INSERT INTO cycle_entitlements(id,household_id,cycle,order_id,kind,starts_at,expires_at,authorized_by) VALUES($1,$2,$3,$4,'paid',$5,$6,$7) ON CONFLICT(household_id,cycle) DO NOTHING`,[newId('access'),order.household_id,order.cycle,order.id,now,endOfCycle(order.cycle),'stripe_verified']);
    // If another entitlement already exists, never silently treat payment as access.
    if (!await queryOne('SELECT 1 AS ok FROM cycle_entitlements WHERE order_id=$1',[order.id])) { status='exception'; detail='entitlement_conflict'; }
    else { detail='payment_verified'; await recordCycleAudit(order.household_id,order.id,'payment_verified',`stripe:paid:${obj.payment_intent}`,'stripe',detail); }
   } else detail='already_reconciled';
  } else if (event.type === 'charge.refunded') {
   const order = await queryOne<any>(`SELECT * FROM cycle_orders WHERE provider_payment_id=$1${usingPostgres?' FOR UPDATE':''}`,[obj.payment_intent || '']);
   if (!order || order.kind !== 'paid' || !Number.isSafeInteger(obj.amount_refunded) || obj.amount_refunded<0 || obj.amount_refunded>order.amount_cents || obj.currency !== 'usd') { status='exception'; detail='refund_mismatch'; }
   else {
    const totals = await accountingTotals(order.id), delta = obj.amount_refunded + totals.refunds;
    if (delta < 0) { status='exception'; detail='refund_regression'; }
    else if (delta > 0) {
     await recordAccountingEntry(order.id,'refund',-delta,`stripe:refund:${event.id}`,'stripe');
     await recordAccountingEntry(order.id,'net_cash',-delta,`stripe:refund_net:${event.id}`,'stripe');
     if (obj.amount_refunded === order.amount_cents) {
      await exec("UPDATE cycle_orders SET status='refunded',updated_at=$1 WHERE id=$2",[nowIso(),order.id]);
      await exec('UPDATE cycle_entitlements SET revoked_at=$1,revoked_by=$2 WHERE order_id=$3 AND revoked_at IS NULL',[nowIso(),'stripe_refund',order.id]);
     }
     detail='refund_reconciled'; await recordCycleAudit(order.household_id,order.id,'refund_reconciled',`stripe:refund_audit:${event.id}`,'stripe',detail);
    } else detail='refund_already_reconciled';
   }
  }
  await exec('INSERT INTO stripe_webhook_events(event_id,event_type,status,detail_code,received_at) VALUES($1,$2,$3,$4,$5)',[event.id,event.type,status,detail,nowIso()]);
  return status === 'exception' ? 'exception' : detail;
 });
}
