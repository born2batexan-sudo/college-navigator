import type { Source, Rule } from "@/lib/db/types";
import { formatDate } from "@/lib/format";
import { isOuAidDateHeld } from "@/lib/ou-aid-quarantine";

/** Only a research record marked official can supply a destination. Guidance prose/deep links are not verified URLs. */
export function verifiedOfficialUrl(source: Source | null | undefined): string | null {
  // An official-domain flag without a recorded source check is not a verified
  // destination. Legacy imported sources may have authority but no audit date.
  if (!source || source.authorityLevel !== "official" || !source.lastVerified) return null;
  try {
    const url = new URL(source.url);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".") ||
      /^(localhost|\d+\.\d+\.\d+\.\d+)$/i.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

type DestinationRule = Pick<Rule, "title" | "domain" | "researchTerm" | "applicability" | "evidenceQuote"> &
  Partial<Pick<Rule, "institutionId" | "checkpointCode">>; // illustrative landing preview has no live rule identity

/** Audited staging task/source mismatches. Key on institution + stable checkpoint + actual URL,
 * not the research rule's editorial title (or the separate guidance.what shown on cards).
 * An unchanged source page remains withheld even if labels, guidance, or source rows change.
 * Adding a checked, applicable replacement URL requires a separate source review. */
function mismatchedTaskSource(rule: DestinationRule, source: Source | null | undefined, verified: string | null): boolean {
  if (!verified || !source || !rule.institutionId || !rule.checkpointCode ||
      source.institutionId !== rule.institutionId) return false;
  const url = new URL(verified);
  const page = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  const audited = [
    { institution: "inst_7b2274ac563f45878b11101d5a89f38f", checkpoint: "AID-03", page: "https://admissions.utexas.edu/apply/freshman" },
    { institution: "inst_eac57e77d4b44cf4b3ec146c5c99a7d0", checkpoint: "ADM-05", page: "https://www.ou.edu/admissions/apply/freshman" },
    // Counselor-only Slate.org resources must not be presented as an applicant's status portal.
    { institution: "inst_eac57e77d4b44cf4b3ec146c5c99a7d0", checkpoint: "ADM-11", page: "https://www.ou.edu/admissions/counselor-resources/slate-account" },
    // The general Arkansas FAQ does not explain the applicant's missing-items checklist.
    { institution: "inst_b7c0982eee4a48d68715c857ea93ca84", checkpoint: "ADM-11", page: "https://admissions.uark.edu/apply/faqs.php" },
  ];
  return audited.some(item => item.institution === rule.institutionId && item.checkpoint === rule.checkpointCode && item.page === page);
}

export function OfficialDestination({ source, rule, schoolName, illustrative = false }: { source: Source | null | undefined; rule: DestinationRule; schoolName: string; illustrative?: boolean }) {
  // A cross-school source row is not a task-matched destination, even when its host is official.
  const verified = source && rule.institutionId && source.institutionId !== rule.institutionId
    ? null : verifiedOfficialUrl(source);
  const held = !!rule.institutionId && !!rule.checkpointCode && isOuAidDateHeld({ institutionId: rule.institutionId, checkpointCode: rule.checkpointCode, researchTerm: rule.researchTerm });
  // A checked source alone cannot certify a rule whose admissions term is unknown.
  const href = !rule.researchTerm?.trim() || held || mismatchedTaskSource(rule, source, verified) ? null : verified;
  const sensitive = /portal|log[ -]?in|payment|pay |deposit|billing|accept.*award/i.test(`${rule.title} ${rule.domain}`);
  return <div className="rounded-lg border border-line bg-white/80 p-3 text-sm text-ink/75" data-official-destination>
    <p className="font-semibold text-ink">Official destination · {sensitive ? "portal/login/payment-sensitive task" : "information and instructions"}</p>
    {href ? <>
      <a className="mt-1 inline-block break-all font-semibold text-accent underline" href={href} target="_blank" rel="noopener noreferrer">
        Open {schoolName} official source: {source!.label} ↗
      </a>
      <p className="mt-1 text-xs">Opens the school&apos;s source in a new tab. {sensitive ? "This is a source/instructions link, not a verified direct login or payment endpoint. Follow the school's own portal instructions; Campus Passage never signs in, submits, or pays for you." : "Follow the school's instructions yourself; Campus Passage does not act in school portals."}</p>
      <p className="mt-1 text-xs text-ink/55">{rule.researchTerm} · {rule.applicability.replaceAll("_", " ")} · source {source!.lastVerified ? `last checked ${formatDate(source!.lastVerified)}` : "check date unavailable"}</p>
      {rule.evidenceQuote && <p className="mt-1 text-xs text-ink/65">Research evidence: “{rule.evidenceQuote}”</p>}
    </> : illustrative ? <details className="mt-1"><summary className="cursor-pointer font-semibold text-accent underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">How official destinations work</summary><p className="mt-1 text-xs text-ink/65">A signed-in task links verified school instructions and shows its source, term, applicability, and last check. {schoolName} is an illustrative school, so this preview has no external destination or source-check claim. Confirm real steps on the school&apos;s official site.</p></details> : <p className="mt-1 text-sm text-warn">{held ? "Deadline and task destination on hold — official school pages conflict; confirm the applicable term with OU Student Financial Center before acting." : `Official destination unavailable — no dated, task-matched official URL verified for this task. Check with ${schoolName}; no destination has been invented.`}</p>}
  </div>;
}
