// Review-only connected-mail contract; no OAuth callback or provider API calls are enabled.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { exec, newId, nowIso, queryOne, queryRows, usingPostgres, withTransaction } from './client';
import { RetryLater, ReconsentRequired } from '@/lib/mail/provider';
export type MailProvider = 'gmail'|'microsoft';
export type MailScope = Readonly<{ domains: readonly string[]; checkpoint: string|null; metadataOnly: true; maxResults: 50 }>;
export type MinimalEnvelope = { id: string; senderDomain: string; observedAt: string; authenticated: boolean };
export type StoredTokens = {accessToken:string;refreshToken:string;expiresAt?:number};
export interface ConnectedMailAdapter {
 readonly provider: MailProvider;
 /** Restrict server-side query to exact allowlisted sender domains if possible.
  * If provider cannot restrict, retrieve only headers and discard unlisted
  * envelopes before requesting body. This interface never requests bodies. */
 listMinimalMetadata(scope: MailScope, tokens: { accessToken: string; refreshToken: string }): Promise<{ envelopes: MinimalEnvelope[]; nextCheckpoint: string }>;
 revoke?(tokens: {accessToken:string;refreshToken:string}): Promise<void>;
}
// Deliberately fail closed until reviewed OAuth/scopes, endpoint, and token rotation adapters exist.
export class GmailReviewAdapter implements ConnectedMailAdapter {
 readonly provider = 'gmail';
 async listMinimalMetadata(_scope: MailScope, _tokens: {accessToken:string;refreshToken:string}): Promise<never> { throw new Error('Gmail connector is not live'); }
}
export class MicrosoftReviewAdapter implements ConnectedMailAdapter {
 readonly provider = 'microsoft';
 async listMinimalMetadata(_scope: MailScope, _tokens: {accessToken:string;refreshToken:string}): Promise<never> { throw new Error('Microsoft connector is not live'); }
}
const domain = (v: string) => { const s=v.trim().toLowerCase(); if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(s) || s.length>253) throw new Error('Invalid exact domain'); return s; };
function key(): Buffer { const raw = process.env.MAIL_TOKEN_ENCRYPTION_KEY ?? ''; if (!/^[a-f0-9]{64}$/i.test(raw)) throw new Error('Mail encryption key unavailable'); return Buffer.from(raw,'hex'); }
function digest(v: string): string { return createHmac('sha256',key()).update(v).digest('hex'); }
export function sealTokens(tokens: StoredTokens): string {
 if (!tokens.accessToken || !tokens.refreshToken) throw new Error('OAuth tokens required');
 const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key(),iv);
 const ciphertext=Buffer.concat([cipher.update(JSON.stringify(tokens),'utf8'),cipher.final()]);
 return [iv,cipher.getAuthTag(),ciphertext].map(b=>b.toString('base64url')).join('.');
}
export function openTokens(sealed: string): StoredTokens {
 const [iv,tag,text]=sealed.split('.').map(s=>Buffer.from(s,'base64url'));
 const cipher=createDecipheriv('aes-256-gcm',key(),iv); cipher.setAuthTag(tag);
 return JSON.parse(Buffer.concat([cipher.update(text),cipher.final()]).toString('utf8'));
}
async function assertOwner(householdId: string, actor: string) {
 if (!await queryOne('SELECT 1 AS ok FROM auth_links WHERE household_id=$1 AND auth_user_id=$2 AND role=$3',[householdId,actor,'owner']) || householdId===process.env.DEMO_TEMPLATE_HOUSEHOLD_ID || await queryOne('SELECT 1 AS ok FROM demo_households WHERE household_id=$1',[householdId])) throw new Error('Household owner required');
}
async function control(householdId:string,eventType:string,actor:string,detailCode:string) {
 await exec('INSERT INTO mail_control_audit(id,household_id,event_type,actor,detail_code,created_at) VALUES($1,$2,$3,$4,$5,$6)',[newId('mailaudit'),householdId,eventType,actor,detailCode,nowIso()]);
}
/** Internal callback contract only: caller must be a reviewed OAuth server adapter,
 * never a browser form. Consent does not grant account sign-in or payment. */
