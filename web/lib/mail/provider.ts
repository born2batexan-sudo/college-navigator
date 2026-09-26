import { createHash, randomBytes } from 'node:crypto';
import { appOrigin } from '@/lib/auth/origin';
import type { ConnectedMailAdapter, MailProvider, MailScope, MinimalEnvelope } from '@/lib/db/connected-mail';

export type MailTokens = { accessToken:string; refreshToken:string; expiresAt?:number };
export type Transport = typeof fetch;
const consent = 'connected-mail-2026-09-v1';
export { consent };
const cfg = (provider:MailProvider) => provider==='gmail' ? {
 clientId:process.env.MAIL_GOOGLE_CLIENT_ID, secret:process.env.MAIL_GOOGLE_CLIENT_SECRET,
 authorize:'https://accounts.google.com/o/oauth2/v2/auth', token:'https://oauth2.googleapis.com/token',
 scope:'openid email https://www.googleapis.com/auth/gmail.readonly',
} : {
 clientId:process.env.MAIL_MICROSOFT_CLIENT_ID, secret:process.env.MAIL_MICROSOFT_CLIENT_SECRET,
 authorize:'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
 token:'https://login.microsoftonline.com/common/oauth2/v2.0/token',
 scope:'openid offline_access User.Read Mail.ReadBasic',
};
export function mailEnabled():boolean { return process.env.CONNECTED_MAIL_ENABLED==='1'; }
export function configured(provider:MailProvider):boolean { const c=cfg(provider); return mailEnabled() && !!(c.clientId && c.secret && process.env.MAIL_TOKEN_ENCRYPTION_KEY && process.env.APP_ORIGIN); }
export const callbackUrl=(p:MailProvider)=>`${appOrigin()}/api/mail/callback/${p}`;
export function authorizeUrl(provider:MailProvider,state:string,verifier:string):string {
 if (!configured(provider)) throw new Error('Mail connector unavailable');
 const c=cfg(provider), u=new URL(c.authorize);
 const params:Record<string,string>={client_id:c.clientId!,redirect_uri:callbackUrl(provider),response_type:'code',scope:c.scope,
  state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'};
 if(provider==='gmail') { params.access_type='offline'; params.prompt='consent'; params.include_granted_scopes='false'; }
 else { params.prompt='consent'; params.response_mode='query'; }
 for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
 return u.toString();
}
export const randomSecret=()=>randomBytes(32).toString('base64url');
export class RetryLater extends Error { constructor(readonly retryAfterSeconds:number){super('Provider rate limited or temporarily unavailable');} }
export class ReconsentRequired extends Error { constructor(){super('Provider authorization expired');} }
async function request(url:string,init:RequestInit,fetcher:Transport):Promise<Response> {
 let response:Response;
 try { response=await fetcher(url,{...init,signal:AbortSignal.timeout(8000),cache:'no-store',redirect:'error'}); }
 catch { throw new RetryLater(60); }
 if(response.status===429 || response.status>=500){ const retry=Number(response.headers.get('retry-after'));throw new RetryLater(Number.isFinite(retry)&&retry>0?Math.min(retry,3600):60); }
 if(response.status===401 || response.status===403) throw new ReconsentRequired();
 if(response.status===400) {
  const detail=await response.clone().json().catch(()=>({}));
  if(detail?.error==='invalid_grant'||detail?.error==='interaction_required')throw new ReconsentRequired();
 }
 if(!response.ok) throw new Error(`Provider rejected request (${response.status})`);
 return response;
}
async function json(url:string,init:RequestInit,fetcher:Transport):Promise<any> { return (await request(url,init,fetcher)).json(); }
function form(values:Record<string,string>):RequestInit {return {method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(values).toString()};}
function parseTokens(value:any,prior?:MailTokens):MailTokens {
 if(typeof value?.access_token!=='string'||!value.access_token || typeof (value.refresh_token??prior?.refreshToken)!=='string')throw new ReconsentRequired();
 return {accessToken:value.access_token,refreshToken:value.refresh_token??prior!.refreshToken,expiresAt:Date.now()+Math.max(60,Number(value.expires_in)||3600)*1000};
}
export async function exchangeCode(provider:MailProvider,code:string,verifier:string,fetcher:Transport=fetch):Promise<MailTokens> {
 if(!configured(provider))throw new Error('Mail connector unavailable');
 const c=cfg(provider);
 return parseTokens(await json(c.token,form({client_id:c.clientId!,client_secret:c.secret!,code,code_verifier:verifier,grant_type:'authorization_code',redirect_uri:callbackUrl(provider)}),fetcher));
}
export async function refreshTokens(provider:MailProvider,tokens:MailTokens,fetcher:Transport=fetch):Promise<MailTokens> {
 if(!configured(provider))throw new Error('Mail connector unavailable');
 const c=cfg(provider);
 const url=provider==='gmail'?'https://oauth2.googleapis.com/token':c.token;
 return parseTokens(await json(url,form({client_id:c.clientId!,client_secret:c.secret!,grant_type:'refresh_token',refresh_token:tokens.refreshToken}),fetcher),tokens);
}
export async function verifiedIdentity(provider:MailProvider,token:string,fetcher:Transport=fetch):Promise<string>{
 const endpoint=provider==='gmail'?'https://openidconnect.googleapis.com/v1/userinfo':'https://graph.microsoft.com/v1.0/me?$select=id';
 const data=await json(endpoint,{headers:{authorization:`Bearer ${token}`}},fetcher);
 if(provider==='gmail' && data.email_verified!==true)throw new Error('Provider email not verified');
 if(typeof data.sub!=='string' && provider==='gmail' || typeof data.id!=='string' && provider==='microsoft')throw new Error('Provider identity unavailable');
 return provider==='gmail'?data.sub:data.id;
}
/** Google supports token revocation. Microsoft does not expose per-app delegated OAuth revocation without broad tenant-admin permissions. */
export async function revokeGrant(provider:MailProvider,tokens:MailTokens,fetcher:Transport=fetch):Promise<'revoked'|'manual_required'|'failed'>{
 if(provider==='microsoft')return 'manual_required';
 try {await request('https://oauth2.googleapis.com/revoke',form({token:tokens.refreshToken}),fetcher);return 'revoked';}
 catch {return 'failed';}
}
function senderDomain(address:unknown):string|null {
 if(typeof address!=='string')return null;
 const match=address.trim().match(/^(?:[^<>]*<)?[^\s@<>]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)>?$/i);
 return match?.[1]?.toLowerCase()??null;
}
type Cursor={d:number;page?:string;after:string;cutoff:string};
function decode(raw:string|null):Cursor {
 if(!raw)return {d:0,after:new Date(Date.now()-30*86400000).toISOString(),cutoff:new Date().toISOString()};
 let c:Cursor;try{c=JSON.parse(raw);}catch{throw new Error('Invalid mail cursor');}
 if(!Number.isSafeInteger(c.d)||c.d<0||typeof c.after!=='string'||!Number.isFinite(Date.parse(c.after))||typeof c.cutoff!=='string'||!Number.isFinite(Date.parse(c.cutoff))||c.page!==undefined&&(typeof c.page!=='string'||c.page.length>7000))throw new Error('Invalid mail cursor');
 return c;
}
const headers=(token:string)=>({authorization:`Bearer ${token}`});
export class HttpMailAdapter implements ConnectedMailAdapter {
 constructor(readonly provider:MailProvider,private readonly fetcher:Transport=fetch){}
 async listMinimalMetadata(scope:MailScope,tokens:MailTokens):Promise<{envelopes:MinimalEnvelope[];nextCheckpoint:string}> {
  if(!configured(this.provider))throw new Error('Mail connector unavailable');
  if(scope.maxResults!==50||scope.metadataOnly!==true||!scope.domains.length||scope.domains.some(d=>!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(d)))throw new Error('Invalid mail scope');
  let c=decode(scope.checkpoint);
  if(c.d>=scope.domains.length)c={d:0,after:new Date(Date.parse(c.cutoff)-86400000).toISOString(),cutoff:new Date().toISOString()};
  const domain=scope.domains[c.d], envelopes:MinimalEnvelope[]=[];
  if(this.provider==='gmail'){
   // gmail.metadata cannot use q; gmail.readonly is the minimum Gmail scope permitting sender-restricted server-side queries.
   const u=new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
   u.searchParams.set('q',`from:(@${domain}) after:${Math.floor(Date.parse(c.after)/1000)} before:${Math.ceil(Date.parse(c.cutoff)/1000)}`);
   u.searchParams.set('maxResults','50');if(c.page)u.searchParams.set('pageToken',c.page);
   const list=await json(u.toString(),{headers:headers(tokens.accessToken)},this.fetcher);
   for(const item of (Array.isArray(list.messages)?list.messages:[]).slice(0,50)) {
    if(typeof item.id!=='string')continue;
    const detail=new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}`);
    detail.searchParams.set('format','metadata');for(const name of ['From','Date'])detail.searchParams.append('metadataHeaders',name);
    const m=await json(detail.toString(),{headers:headers(tokens.accessToken)},this.fetcher);
    const from=m.payload?.headers?.find((h:any)=>h.name?.toLowerCase()==='from')?.value;
    if(senderDomain(from)!==domain)continue;
    const time=Number(m.internalDate);
    if(Number.isFinite(time)&&time>=Date.parse(c.after)&&time<=Date.parse(c.cutoff))envelopes.push({id:item.id,senderDomain:domain,observedAt:new Date(time).toISOString(),authenticated:false});
   }
   c=list.nextPageToken?{...c,page:String(list.nextPageToken)}:{d:c.d+1,after:c.after,cutoff:c.cutoff};
  } else {
   // Mail.ReadBasic omits bodies, previews and attachments. Search is sender-scoped; unrelated messages are never fetched.
   let url:string;
   if(c.page){
    const next=new URL(c.page);
    if(next.origin!=='https://graph.microsoft.com'||!next.pathname.startsWith('/v1.0/me/messages')||next.searchParams.get('$search')!==`"from:${domain} received>=${c.after.slice(0,10)} received<=${c.cutoff.slice(0,10)}"`||next.searchParams.get('$select')!=='id,from,receivedDateTime')throw new Error('Unsafe Graph continuation');
    url=next.toString();
   }else{
    const u=new URL('https://graph.microsoft.com/v1.0/me/messages');
    u.searchParams.set('$search',`"from:${domain} received>=${c.after.slice(0,10)} received<=${c.cutoff.slice(0,10)}"`);
    u.searchParams.set('$select','id,from,receivedDateTime');u.searchParams.set('$top','50');url=u.toString();
   }
   const list=await json(url,{headers:{...headers(tokens.accessToken),Prefer:'outlook.body-content-type="text"'}},this.fetcher);
   for(const m of (Array.isArray(list.value)?list.value:[]).slice(0,50)){
    if(senderDomain(m.from?.emailAddress?.address)!==domain||typeof m.id!=='string')continue;
    const time=Date.parse(m.receivedDateTime);
    if(Number.isFinite(time)&&time>=Date.parse(c.after)&&time<=Date.parse(c.cutoff))envelopes.push({id:m.id,senderDomain:domain,observedAt:new Date(time).toISOString(),authenticated:false});
   }
   c=list['@odata.nextLink']?{...c,page:String(list['@odata.nextLink'])}:{d:c.d+1,after:c.after,cutoff:c.cutoff};
  }
  return {envelopes,nextCheckpoint:JSON.stringify(c)};
 }
}
