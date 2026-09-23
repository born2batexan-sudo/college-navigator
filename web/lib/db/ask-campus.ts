import { exec, newId, nowIso, queryOne, queryRows, usingPostgres, withTransaction } from './client';
import { evaluatePopulation, evaluateTrigger } from '../rules-engine';
import type { Institution, InstitutionRelationship, Rule, Student } from './types';
import { isOfficialInstitutionUrl } from './repo';
import { modelCostCents, selectOfficialEvidence, type EvidenceSelection } from '../ask-provider';

export type Citation = { title: string; quote: string; url: string; term: string; verifiedAt: string; sourceVerifiedAt: string };
export type Answer = { kind: 'fact' | 'unknown'; text: string; citations: Citation[] };
export interface EvidenceSelector { select(input: { question: string; evidence: readonly { id: string; title: string; quote: string; term: string }[] }): Promise<EvidenceSelection> }
const REFUSAL = 'I cannot answer this from current, certified official sources for this student and term. Please verify directly with the school.';
const MAX_DAILY_QUESTIONS = 20, MAX_DAILY_COST = 100, RESERVED_CENTS = 5;
const DAY_MS = 86_400_000;
export const assistantEnabled = () => process.env.ASSISTANT_ENABLED === '1';
const unknown = (text = REFUSAL): Answer => ({ kind: 'unknown', text, citations: [] });
const privateData = /\b\d{3}-\d{2}-\d{4}\b|\b(?:\d[ -]*?){13,19}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:password|passcode|api key|access token|secret key|social security|ssn|passport number|routing number|bank account|credit card|debit card|medical record|diagnosis|prescription|tax return|w-2|income|salary|financial statement|date of birth|birthdate|dob|gpa|transcript|test score|sat score|act score|phone number|home address)\b/i;
const unsafeRequest = /\b(?:essay|personal statement|supplemental response|application answer|recommendation letter|attest(?:ation)?|certif(?:y|ication)|sign(?:ature)?|e-?sign|submit|apply for me|pay(?:ment)?|purchase|refund|update (?:my|our|the) (?:record|profile|application)|change (?:my|our|the) (?:record|profile|application)|login|log in|credential|upload|medical|health|disability|financial disclosure|fafsa (?:form|answers)|tax form|bank statement)\b|\b(?:write|draft|compose|edit|evaluate|score|review|proofread|fill(?: out)?)\b|\b(?:am i eligible|will i get in|should i (?:apply|enroll|choose)|did i|have i|my (?:progress|status|eligibility))\b/i;
const evaluatedContent = /\b(?:admissions?|application|scholarship)\b.{0,60}\b(?:answer|response|prompt|interview|statement|content)\b|\b(?:answer|response|prompt|interview|statement|content)\b.{0,60}\b(?:admissions?|application|scholarship)\b/i;
const injection = /ignore (?:all |previous |the )?(?:instructions|rules)|system prompt|developer message|bypass|jailbreak|pretend you are|act as (?:a |an )?(?:system|developer)/i;
const STOPWORDS = new Set(['what','when','where','which','does','this','that','have','about','please','school','college','university','campus','passage','application','deadline','date','dates','task','tasks','information','official','source','tell','there','with','from','student','term','year','your','their','mine','ours','will','would','could','should','need','must','complete','completed','status','because']);
function tokens(value: string): string[] { return [...new Set((value.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(w => !STOPWORDS.has(w)))]; }
function fresh(value: unknown, now: number): boolean { const date = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(date) && date <= now && now - date <= 180 * DAY_MS; }
function safeUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
    !/^(?:localhost|\d+\.\d+\.\d+\.\d+|\[|.*\.(?:local|internal|test))$/i.test(u.hostname); } catch { return false; }
}
type ResearchRow = {
  id: string; title: string; checkpoint_code: string; domain: string; population: string; trigger_state: string | null;
  research_term: string; status: string; confidence: string; applicability: string; cycle_state: string;
  evidence_quote: string | null; verified_at: string | null; updated_at: string; source_id: string | null;
  url: string | null; authority_level: string | null; last_verified: string | null;
  coverage_status: string | null; certified_at: string | null; research_updated_at: string | null;
  pending_changes: number; institution_name: string; institution_domains: string; relationship_id: string; lifecycle_state: string; relationship_attributes: string;
};
function eligible(row: ResearchRow, student: Student, now: number): boolean {
  const rel = { lifecycleState: row.lifecycle_state, attributes: row.relationship_attributes } as InstitutionRelationship;
  const rule = { population: row.population, trigger: row.trigger_state } as Rule;
  let attrs: Record<string, unknown>;
  try { attrs = { ...JSON.parse(student.attributes), ...JSON.parse(row.relationship_attributes) }; } catch { return false; }
  return row.status === 'verified' && row.confidence === 'high' && row.applicability === 'applies' &&
    row.cycle_state === 'current' && row.coverage_status === 'certified' && row.authority_level === 'official' &&
    !!row.source_id && row.pending_changes === 0 && fresh(row.certified_at, now) && fresh(row.research_updated_at, now) &&
    fresh(row.verified_at, now) && fresh(row.last_verified, now) &&
    Date.parse(row.updated_at) <= Date.parse(row.certified_at!) &&
    typeof row.evidence_quote === 'string' && row.evidence_quote.length >= 10 && row.evidence_quote.length <= 700 &&
    !privateData.test(row.evidence_quote) && !injection.test(row.evidence_quote) && safeUrl(row.url) &&
    isOfficialInstitutionUrl(row.url!, { domains: row.institution_domains } as Institution) &&
    evaluatePopulation(rule, attrs, student) && evaluateTrigger(rule, rel);
}
function directlySupported(question: string, quote: string): boolean {
  if (/\b(?:due|deadline|last day|by what date)\b/i.test(question) && !/\b(?:due|deadline|by [A-Z][a-z]+ \d|no later than)\b/i.test(quote)) return false;
  if (/\b(?:require|required|requirements|must i|need to)\b/i.test(question) && !/\b(?:require|required|must|need|mandatory)\b/i.test(quote)) return false;
  if (/\b(?:how much|cost|price|fee|amount)\b/i.test(question) && !/(?:\$\s*\d|\b(?:cost|price|fee|USD)\b)/i.test(quote)) return false;
  return true;
}
function cited(row: ResearchRow): Citation {
  return { title: `${row.institution_name} — ${row.title}`, quote: row.evidence_quote!, url: row.url!, term: row.research_term,
    verifiedAt: row.verified_at!, sourceVerifiedAt: row.last_verified! };
}
function quoteAnswer(c: Citation): Answer {
  return { kind: 'fact', text: `Official source for ${c.title} (${c.term}; source checked ${c.sourceVerifiedAt.slice(0,10)}): “${c.quote}”\n\nThis is quoted source text, not a personalized decision or action.`, citations: [c] };
}