export async function storeConnectedMail(input: {householdId:string;actorId:string;provider:MailProvider;accountId:string;tokens:StoredTokens;consentVersion:string}) {
 if (!['gmail','microsoft'].includes(input.provider) || input.consentVersion !== 'connected-mail-2026-09-v1' || !input.accountId || input.accountId.length>200) throw new Error('Explicit consent and verified account required');
 await assertOwner(input.householdId,input.actorId);
 const sealed=sealTokens(input.tokens), id=newId('mail'), now=nowIso();
 await withTransaction(async()=>{
  await exec(`INSERT INTO mail_connections(id,household_id,provider,account_hash,encrypted_tokens,key_version,consent_version,consented_by,consented_at,status)
   VALUES($1,$2,$3,$4,$5,'v1',$6,$7,$8,'active')`,[id,input.householdId,input.provider,digest(input.accountId),sealed,input.consentVersion,input.actorId,now]);
  await control(input.householdId,'connected',input.actorId,input.provider);
 });
 return id;
}
/** Only approved institution/vendor records with current official evidence. */
export async function approvedMailSenders(): Promise<{institutionId:string;domain:string}[]> {
 const rows = await queryRows<any>(`SELECT v.institution_id,v.domain,s.last_verified,v.verified_at FROM verified_mail_senders v
 JOIN sources s ON s.id=v.source_id AND s.institution_id=v.institution_id AND s.authority_level='official'
 JOIN institution_sender_policies p ON p.institution_id=v.institution_id AND p.sender_domain=v.domain AND p.active=1
 WHERE v.active=1 AND s.last_verified IS NOT NULL`);
 return rows.filter(r=>Number.isFinite(Date.parse(r.last_verified)) && Date.now()-Date.parse(r.last_verified) < 180*86400000 && Date.parse(r.last_verified)<=Date.now() && Date.now()-Date.parse(r.verified_at)<180*86400000 && Date.parse(r.verified_at)<=Date.now())
  .map(r=>({institutionId:r.institution_id,domain:domain(r.domain)}));
}
/** Future verified OAuth callback only: renewed explicit consent, never a browser token form. */
export async function reconsentConnectedMail(input:{householdId:string;actorId:string;connectionId:string;accountId:string;tokens:StoredTokens;consentVersion:string}) {
 await assertOwner(input.householdId,input.actorId);
 if(input.consentVersion!=='connected-mail-2026-09-v1') throw new Error('Explicit consent required');
 const sealed=sealTokens(input.tokens), hash=digest(input.accountId);
 await withTransaction(async()=>{
  const row=await queryOne<any>(`SELECT * FROM mail_connections WHERE id=$1 AND household_id=$2${usingPostgres?' FOR UPDATE':''}`,[input.connectionId,input.householdId]);
  if(!row || row.account_hash!==hash || !['reconsent','failed','revoked'].includes(row.status)) throw new Error('Connection cannot be reconsented');
  await exec("UPDATE mail_connections SET encrypted_tokens=$1,key_version='v1',consent_version=$2,consented_by=$3,consented_at=$4,status='active',checkpoint=NULL,last_sync_at=NULL,retry_after=NULL,revoked_at=NULL,delete_after=NULL WHERE id=$5",[sealed,input.consentVersion,input.actorId,nowIso(),row.id]);
  await control(input.householdId,'reconsented',input.actorId,row.provider);
 });
}
export async function syncConnectedMail(input: {householdId:string;actorId:string;connectionId:string;adapter:ConnectedMailAdapter}) {
 await assertOwner(input.householdId,input.actorId);
 const connection=await queryOne<any>('SELECT * FROM mail_connections WHERE id=$1 AND household_id=$2',[input.connectionId,input.householdId]);
 if (!connection || connection.status!=='active' || connection.provider!==input.adapter.provider) throw new Error('Connection unavailable');
 const senders=await approvedMailSenders(), domains=[...new Set(senders.map(s=>s.domain))];
 if (!domains.length) return {accepted:0, quarantined:0};
 const scope:MailScope={domains,checkpoint:connection.checkpoint,metadataOnly:true,maxResults:50};
 let batch: {envelopes:MinimalEnvelope[];nextCheckpoint:string};
 try { batch=await input.adapter.listMinimalMetadata(scope,openTokens(connection.encrypted_tokens)); }
 catch(e) {
  if (e instanceof RetryLater) { await control(input.householdId,'sync_deferred',input.actorId,'provider_backoff'); throw e; }
  const state=e instanceof ReconsentRequired || /consent|invalid.grant|unauthor/i.test(String(e))?'reconsent':'failed';
  await exec('UPDATE mail_connections SET status=$1 WHERE id=$2',[state,connection.id]); await control(input.householdId,state,input.actorId,'sync_failed'); throw new Error('Mail sync failed');
 }
 if (!Array.isArray(batch.envelopes) || batch.envelopes.length>50 || !batch.nextCheckpoint || batch.nextCheckpoint.length>8000) throw new Error('Invalid adapter batch');
 return withTransaction(async()=>{
  const current=await queryOne<any>(`SELECT status,checkpoint FROM mail_connections WHERE id=$1 AND household_id=$2${usingPostgres?' FOR UPDATE':''}`,[connection.id,input.householdId]);
  if (current?.status!=='active' || current.checkpoint!==connection.checkpoint) throw new Error('Connection changed during sync');
  // Sender curation may have changed while the provider was responding.
  const currentSenders=await approvedMailSenders();
  let accepted=0,quarantined=0;
  for (const envelope of batch.envelopes) {
   // Discard nonmatching metadata immediately. Never store subject/body/recipients.
   let sender:string; try { sender=domain(envelope.senderDomain); } catch { continue; }
   const matched=currentSenders.filter(s=>s.domain===sender && senders.some(original=>original.institutionId===s.institutionId && original.domain===s.domain));
   if (!matched.length || !envelope.id || envelope.id.length>200 || !Number.isFinite(Date.parse(envelope.observedAt))) continue;
   const status=envelope.authenticated && matched.length===1?'approved':'quarantined';
   const hash=digest(`${connection.id}:${envelope.id}`);
   const prior=await queryOne('SELECT 1 AS ok FROM connected_mail_evidence WHERE connection_id=$1 AND message_digest=$2',[connection.id,hash]);
   if (prior) continue;
   await exec('INSERT INTO connected_mail_evidence(id,connection_id,household_id,institution_id,sender_domain,message_digest,observed_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[newId('mailevidence'),connection.id,input.householdId,matched[0].institutionId,sender,hash,envelope.observedAt,status]);
   await exec('INSERT INTO mail_sync_events(id,connection_id,event_type,detail_code,message_digest,created_at) VALUES($1,$2,$3,$4,$5,$6)',[newId('mailevent'),connection.id,'observed',status,hash,nowIso()]);
   if(status==='approved') accepted++; else quarantined++;
  }
  await exec('UPDATE mail_connections SET checkpoint=$1,last_sync_at=$2 WHERE id=$3 AND status=$4',[batch.nextCheckpoint,nowIso(),connection.id,'active']);
  return {accepted,quarantined};
 });
}
export async function revokeConnectedMail(input:{householdId:string;actorId:string;connectionId:string}) {
 await assertOwner(input.householdId,input.actorId);
 await withTransaction(async()=>{
  const row=await queryOne<any>('SELECT id FROM mail_connections WHERE id=$1 AND household_id=$2',[input.connectionId,input.householdId]);
  if(!row) throw new Error('Connection unavailable');
  await exec('DELETE FROM connected_mail_evidence WHERE connection_id=$1',[row.id]);
  await exec('DELETE FROM mail_sync_events WHERE connection_id=$1',[row.id]);
  await exec("UPDATE mail_connections SET status='revoked',encrypted_tokens=$1,checkpoint=NULL,revoked_at=$2,delete_after=$3 WHERE id=$4",['revoked',nowIso(),nowIso(),row.id]);
  await control(input.householdId,'locally_revoked',input.actorId,'remote_status_logged_separately');
 });
}
export async function deleteConnectedMail(input:{householdId:string;actorId:string}) {
 await assertOwner(input.householdId,input.actorId);
 await withTransaction(async()=>{
  await exec('DELETE FROM connected_mail_evidence WHERE household_id=$1',[input.householdId]);
  await exec('DELETE FROM mail_sync_events WHERE connection_id IN (SELECT id FROM mail_connections WHERE household_id=$1)',[input.householdId]);
  await exec('DELETE FROM mail_connections WHERE household_id=$1',[input.householdId]);
  await control(input.householdId,'deleted',input.actorId,'local_data_removed');
 });
}
export async function purgeExpiredMailEvidence() {
 await exec('DELETE FROM connected_mail_evidence WHERE observed_at<$1',[new Date(Date.now()-30*86400000).toISOString()]);
}
