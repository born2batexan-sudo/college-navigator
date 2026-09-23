import { createHash } from 'node:crypto';
import { queryOne, queryRows, exec, nowIso, usingPostgres, withTransaction } from '@/lib/db/client';
import { approvedMailSenders, deleteConnectedMail, openTokens, revokeConnectedMail, sealTokens, storeConnectedMail, reconsentConnectedMail, syncConnectedMail, purgeExpiredMailEvidence, type MailProvider } from '@/lib/db/connected-mail';
import { hasProductAccess } from '@/lib/auth/product-access';
import { authorizeUrl, configured, consent, exchangeCode, HttpMailAdapter, mailEnabled, randomSecret, refreshTokens, RetryLater, ReconsentRequired, revokeGrant, verifiedIdentity, type Transport } from './provider';
import type { SessionUser } from '@/lib/auth/session';

const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export async function gateMail(user:SessionUser,householdId:string,requireEnabled=true):Promise<void>{
 if(requireEnabled && !mailEnabled())throw new Error('Connected mail is disabled');
 const owner=await queryOne('SELECT 1 AS ok FROM auth_links WHERE auth_user_id=$1 AND household_id=$2 AND role=$3',[user.id,householdId,'owner']);
 if(!owner || await queryOne('SELECT 1 AS ok FROM demo_households WHERE household_id=$1',[householdId]) || householdId===process.env.DEMO_TEMPLATE_HOUSEHOLD_ID || requireEnabled && !await hasProductAccess(user,householdId))throw new Error('Owner authorization required');
}
export async function beginMailConsent(user:SessionUser,householdId:string,provider:MailProvider,agreed:boolean):Promise<{state:string;url:string}>{
 await gateMail(user,householdId);
 if(!agreed||!configured(provider))throw new Error('Explicit provider consent and configuration required');
 const state=randomSecret(),verifier=randomSecret(),url=authorizeUrl(provider,state,verifier);
 await exec('INSERT INTO mail_oauth_attempts(state_hash,household_id,actor_id,provider,encrypted_verifier,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
  [hash(state),householdId,user.id,provider,sealTokens({accessToken:verifier,refreshToken:verifier}),new Date(Date.now()+10*60000).toISOString(),nowIso()]);
 return {state,url};
}
export async function finishMailConsent(user:SessionUser,provider:MailProvider,state:string,code:string,fetcher:Transport=fetch):Promise<void>{
 if(!configured(provider)||!/^[a-zA-Z0-9_-]{40,100}$/.test(state)||!code||code.length>4096)throw new Error('Invalid OAuth callback');
 // Consume before exchanging a code: failed attempts cannot be replayed.
 const attempt=await withTransaction(async()=>{
  const a=await queryOne<any>(`SELECT * FROM mail_oauth_attempts WHERE state_hash=$1${usingPostgres?' FOR UPDATE':''}`,[hash(state)]);
  if(a)await exec('DELETE FROM mail_oauth_attempts WHERE state_hash=$1',[hash(state)]);
  return a;
 });
 if(!attempt||attempt.actor_id!==user.id||attempt.provider!==provider||Date.parse(attempt.expires_at)<Date.now())throw new Error('Consent expired or mismatched');
 await gateMail(user,attempt.household_id);
 const verifier=openTokens(attempt.encrypted_verifier).accessToken;
 const tokens=await exchangeCode(provider,code,verifier,fetcher);
 try {
  const identity=await verifiedIdentity(provider,tokens.accessToken,fetcher);
  // Existing verified provider account may only be reauthorized in the same household.
  const rows=await queryRows<any>('SELECT id,account_hash,status FROM mail_connections WHERE household_id=$1 AND provider=$2',[attempt.household_id,provider]);
  const { createHmac }=await import('node:crypto');
  const key=process.env.MAIL_TOKEN_ENCRYPTION_KEY!;
  const identityHash=createHmac('sha256',Buffer.from(key,'hex')).update(identity).digest('hex');
  const prior=rows.find(r=>r.account_hash===identityHash);
  if(prior && prior.status==='active')throw new Error('This account is already connected');
  if(prior)await reconsentConnectedMail({householdId:attempt.household_id,actorId:user.id,connectionId:prior.id,accountId:identity,tokens,consentVersion:consent});
  else await storeConnectedMail({householdId:attempt.household_id,actorId:user.id,provider,accountId:identity,tokens,consentVersion:consent});
 }catch(error){ await revokeGrant(provider,tokens,fetcher);throw error; }
}
export async function mailStatus(user:SessionUser,householdId:string){
 await gateMail(user,householdId,false);
 return queryRows<{id:string;provider:MailProvider;status:string;consented_at:string;last_sync_at:string|null;retry_after:string|null}>(
  'SELECT id,provider,status,consented_at,last_sync_at,retry_after FROM mail_connections WHERE household_id=$1 ORDER BY consented_at DESC',[householdId]);
}
export async function runMailSync(user:SessionUser,householdId:string,id:string,fetcher:Transport=fetch){
 await gateMail(user,householdId);
 const row=await queryOne<any>('SELECT * FROM mail_connections WHERE household_id=$1 AND id=$2',[householdId,id]);
 if(!row||row.status!=='active'||!configured(row.provider))throw new Error('Connection unavailable');
 if(row.retry_after && Date.parse(row.retry_after)>Date.now())throw new RetryLater(Math.ceil((Date.parse(row.retry_after)-Date.now())/1000));
 let tokens=openTokens(row.encrypted_tokens);
 try {
  if(!tokens.expiresAt||tokens.expiresAt<Date.now()+120000){
   const next=await refreshTokens(row.provider,tokens,fetcher);
   const sealed=sealTokens(next);
   // Compare-and-swap prevents stale refresh tokens from overwriting rotations.
   await withTransaction(async()=>{
    const current=await queryOne<any>(`SELECT encrypted_tokens,status FROM mail_connections WHERE id=$1 AND household_id=$2${usingPostgres?' FOR UPDATE':''}`,[id,householdId]);
    if(!current||current.status!=='active')throw new Error('Connection changed');
    if(current.encrypted_tokens===row.encrypted_tokens){await exec('UPDATE mail_connections SET encrypted_tokens=$1 WHERE id=$2',[sealed,id]);tokens=next;}
    else tokens=openTokens(current.encrypted_tokens);
   });
  }
  // Prevent a sync against a stale grant after disconnect while refreshing.
  const fresh=await queryOne<any>('SELECT status FROM mail_connections WHERE id=$1 AND household_id=$2',[id,householdId]);
  if(fresh?.status!=='active')throw new Error('Connection changed');
  const result=await syncConnectedMail({householdId,actorId:user.id,connectionId:id,adapter:new HttpMailAdapter(row.provider,fetcher)});
  await exec('UPDATE mail_connections SET retry_after=NULL WHERE id=$1 AND household_id=$2',[id,householdId]);
  return result;
 }catch(e){
  if(e instanceof RetryLater){await exec('UPDATE mail_connections SET retry_after=$1 WHERE id=$2 AND household_id=$3',[new Date(Date.now()+e.retryAfterSeconds*1000).toISOString(),id,householdId]);}
  if(e instanceof ReconsentRequired){await exec("UPDATE mail_connections SET status='reconsent' WHERE id=$1 AND household_id=$2 AND status='active'",[id,householdId]);}
  throw e;
 }
}
export async function disconnectMail(user:SessionUser,householdId:string,id:string,fetcher:Transport=fetch){
 await gateMail(user,householdId,false);
 const row=await queryOne<any>('SELECT * FROM mail_connections WHERE id=$1 AND household_id=$2',[id,householdId]);
 if(!row)throw new Error('Connection unavailable');
 let result:'revoked'|'manual_required'|'failed'='manual_required';
 if(row.status==='active' || row.status==='failed' || row.status==='reconsent'){
  try {result=await revokeGrant(row.provider,openTokens(row.encrypted_tokens),fetcher);}catch{result='failed';}
 }
 // Local erasure proceeds even if Google is unavailable. Microsoft requires manual removal in its permissions portal.
 await revokeConnectedMail({householdId,actorId:user.id,connectionId:id});
 await exec('INSERT INTO mail_control_audit(id,household_id,event_type,actor,detail_code,created_at) VALUES($1,$2,$3,$4,$5,$6)',
  [`mailaudit_${randomSecret()}`,householdId,'remote_revocation',user.id,result,nowIso()]);
 return result;
}
export async function deleteMailData(user:SessionUser,householdId:string,fetcher:Transport=fetch){
 await gateMail(user,householdId,false);
 const all=await mailStatus(user,householdId);
 const results=[];
 for(const row of all)if(row.status!=='revoked')results.push(await disconnectMail(user,householdId,row.id,fetcher));
 await deleteConnectedMail({householdId,actorId:user.id});
 return results;
}
export async function purgeMailRetention(){
 await purgeExpiredMailEvidence();
 await exec('DELETE FROM mail_oauth_attempts WHERE expires_at<$1',[nowIso()]);
 await exec("DELETE FROM mail_connections WHERE status='revoked' AND delete_after<$1",[nowIso()]);
 await exec('DELETE FROM mail_sync_events WHERE created_at<$1',[new Date(Date.now()-30*86400000).toISOString()]);
 await exec('DELETE FROM mail_control_audit WHERE created_at<$1',[new Date(Date.now()-90*86400000).toISOString()]);
}
