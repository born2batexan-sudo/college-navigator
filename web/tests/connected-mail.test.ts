import { describe,it,before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
process.env.DB_PATH=path.join(mkdtempSync(path.join(tmpdir(),'mail-oauth-')),'db.sqlite3');
delete process.env.DATABASE_URL;
process.env.DEMO_OWNER_EMAIL='owner@example.com';
process.env.APP_ORIGIN='https://app.example.com';
process.env.MAIL_TOKEN_ENCRYPTION_KEY='cd'.repeat(32);
process.env.MAIL_GOOGLE_CLIENT_ID='google-client';process.env.MAIL_GOOGLE_CLIENT_SECRET='google-secret';
process.env.MAIL_MICROSOFT_CLIENT_ID='ms-client';process.env.MAIL_MICROSOFT_CLIENT_SECRET='ms-secret';
let A:typeof import('../lib/db/accounts'), C:typeof import('../lib/db/client'), P:typeof import('../lib/mail/provider'), M:typeof import('../lib/mail/service');
const actor={id:'owner-mail',email:'owner@example.com'};
let owner:any;
const now=()=>new Date().toISOString();
const response=(body:unknown,status=200,headers?:Record<string,string>)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
describe('connected mail OAuth and scoped transport',()=>{
 before(async()=>{ A=await import('../lib/db/accounts');C=await import('../lib/db/client');P=await import('../lib/mail/provider');M=await import('../lib/mail/service');owner=await A.provisionAccount({authUserId:actor.id,email:actor.email}); });
 it('is default off; owner product access and explicit per-provider consent are required',async()=>{
  assert.equal(P.mailEnabled(),false);
  await assert.rejects(M.beginMailConsent(actor,owner.household.id,'gmail',true));
  process.env.CONNECTED_MAIL_ENABLED='1';
  await assert.rejects(M.beginMailConsent(actor,owner.household.id,'gmail',false));
  await assert.rejects(M.beginMailConsent({id:'stranger',email:'stranger@example.com'},owner.household.id,'gmail',true));
  const {state,url}=await M.beginMailConsent(actor,owner.household.id,'gmail',true);
  const u=new URL(url);assert.equal(u.searchParams.get('redirect_uri'),'https://app.example.com/api/mail/callback/gmail');
  assert.match(u.searchParams.get('scope')??'',/gmail.readonly/);assert.equal(u.searchParams.get('state'),state);
  assert.equal(u.searchParams.get('code_challenge_method'),'S256');
  const saved=await C.queryOne<any>('SELECT * FROM mail_oauth_attempts WHERE state_hash=$1',[state]);assert.equal(saved,null);
 });
 it('exchanges single-use state and PKCE, verifies provider account and seals tokens; refuses replay',async()=>{
  const {state}=await M.beginMailConsent(actor,owner.household.id,'gmail',true);
  const calls:string[]=[];
  const transport:typeof fetch=async(url,init)=>{
   calls.push(String(url));
   if(String(url).endsWith('/token')){const params=new URLSearchParams(String(init?.body));assert.ok(params.get('code_verifier'));assert.equal(params.get('redirect_uri'),'https://app.example.com/api/mail/callback/gmail');return response({access_token:'gmail-access',refresh_token:'gmail-refresh',expires_in:3600});}
   if(String(url).endsWith('/userinfo'))return response({sub:'google-sub-123',email_verified:true});
   throw Error('Unexpected provider call');
  };
  await M.finishMailConsent(actor,'gmail',state,'authorization-code',transport);
  assert.equal(calls.length,2);
  await assert.rejects(M.finishMailConsent(actor,'gmail',state,'authorization-code',transport));
  const row=await C.queryOne<any>('SELECT * FROM mail_connections WHERE household_id=$1',[owner.household.id]);
  assert.doesNotMatch(row.encrypted_tokens,/gmail-access|gmail-refresh/);
  assert.notEqual(row.account_hash,'google-sub-123');
 });
 it('Gmail searches only approved sender domains and fetches header metadata, never body/attachments',async()=>{
  const time=now(), seen:string[]=[];
  const adapter=new P.HttpMailAdapter('gmail',async(url)=>{
   seen.push(String(url));const u=new URL(String(url));
   if(u.pathname.endsWith('/messages'))return response({messages:[{id:'allowed'},{id:'unrelated'}]});
   return response({internalDate:String(Date.parse(time)),payload:{headers:[{name:'From',value:u.pathname.endsWith('allowed')?'School <admissions@example.edu>':'Spam <admissions@spam.example.edu>'}]}});
  });
  const result=await adapter.listMinimalMetadata({domains:['example.edu'],checkpoint:null,metadataOnly:true,maxResults:50},{accessToken:'a',refreshToken:'b'});
  assert.equal(result.envelopes.length,1);assert.equal(result.envelopes[0].authenticated,false);
  assert.match(seen[0],/from%3A/);assert.ok(seen.every(u=>!u.includes('format=full')&&!u.includes('/attachments')));
  assert.ok(time);
 });
 it('Microsoft uses Mail.ReadBasic sender-scoped minimal select and validates continuation',async()=>{
  const time=now();
  const adapter=new P.HttpMailAdapter('microsoft',async(url)=>{
   const u=new URL(String(url));assert.match(u.searchParams.get('$search')??'',/from:example.edu/);
   assert.equal(u.searchParams.get('$select'),'id,from,receivedDateTime');
   return response({value:[{id:'one',from:{emailAddress:{address:'registrar@example.edu'}},receivedDateTime:time},{id:'two',from:{emailAddress:{address:'a@other.edu'}},receivedDateTime:time}]});
  });
  const result=await adapter.listMinimalMetadata({domains:['example.edu'],checkpoint:null,metadataOnly:true,maxResults:50},{accessToken:'a',refreshToken:'b'});
  assert.equal(result.envelopes.length,1);assert.equal(result.envelopes[0].authenticated,false);
  await assert.rejects(adapter.listMinimalMetadata({domains:['example.edu'],checkpoint:JSON.stringify({d:0,after:now(),cutoff:now(),page:'https://evil.example/messages'}),metadataOnly:true,maxResults:50},{accessToken:'a',refreshToken:'b'}));
 });
 it('refreshes and rotates tokens, syncs only curated evidence, deduplicates, and disconnects with local erasure',async()=>{
  const timestamp=now();
  await C.exec('INSERT INTO institutions(id,name,slug,created_at) VALUES($1,$2,$3,$4)',['mail-school','Mail School','mail-school',timestamp]);
  await C.exec('INSERT INTO sources(id,institution_id,url,label,authority_level,last_verified,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',['mail-source','mail-school','https://example.edu','Official','official',timestamp,timestamp]);
  await C.exec('INSERT INTO institution_sender_policies(id,institution_id,sender_domain,curated_by,created_at) VALUES($1,$2,$3,$4,$5)',['mail-policy','mail-school','example.edu',actor.id,timestamp]);
  await C.exec('INSERT INTO verified_mail_senders(id,institution_id,domain,source_id,verified_at) VALUES($1,$2,$3,$4,$5)',['mail-sender','mail-school','example.edu','mail-source',timestamp]);
  const row=await C.queryOne<any>('SELECT * FROM mail_connections WHERE household_id=$1',[owner.household.id]);
  // Existing expired grant triggers OAuth refresh before any inbox request.
  const Db=await import('../lib/db/connected-mail');
  await C.exec('UPDATE mail_connections SET encrypted_tokens=$1 WHERE id=$2',[Db.sealTokens({accessToken:'expired',refreshToken:'old-refresh',expiresAt:Date.now()-1000}),row.id]);
  const seen:string[]=[];
  const transport:typeof fetch=async(url,init)=>{
   const u=new URL(String(url));seen.push(u.pathname);
   if(u.pathname.endsWith('/token')){assert.equal(new URLSearchParams(String(init?.body)).get('refresh_token'),'old-refresh');return response({access_token:'rotated-access',refresh_token:'rotated-refresh',expires_in:3600});}
   if(u.pathname.endsWith('/messages')){assert.match(u.searchParams.get('q')??'',/example.edu/);return response({messages:[{id:'allowed-message'}]});}
   if(u.pathname.endsWith('/allowed-message'))return response({internalDate:String(Date.parse(timestamp)),payload:{headers:[{name:'From',value:'admissions@example.edu'}]}});
   if(u.pathname.endsWith('/revoke')){assert.equal(new URLSearchParams(String(init?.body)).get('token'),'rotated-refresh');return response({});}
   throw Error('Unexpected provider call');
  };
  assert.deepEqual(await M.runMailSync(actor,owner.household.id,row.id,transport),{accepted:0,quarantined:1});
  assert.deepEqual(await M.runMailSync(actor,owner.household.id,row.id,transport),{accepted:0,quarantined:0});
  assert.equal((await C.queryOne<any>('SELECT COUNT(*) AS n FROM connected_mail_evidence WHERE connection_id=$1',[row.id])).n,1);
  assert.equal(await M.disconnectMail(actor,owner.household.id,row.id,transport),'revoked');
  assert.equal((await C.queryOne<any>('SELECT encrypted_tokens FROM mail_connections WHERE id=$1',[row.id])).encrypted_tokens,'revoked');
  assert.equal((await C.queryOne<any>('SELECT COUNT(*) AS n FROM connected_mail_evidence WHERE connection_id=$1',[row.id])).n,0);
  assert.ok(seen.includes('/revoke'));
  process.env.CONNECTED_MAIL_ENABLED='0';
  assert.equal((await M.mailStatus(actor,owner.household.id))[0].status,'revoked');
  await M.deleteMailData(actor,owner.household.id,transport);
  assert.equal((await C.queryOne<any>('SELECT COUNT(*) AS n FROM mail_connections WHERE household_id=$1',[owner.household.id])).n,0);
  process.env.CONNECTED_MAIL_ENABLED='1';
 });
 it('retention maintenance requires a long bearer and canonical origin',async()=>{
  const {NextRequest}=await import('next/server');
  const {POST}=await import('../app/api/mail/maintenance/route');
  const request=(token:string,origin='https://app.example.com')=>new NextRequest(`${origin}/api/mail/maintenance`,{method:'POST',headers:{authorization:`Bearer ${token}`}});
  assert.equal((await POST(request('bad'))).status,404);
  process.env.MAIL_MAINTENANCE_SECRET='s'.repeat(40);
  assert.equal((await POST(request('bad'))).status,404);
  assert.equal((await POST(request('s'.repeat(40),'https://evil.example.com'))).status,404);
  assert.equal((await POST(request('s'.repeat(40)))).status,200);
  delete process.env.MAIL_MAINTENANCE_SECRET;
 });
 it('rate limit backs off, Google revokes; Microsoft reports manual removal and no overbroad Graph permission',async()=>{
  const deferred=new P.HttpMailAdapter('microsoft',async()=>response({},429,{'retry-after':'4'}));
  await assert.rejects(deferred.listMinimalMetadata({domains:['example.edu'],checkpoint:null,metadataOnly:true,maxResults:50},{accessToken:'a',refreshToken:'b'}),e=>e instanceof P.RetryLater && e.retryAfterSeconds===4);
  const ms=await P.revokeGrant('microsoft',{accessToken:'a',refreshToken:'b'},async()=>{throw Error('Should not call Graph');});assert.equal(ms,'manual_required');
  let revoked=false;const google=await P.revokeGrant('gmail',{accessToken:'a',refreshToken:'b'},async(url,init)=>{revoked=String(url).endsWith('/revoke')&&String(init?.body).includes('token=b');return response({});});
  assert.equal(google,'revoked');assert.ok(revoked);
 });
});
