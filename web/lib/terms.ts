export const RESEARCHED_TERM = "Fall 2027";
export const START_TERMS = ["Summer 2027", "Fall 2027", "Winter 2028", "Spring 2028", "Summer 2028", "Fall 2028", "Not sure yet"] as const;
export type StartTerm = (typeof START_TERMS)[number];
export function isStartTerm(value: unknown): value is StartTerm { return typeof value === "string" && (START_TERMS as readonly string[]).includes(value); }
export function enteringTermFrom(student: { attributes: string }): StartTerm | null {
  try { const value = JSON.parse(student.attributes ?? "{}").enteringTerm; return isStartTerm(value) ? value : null; } catch { return null; }
}
export function termNotice(term: StartTerm | null): string | null {
  if (!term || term === RESEARCHED_TERM) return null;
  return `Our verified school research currently covers ${RESEARCHED_TERM} entry. We will not present it as current for ${term}.`;
}
