import { createHash } from "node:crypto";
import { ALL_CHECKPOINTS } from "./checkpoints";

export const EVIDENCE_STATES = ["verified", "not_applicable", "not_yet_published", "publication_date_unknown", "not_publicly_available", "not_found_official", "conflicting", "under_review", "withheld"] as const;
export type EvidenceState = typeof EVIDENCE_STATES[number];
export type Candidate = { code: string; state: EvidenceState; sourceUrl?: string; quote?: string; pageText?: string; secondSourceUrl?: string; secondQuote?: string; secondPageText?: string; explanation?: string; publicationDate?: string; checkedAt?: string; nextCheckAt?: string };
export type Resolution = { code: string; state: EvidenceState; sourceUrl: string | null; quote: string | null; explanation: string; fingerprint: string | null; checkedAt: string; nextCheckAt: string };
const HIGH_RISK = /(?:deadline|fee|deposit|refund|waiver|insurance|residency|immunization|requirement|aid|tuition|payment|scholarship)/i;
const CP = new Map(ALL_CHECKPOINTS.map(c => [c.code, c]));
export function officialUrl(url: string, domain: string): boolean {
  try {
    const u = new URL(url), d = domain.toLowerCase().replace(/^www\./, "");
    return u.protocol === "https:" && !u.username && !u.password && !u.port && (u.hostname.toLowerCase() === d || u.hostname.toLowerCase().endsWith(`.${d}`));
  } catch { return false; }
}
export function nextCheck(state: EvidenceState, now: Date, publicationDate?: string, term?: string): string {
  let days: number = ({verified: 30, not_applicable: 60, not_yet_published: 7, publication_date_unknown: 14, not_publicly_available: 30, not_found_official: 14, conflicting: 1, under_review: 3, withheld: 3} as const)[state];
  const match=term?.match(/^(Fall|Spring|Summer|Winter) (20\d\d)$/);
  if(match){
    const month=({Fall:8,Spring:0,Summer:4,Winter:0} as Record<string,number>)[match[1]];
    const start=new Date(Date.UTC(Number(match[2]),month,1));
    const remaining=(start.getTime()-now.getTime())/86400000;
    if(remaining<=30 && remaining>=-60) days=Math.min(days,2);
    else if(remaining<=90 && remaining>30) days=Math.min(days,7);
  }
  const candidate = new Date(now.getTime() + days * 86400000);
  if (publicationDate && /^\d{4}-\d\d-\d\d$/.test(publicationDate)) {
    const published = new Date(`${publicationDate}T00:00:00Z`);
    if (!Number.isNaN(published.getTime()) && published > now && published < candidate) return published.toISOString();
  }
  return candidate.toISOString();
}
/** Independent, deliberately conservative evidence gate. A model's label is not proof. */
export function resolveCandidate(candidate: Candidate | undefined, code: string, term: string, domain: string, now = new Date()): Resolution {
  if (!CP.has(code)) throw new Error(`Unknown checkpoint ${code}`);
  let state: EvidenceState = candidate && EVIDENCE_STATES.includes(candidate.state) && candidate.code === code ? candidate.state : "under_review";
  const url = candidate?.sourceUrl ?? "", text = candidate?.pageText ?? "", quote = candidate?.quote?.trim() ?? "";
  const hasEvidence = officialUrl(url, domain) && quote.length >= 12 && text.includes(quote) && text.length <= 200000;
  // Never treat an undated/prior-cycle page as proof of the exact entering term.
  const currentTerm = text.includes(term) && quote.includes(term);
  if (["verified", "not_applicable", "not_yet_published"].includes(state)) {
    if (!hasEvidence || !currentTerm) state = "withheld";
    else if (state === "not_yet_published" && !/(not yet (?:published|posted|available|open)|will (?:be )?(?:published|posted|available)|publication (?:is )?expected)/i.test(quote)) state = "under_review";
    else if (state === "not_applicable" && !/(not required|does not apply|not applicable|exempt|no .*required)/i.test(quote)) state = "under_review";
    else if (state === "verified" && HIGH_RISK.test(CP.get(code)!.title)) {
      const second = candidate?.secondSourceUrl ?? "", secondText = candidate?.secondPageText ?? "", secondQuote = candidate?.secondQuote ?? "";
      if (!officialUrl(second, domain) || second === url || secondQuote.length < 12 || !secondText.includes(secondQuote) || !secondQuote.includes(term)) state = "under_review";
      else {
        const claims=(s:string)=>[...s.matchAll(/\$\s?\d+(?:,\d{3})*(?:\.\d{2})?|\b20\d\d-\d\d-\d\d\b|\b\d{1,2}\/\d{1,2}(?:\/20\d\d)?\b|\b\d+(?:\.\d+)?%/g)].map(m=>m[0].replaceAll(' ',''));
        const a=claims(quote),b=claims(secondQuote);
        if (a.length && b.length && JSON.stringify(a)!==JSON.stringify(b)) state="conflicting";
        else if (quote!==secondQuote && (!a.length || !b.length)) state="under_review";
      }
    }
  }
  if (state === "not_publicly_available" && (!hasEvidence || !currentTerm)) state = "not_found_official";
  // Claim that publication has not occurred must itself be supported by an explicit institutional statement.
  const safe = state === "verified" || state === "not_applicable" || state === "not_yet_published";
  const checkedAt = now.toISOString();
  return { code, state, sourceUrl: safe ? url : null, quote: safe ? quote.slice(0, 500) : null,
    explanation: safe ? "Exact-term official evidence checked" : "No independently validated exact-term public evidence", 
    fingerprint: safe ? createHash("sha256").update(text).digest("hex") : null, checkedAt,
    nextCheckAt: nextCheck(state, now, candidate?.publicationDate, term) };
}
export function resolveAll(candidates: Candidate[], term: string, domain: string, now = new Date()): Resolution[] {
  const byCode = new Map<string, Candidate>();
  const duplicates = new Set<string>();
  for (const c of candidates) { if (byCode.has(c.code)) duplicates.add(c.code); byCode.set(c.code, c); }
  return ALL_CHECKPOINTS.map(c => duplicates.has(c.code)
    ? resolveCandidate({code:c.code,state:"conflicting",explanation:"Multiple competing proposals"},c.code,term,domain,now)
    : resolveCandidate(byCode.get(c.code),c.code,term,domain,now));
}
export function materialFingerprint(rows: Resolution[]): string {
  return createHash("sha256").update(JSON.stringify(rows.map(r => [r.code,r.state,r.sourceUrl,r.quote,r.fingerprint]))).digest("hex");
}
