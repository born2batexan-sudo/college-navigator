/**
 * Date status
 * -----------
 * The Institutional Research Agent (v3+) writes a short label at the start of a
 * rule's `requirement` text when it cannot give a family a current-cycle answer:
 *
 *   "Not yet published: ..."                                   the school does this but hasn't posted this year's details
 *   "Prior cycle only, not yet confirmed for Fall 2027: ..."   only last year's information was found
 *   "Not applicable: ..."                                      the school genuinely doesn't have this (cited + quoted)
 *
 * This file turns those labels into one plain, consistent thing the family sees,
 * so no screen ever shows last year's date as if it were this year's. It reads the
 * label from the existing `requirement` column, so no database change is needed.
 *
 * If a "Not yet published" answer continues with "For reference, ..." (or "Last cycle: ..."), that
 * sentence is shown as the last-year reference.
 */

/** The entering term families are planning for. Keep in step with the agent's default term. */
export const ENTERING_TERM = "Fall 2027";

/** Short text for any place a date would normally go. */
export const DATE_NOT_POSTED_LABEL = "Date not posted yet";

export type DateStatus =
  | { kind: "current" }
  | {
      kind: "awaiting"; // school hasn't published this cycle's details (or only last cycle's are known)
      term: string;
      /** What was true last cycle, when we know it. Shown as "Last year: ... (for reference only)". */
      lastYear: string | null;
      /** The agent's own explanation, with the label stripped. */
      detail: string;
    }
  | { kind: "not_applicable"; detail: string };

const PRIOR_CYCLE = /^\s*Prior cycle only,?\s+not yet confirmed for\s+([A-Za-z]+\s+\d{4})\s*[:\-–—]?\s*/i;
const NOT_YET_PUBLISHED = /^\s*Not yet published\s*[:\-–—]?\s*/i;
const NOT_APPLICABLE = /^\s*Not applicable\s*[:\-–—]?\s*/i;
// The agent usually adds a sentence such as "For reference, the Fall 2026 due date was ..." after the
// "Not yet published" sentence. That sentence becomes the last-year reference.
const LAST_CYCLE_MARKER = /\s*(?:For reference,?|Last cycle:)\s*([\s\S]+)$/i;

function tidy(text: string, max = 220): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return (lastStop > 80 ? cut.slice(0, lastStop + 1) : cut.replace(/\s+\S*$/, "") + "…").trim();
}

/** Reads the label (if any) off a rule's requirement text. */
export function parseDateStatus(rule: { requirement: string | null | undefined }): DateStatus {
  const text = rule.requirement ?? "";

  const prior = text.match(PRIOR_CYCLE);
  if (prior) {
    const rest = text.slice(prior[0].length);
    return { kind: "awaiting", term: prior[1], lastYear: tidy(rest).replace(/\.$/, "") || null, detail: tidy(rest) };
  }

  if (NOT_YET_PUBLISHED.test(text)) {
    let rest = text.replace(NOT_YET_PUBLISHED, "");
    let lastYear: string | null = null;
    const marker = rest.match(LAST_CYCLE_MARKER);
    if (marker) {
      lastYear = tidy(marker[1]).replace(/\.$/, "");
      rest = rest.replace(LAST_CYCLE_MARKER, "");
    }
    return { kind: "awaiting", term: ENTERING_TERM, lastYear, detail: tidy(rest) };
  }

  if (NOT_APPLICABLE.test(text)) {
    return { kind: "not_applicable", detail: tidy(text.replace(NOT_APPLICABLE, "")) };
  }

  return { kind: "current" };
}

/** The standard sentence shown wherever a family would look for a date. */
export function awaitingMessage(schoolName: string, term: string): string {
  return `${schoolName} hasn't published ${term} dates for this yet. We'll update this when it's posted.`;
}

/** "Last year: ... (for reference only)", or null when we have nothing to show. */
export function lastYearLine(status: DateStatus): string | null {
  if (status.kind !== "awaiting" || !status.lastYear) return null;
  const ref = status.lastYear.charAt(0).toUpperCase() + status.lastYear.slice(1);
  return `Last year: ${ref} (for reference only)`;
}