/** Only an authorized household/student can retrieve research. No question/answer text is persisted. */
export async function askCampus(input: { householdId: string; actorId: string; studentId: string; question: string; selector?: EvidenceSelector }): Promise<Answer> {
  if (!assistantEnabled()) return unknown('Ask Campus Passage is not available.');
  const question = input.question.trim();
  if (!question || question.length > 500 || privateData.test(question) || unsafeRequest.test(question) || evaluatedContent.test(question) || injection.test(question))
    return unknown('I cannot handle private information, application content, decisions, or actions. Ask a short question about a tracked school task instead.');
  const wantsModel = process.env.ASSISTANT_MODEL_ENABLED === '1';
  // Reserve one usage slot and a conservative maximum provider charge atomically.
  // Never hold a database lock/transaction while a network request is in flight.
  const prepared = await withTransaction(async () => {
    if (usingPostgres) await exec('SELECT pg_advisory_xact_lock(hashtext($1))', [`ask:${input.householdId}`]);
    const link = await queryOne('SELECT 1 AS ok FROM auth_links WHERE household_id=$1 AND auth_user_id=$2', [input.householdId, input.actorId]);
    const student = await queryOne<Student>('SELECT * FROM students WHERE id=$1 AND household_id=$2', [input.studentId, input.householdId]);
    if (!link || !student || input.householdId === process.env.DEMO_TEMPLATE_HOUSEHOLD_ID ||
      await queryOne('SELECT 1 AS ok FROM demo_households WHERE household_id=$1', [input.householdId])) throw new Error('Household access required');
    const since = new Date(Date.now() - DAY_MS).toISOString();
    const usage = await queryOne<{ n: number; cost: number }>('SELECT COUNT(*) AS n, COALESCE(SUM(model_cost_cents),0) AS cost FROM assistant_usage WHERE household_id=$1 AND created_at>$2', [input.householdId, since]);
    if (Number(usage?.n ?? 0) >= MAX_DAILY_QUESTIONS || Number(usage?.cost ?? 0) + (wantsModel ? RESERVED_CENTS : 0) > MAX_DAILY_COST) return { blocked: true as const };
    let term = ''; try { const parsed = JSON.parse(student.attributes); if (typeof parsed.enteringTerm === 'string') term = parsed.enteringTerm; } catch { /* fail closed */ }
    const rows = term ? await queryRows<ResearchRow>(`SELECT ru.id,ru.title,ru.checkpoint_code,ru.domain,ru.population,ru.trigger_state,ru.research_term,
      ru.status,ru.confidence,ru.applicability,ru.cycle_state,ru.evidence_quote,ru.verified_at,ru.updated_at,ru.source_id,
      s.url,s.authority_level,s.last_verified,rv.coverage_status,rv.certified_at,rv.updated_at AS research_updated_at,
      i.name AS institution_name,i.domains AS institution_domains,ir.id AS relationship_id,ir.lifecycle_state,ir.attributes AS relationship_attributes,
      (SELECT COUNT(*) FROM change_events ce WHERE ce.source_id=s.id AND ce.review_state='pending') AS pending_changes
      FROM institution_relationships ir JOIN institutions i ON i.id=ir.institution_id
      JOIN action_instances a ON a.relationship_id=ir.id JOIN rules ru ON ru.id=a.rule_id AND ru.institution_id=ir.institution_id
      LEFT JOIN sources s ON s.id=ru.source_id AND s.institution_id=ir.institution_id
      LEFT JOIN research_versions rv ON rv.institution_id=ir.institution_id AND rv.research_term=ru.research_term
      WHERE ir.student_id=$1 AND ir.active=1 AND ru.research_term=$2 LIMIT 101`, [student.id, term]) : [];
    // Topic selection is intentionally conservative: one matching rule, one tracked institution.
    // An ambiguous, stale, unpublished, conflicting or truncated set never yields a partial answer.
    const words = tokens(question);
    const tracked = await queryRows<{id:string;name:string}>(`SELECT ir.id,i.name FROM institution_relationships ir JOIN institutions i ON i.id=ir.institution_id
      WHERE ir.student_id=$1 AND ir.active=1`, [student.id]);
    const namedSchools = tracked.filter(s => tokens(s.name).some(w => words.includes(w)));
    const explicitUntrackedSchool = /\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s+(?:College|University)\b/.test(question) && namedSchools.length === 0;
    const matches = rows.filter(r => words.some(w => tokens(`${r.title} ${r.domain} ${r.checkpoint_code}`).includes(w)));
    const relevant = namedSchools.length === 1 ? matches.filter(r => namedSchools[0].id === r.relationship_id) : matches;
    const selected = rows.length < 101 && words.length && !explicitUntrackedSchool && namedSchools.length < 2 &&
      relevant.length === 1 && directlySupported(question, relevant[0].evidence_quote ?? '') &&
      eligible(relevant[0], student, Date.now()) ? relevant[0] : null;
    const usageId = newId('ask');
    await exec('INSERT INTO assistant_usage(id,household_id,actor_id,created_at,evidence_count,response_code,model_cost_cents) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [usageId, input.householdId, input.actorId, nowIso(), selected ? 1 : 0, 'reserved', wantsModel && selected ? RESERVED_CENTS : 0]);
    return { blocked: false as const, selected, usageId };
  });
  if (prepared.blocked) return unknown('The daily question or model budget limit is reached. Please try again tomorrow.');
  let answer = prepared.selected ? quoteAnswer(cited(prepared.selected)) : unknown();
  let code = prepared.selected ? 'fact_extract' : 'insufficient_evidence';
  let cost = 0;
  if (prepared.selected && wantsModel) {
    if (!process.env.ANTHROPIC_API_KEY && !input.selector) { answer = unknown('Ask Campus Passage provider is unavailable.'); code = 'provider_unconfigured'; }
    else {
      try {
        const c = cited(prepared.selected);
        const selected = await (input.selector ?? { select: selectOfficialEvidence }).select({ question,
          evidence: [{ id: prepared.selected.id, title: c.title, quote: c.quote, term: c.term }] });
        const billed = modelCostCents(selected.inputTokens, selected.outputTokens);
        if (billed > RESERVED_CENTS) throw new Error('Assistant budget exceeded');
        cost = billed;
        if (selected.citationId !== prepared.selected.id) { answer = unknown(); code = 'model_abstained'; }
        else code = 'fact_model_selected';
      } catch { answer = unknown(); code = 'provider_fallback'; cost = RESERVED_CENTS; }
    }
  }
  await exec('UPDATE assistant_usage SET response_code=$1,model_cost_cents=$2 WHERE id=$3 AND household_id=$4', [code, cost, prepared.usageId, input.householdId]);
  return answer;
}
