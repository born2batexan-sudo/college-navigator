import type { Source, Rule } from "@/lib/db/types";
import { formatDate } from "@/lib/format";

/** Only a research record marked official can supply a destination. Guidance prose/deep links are not verified URLs. */
export function verifiedOfficialUrl(source: Source | null | undefined): string | null {
  if (!source || source.authorityLevel !== "official") return null;
  try {
    const url = new URL(source.url);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".") ||
      /^(localhost|\d+\.\d+\.\d+\.\d+)$/i.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

export function OfficialDestination({ source, rule, schoolName, illustrative = false }: { source: Source | null | undefined; rule: Pick<Rule, "title" | "domain" | "researchTerm" | "applicability" | "evidenceQuote">; schoolName: string; illustrative?: boolean }) {
  const verified = verifiedOfficialUrl(source);
  // This legacy source is specifically a counselor Slate.org resource, not a
  // student's OU application portal. A 200 on ou.edu does not make it a safe
  // applicant destination. Withhold rather than invent a replacement URL.
  const wrongAudience = /application portal/i.test(rule.title) &&
    /^https:\/\/(?:www\.)?ou\.edu\/admissions\/counselor-resources\/slate-account(?:[/?#]|$)/i.test(verified ?? "");
  const href = wrongAudience ? null : verified;
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
    </> : illustrative ? <details className="mt-1"><summary className="cursor-pointer font-semibold text-accent underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">How official destinations work</summary><p className="mt-1 text-xs text-ink/65">A signed-in task links verified school instructions and shows its source, term, applicability, and last check. {schoolName} is an illustrative school, so this preview has no external destination or source-check claim. Confirm real steps on the school&apos;s official site.</p></details> : <p className="mt-1 text-sm text-warn">Official destination unavailable — no verified official URL for this task. Check with {schoolName}; no destination has been invented.</p>}
  </div>;
}
