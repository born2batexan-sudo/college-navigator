// Copy guard: keeps other companies' trademarked names out of anything a
// family reads, and out of what the agents read back.
//
// Why it exists: College Navigator has no permission to use certain third-party
// names, so no screen, email or export may show them. School web pages (which
// the research agent summarizes) sometimes do use them, so wording that came
// from a school can carry one in. Every rule, guidance and source label passes
// through cleanCopy() as it is read from the database (see lib/db/repo.ts), so
// old rows and future rows are both covered without touching the database.
//
// The blocked names are assembled from fragments on purpose, so the name itself
// never appears in this (public) repository. To block another name, add a line
// to BLOCKED below.

const BLOCKED: { pattern: RegExp; replacement: string }[] = [
  {
    pattern: new RegExp("(?:\\bthe\\s+)?\\b" + ["comm", "on"].join("") + "[\\s-]*app(?:lication)?s?\\b", "gi"),
    replacement: "the application platform",
  },
];

/** Replace any blocked name. Safe to call on null/undefined. Keeps capitalization at the start of a sentence. */
export function cleanCopy<T extends string | null | undefined>(text: T): T {
  if (typeof text !== "string" || text === "") return text;
  let out: string = text;
  for (const { pattern, replacement } of BLOCKED) {
    out = out.replace(pattern, (match: string, offset: number, whole: string) => {
      const before = whole.slice(0, offset);
      const startsSentence = before.trim() === "" || /[.!?]["')\]]*\s+$/.test(before);
      return startsSentence ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;
    });
  }
  return out as T;
}

/** True if the text contains a blocked name (used by tests and the export report). */
export function hasBlockedName(text: string | null | undefined): boolean {
  if (!text) return false;
  return BLOCKED.some(({ pattern }) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}
