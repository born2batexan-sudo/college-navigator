/** Protected-review fail-closed hold. The Fall 2027 OU AID-03 priority FAFSA date is
 * disputed by two OU offices; neither page certifies this entering term's date.
 * This is a release safeguard, not a correction of persisted research. Remove
 * only after term-specific official research, action/guidance/reminder repair,
 * and review. Stable institution/checkpoint/term identity survives editorial
 * title, label, URL, source row, and guidance changes. */
export const OU_AID_HOLD = {
  institutionId: "inst_eac57e77d4b44cf4b3ec146c5c99a7d0",
  checkpointCode: "AID-03",
  researchTerm: "Fall 2027",
} as const;

export function isOuAidDateHeld(rule: { institutionId: string; checkpointCode: string; researchTerm: string }): boolean {
  return rule.institutionId === OU_AID_HOLD.institutionId &&
    rule.checkpointCode === OU_AID_HOLD.checkpointCode && rule.researchTerm === OU_AID_HOLD.researchTerm;
}

export const OU_AID_HOLD_TITLE = "Priority FAFSA timing — school confirmation needed";
export const OU_AID_HOLD_MESSAGE = "University of Oklahoma priority FAFSA timing for Fall 2027 is unresolved: official admissions and Student Financial Center pages conflict, and neither confirms this entering term. Do not use a date or schedule a reminder from this item. Confirm the applicable aid-year deadline with OU's Student Financial Center.";
export const OU_AID_CONFLICT_SOURCES = [
  { label: "OU freshman admissions FAQ (general financial-help answer)", url: "https://www.ou.edu/admissions/apply/freshman/faq" },
  { label: "OU Student Financial Center dates and deadlines", url: "https://www.ou.edu/sfc/dates-and-deadlines" },
] as const;
