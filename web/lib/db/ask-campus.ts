// Review-only Ask Campus Passage. No model key or chain-of-thought storage.
import { exec, newId, nowIso, queryOne, queryRows, usingPostgres, withTransaction } from './client';
export type Citation = {title:string;quote:string;url:string;term:string;verifiedAt:string;sourceVerifiedAt:string};
export type Answer = {kind:'fact'|'unknown';text:string;citations:Citation[];label:'Built—not live'};
export interface AnswerModel { answer(input:{question:string;evidence:readonly Citation[]}):Promise<Answer> }
const refusal=(text='I do not have enough current, certified official evidence to answer that. Please confirm with the school.'):Answer=>({kind:'unknown',text,citations:[],label:'Built—not live'});
const sensitive=/\b\d{3}-\d{2}-\d{4}\b|\b(?:\d[ -]*?){13,19}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(password|passcode|api key|access token|social security)\b/i;
const injection=/ignore (all |previous |the )?(instructions|rules)|system prompt|developer message|bypass|jailbreak|pretend you are/i;
export async function askCampus(input:{householdId:string;actorId:string;studentId:string;question:string;model?:AnswerModel}):Promise<Answer> {
 const question=input.question.trim();
 if (!question || question.length>500 || sensitive.test(question)) return refusal('Please remove personal or financial information and ask a short question about your plan.');
 if (injection.test(question)) return refusal();
 return withTransaction(async()=>{
  if (usingPostgres) await exec('SELECT pg_advisory_xact_lock(hashtext($1))',[`ask:${input.householdId}`]);
  const link=await queryOne('SELECT 1 AS ok FROM auth_links WHERE household_id=$1 AND auth_user_id=$2',[input.householdId,input.actorId]);
  const student=await queryOne<any>('SELECT id,attributes FROM students WHERE id=$1 AND household_id=$2',[input.studentId,input.householdId]);
  if (!link || !student || input.householdId===process.env.DEMO_TEMPLATE_HOUSEHOLD_ID || await queryOne('SELECT 1 AS ok FROM demo_households WHERE household_id=$1',[input.householdId])) throw new Error('Household access required');
  const since=new Date(Date.now()-86400000).toISOString();
  const usage=await queryOne<{n:number;cost:number}>('SELECT COUNT(*) AS n,COALESCE(SUM(model_cost_cents),0) AS cost FROM assistant_usage WHERE household_id=$1 AND created_at>$2',[input.householdId,since]);
  if (Number(usage?.n ?? 0)>=20 || Number(usage?.cost ?? 0)>=100) return refusal('The daily question limit is reached. Please try again tomorrow.');
  let term=''; try {term=JSON.parse(student.attributes).enteringTerm ?? '';}catch{}
  // Questions are not passed to SQL. Research must be certified, current,
  // applicable to this student's tracked school and backed by official evidence.
  const rows=await queryRows<any>(`SELECT ru.title,ru.evidence_quote,ru.research_term,ru.verified_at,
   s.url,s.last_verified,s.label,a.state,ru.checkpoint_code
   FROM action_instances a JOIN institution_relationships ir ON ir.id=a.relationship_id AND ir.active=1
   JOIN rules ru ON ru.id=a.rule_id AND ru.institution_id=ir.institution_id
   JOIN research_versions rv ON rv.institution_id=ru.institution_id AND rv.research_term=ru.research_term
   JOIN sources s ON s.id=ru.source_id AND s.institution_id=ru.institution_id AND s.authority_level='official'
   WHERE ir.student_id=$1 AND ru.research_term=$2 AND ru.status='verified' AND ru.confidence IN ('high','medium')
   AND ru.applicability='applies' AND ru.cycle_state='current' AND rv.coverage_status='certified' AND rv.certified_at IS NOT NULL
   AND ru.evidence_quote IS NOT NULL AND trim(ru.evidence_quote)<>'' AND ru.verified_at IS NOT NULL AND s.last_verified IS NOT NULL
   LIMIT 100`,[input.studentId,term]);
  const words=question.toLowerCase().match(/[a-z]{4,}/g)?.filter(w=>!['what','when','where','which','does','this','that','have','about','please','school'].includes(w)) ?? [];
  const citations:Citation[]=rows.filter(r=>{
   const hay=`${r.title} ${r.checkpoint_code}`.toLowerCase();
   return words.some(w=>hay.includes(w)) && !sensitive.test(r.evidence_quote) && !injection.test(r.evidence_quote) && r.evidence_quote.length<=1000 && Date.now()-Date.parse(r.last_verified)<180*86400000 && Date.now()-Date.parse(r.verified_at)<180*86400000 && Date.parse(r.last_verified)<=Date.now() && /^https:\/\//.test(r.url);
  }).slice(0,3).map(r=>({title:r.title,quote:r.evidence_quote,url:r.url,term:r.research_term,verifiedAt:r.verified_at,sourceVerifiedAt:r.last_verified}));
  let answer:Answer=refusal();
  if (citations.length) {
   // Deterministic fallback: quotes only, never calculate deadlines, eligibility,
   // progress or amounts. Connected mail never certifies research independently.
   answer={kind:'fact',text:citations.map(c=>`Official source for ${c.title} (${c.term}; checked ${c.sourceVerifiedAt.slice(0,10)}): “${c.quote}” [${c.url}].`).join('\n\n')+'\n\nThis is source text, not an eligibility decision or an action on your behalf.',citations,label:'Built—not live'};
   if (input.model && process.env.ASSISTANT_MODEL_ENABLED==='1') {
    // Any future model output is bounded by the exact citation set; no free-form
    // claims or model reasoning are persisted. Until reviewed, fallback is safer.
    const candidate=await input.model.answer({question,evidence:citations});
    if (candidate.kind==='fact' && candidate.text===answer.text && candidate.citations.length===citations.length && candidate.citations.every(c=>citations.some(e=>e.url===c.url && e.quote===c.quote && e.term===c.term))) answer=candidate;
   }
  }
  await exec('INSERT INTO assistant_usage(id,household_id,actor_id,created_at,evidence_count,response_code,model_cost_cents) VALUES($1,$2,$3,$4,$5,$6,0)',[newId('ask'),input.householdId,input.actorId,nowIso(),citations.length,answer.kind]);
  return answer;
 });
}
