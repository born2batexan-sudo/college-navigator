// Fixed, fictional data used only by the protected owner review lab. It never
// reads or writes household records and must not be presented as live service data.

export type ReviewStudent = {
  id: "maya" | "noah";
  name: string;
  year: string;
  preferences: { carParking: boolean; campusHousing: boolean; greekLife: boolean; accommodations: boolean };
};

export const reviewStudents: ReviewStudent[] = [
  { id: "maya", name: "Maya Rivera", year: "Class of 2027", preferences: { carParking: false, campusHousing: true, greekLife: false, accommodations: true } },
  { id: "noah", name: "Noah Rivera", year: "Class of 2028", preferences: { carParking: true, campusHousing: false, greekLife: true, accommodations: false } },
];

type PreferenceKey = keyof ReviewStudent["preferences"];
export type ReviewWork = { id: string; title: string; detail: string; preference?: PreferenceKey; hideReason?: string; theme: string };

export const reviewWork: ReviewWork[] = [
  { id: "aid", title: "Review the fictional aid offer summary", detail: "Compare grants, loans, and family questions before the response date.", theme: "Financial aid" },
  { id: "tuition", title: "Save the fictional tuition and 529 billing date", detail: "Record the posted amount and the family’s payment-plan question.", theme: "Tuition, billing & 529" },
  { id: "parking", title: "Read the fictional student parking permit window", detail: "Aurora University sample permit window: August 3–12.", preference: "carParking", hideReason: "Hidden because this student is marked as not bringing a car.", theme: "Campus logistics" },
  { id: "housing", title: "Choose a fictional housing preference", detail: "Demo preference form opens after the admission response.", preference: "campusHousing", hideReason: "Hidden because this student is marked as not seeking campus housing.", theme: "Housing" },
  { id: "greek", title: "Read the fictional Greek-life orientation note", detail: "This is an awareness item, not a recommendation to join.", preference: "greekLife", hideReason: "Hidden because this student is marked as not interested in Greek life.", theme: "Student life" },
  { id: "access", title: "Review the fictional accommodations contact", detail: "Families can see the official contact and decide whether to reach out.", preference: "accommodations", hideReason: "Hidden because this student is marked as not requesting accommodations information.", theme: "Accessibility" },
];

export function filterReviewWork(student: ReviewStudent): { visible: ReviewWork[]; hidden: ReviewWork[] } {
  return reviewWork.reduce<{ visible: ReviewWork[]; hidden: ReviewWork[] }>((result, work) => {
    (work.preference && !student.preferences[work.preference] ? result.hidden : result.visible).push(work);
    return result;
  }, { visible: [], hidden: [] });
}

export const journeyThemes = [
  "College list and fit", "Application planning", "Official portal and document follow-up", "Admission decisions and response planning",
  "Financial aid", "Scholarship awareness", "Tuition, billing, and 529", "Housing and move-in", "Accommodations and accessibility",
  "Campus logistics, including car and parking", "Student life, including Greek life", "Enrollment transition and first-term readiness",
] as const;

export type HorizonEvent = { label: string; state: "Opens" | "Due" | "Expected announcement" | "Window" | "Actual release" | "Response deadline" | "Not yet published"; date?: string; note: string };
export const horizonEvents: HorizonEvent[] = [
  { label: "Fictional aid-offer portal", state: "Opens", date: "January 15", note: "Demo date from the Aurora University fact sheet." },
  { label: "Fictional FAFSA correction", state: "Due", date: "March 1", note: "Sample planning deadline; families confirm official instructions." },
  { label: "Fictional scholarship update", state: "Expected announcement", date: "Late March", note: "A planning estimate, clearly separate from a confirmed release." },
  { label: "Fictional housing preference form", state: "Window", date: "April 8–22", note: "Example open period." },
  { label: "Fictional admission result", state: "Actual release", date: "March 22", note: "Sample result date recorded after release." },
  { label: "Fictional enrollment response", state: "Response deadline", date: "May 1", note: "Example response deadline." },
  { label: "Fictional fall billing statement", state: "Not yet published", note: "No date is invented when the sample source has not published one." },
];

export const guideFacts = [
  { topic: "aid", answer: "In this fictional lab, Aurora University’s aid-offer portal opens January 15 and the sample response date is May 1. Compare the offer with the family before responding.", sources: ["Aurora University fictional aid fact sheet", "Aurora University fictional response calendar"] },
  { topic: "parking", answer: "For the fictional Maya profile, parking is hidden because she is not bringing a car. If that preference changes, the sample August 3–12 permit window appears.", sources: ["Aurora University fictional transportation page"] },
  { topic: "housing", answer: "The fictional housing preference window is April 8–22. This lab only shows the timing; it does not submit a housing form.", sources: ["Aurora University fictional housing calendar"] },
  { topic: "bill", answer: "The fictional fall billing statement is not yet published. This lab does not infer an amount or a payment date; it only keeps the family’s tuition and 529 question visible.", sources: ["Aurora University fictional billing page"] },
] as const;

export function answerReviewGuide(question: string): { answer: string; sources: readonly string[]; refused: boolean } {
  const normalized = question.toLowerCase();
  const fact = guideFacts.find(({ topic }) => topic === "aid" ? /aid|fafsa|offer|response/.test(normalized) : topic === "parking" ? /park|car/.test(normalized) : topic === "housing" ? /housing|move/.test(normalized) : /bill|tuition|529|pay/.test(normalized));
  if (!fact) return { answer: "I can’t answer that from the fixed fictional facts in this review lab. Please check an official source or add a verified fact before relying on it.", sources: [], refused: true };
  return { answer: fact.answer, sources: fact.sources, refused: false };
}

export function pageAssistMode(active: boolean): "inactive" | "read-explain-only" { return active ? "read-explain-only" : "inactive"; }
