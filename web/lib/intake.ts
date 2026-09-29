import type { Student } from "./db/types";

/** Household-level defaults for one student's plan, not school decisions or eligibility findings. */
export const INTAKE_QUESTIONS = [
  { key: "housing", title: "Housing and commuting", prompt: "Where might this student live?", kind: "housing" },
  { key: "vehicle", title: "Vehicle", prompt: "Might this student bring a car to campus?", kind: "choice" },
  { key: "educationSavings", title: "529 or prepaid plan", prompt: "Might the family use a 529 or prepaid tuition plan?", kind: "choice" },
  { key: "schoolScholarships", title: "School scholarships", prompt: "Would you like to explore scholarships offered by schools?", kind: "choice" },
  { key: "outsideScholarships", title: "Outside scholarships", prompt: "Would you like to explore scholarships from other organizations?", kind: "choice" },
  { key: "financialAid", title: "Financial aid", prompt: "Would you like to explore financial aid?", kind: "choice" },
  { key: "accessibility", title: "Accessibility", prompt: "Would information about accommodations or accessibility be helpful?", kind: "choice" },
  { key: "campusLife", title: "Campus life and Greek recruitment", prompt: "Might this student explore Greek recruitment or campus organizations?", kind: "choice" },
  { key: "visits", title: "Visits", prompt: "Might this student visit a campus?", kind: "choice" },
  { key: "orientation", title: "Orientation", prompt: "Would information about orientation be helpful?", kind: "choice" },
  { key: "programNeeds", title: "Program-specific needs", prompt: "Might this student pursue a program with additional steps (such as an audition or portfolio)?", kind: "choice" },
  { key: "familyTravel", title: "Family move-in and travel", prompt: "Would help planning family travel or move-in be useful?", kind: "choice" },
] as const;

export type IntakeKey = (typeof INTAKE_QUESTIONS)[number]["key"];
export type IntakeChoice = "yes" | "no" | "unsure" | "ask_later";
export type HousingChoice = "on_campus" | "off_campus" | "commuter" | "undecided" | "ask_later";
export type IntakeAnswers = { [K in IntakeKey]: K extends "housing" ? HousingChoice : IntakeChoice };
const CHOICES = new Set<string>(["yes", "no", "unsure", "ask_later"]);
const HOUSING_CHOICES = new Set<string>(["on_campus", "off_campus", "commuter", "undecided", "ask_later"]);
export const CHOICE_OPTIONS = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "unsure", label: "Unsure" }, { value: "ask_later", label: "Ask me later" }] as const;
export const HOUSING_OPTIONS = [{ value: "on_campus", label: "On campus" }, { value: "off_campus", label: "Off campus" }, { value: "commuter", label: "Commute from home" }, { value: "undecided", label: "Undecided" }, { value: "ask_later", label: "Ask me later" }] as const;

export function readIntake(student: Pick<Student, "attributes">): Partial<IntakeAnswers> {
  let raw: unknown;
  try { raw = JSON.parse(student.attributes || "{}"); } catch { return {}; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const stored = (raw as Record<string, unknown>).intake;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const answers: Record<string, string> = {};
  for (const question of INTAKE_QUESTIONS) {
    const value = (stored as Record<string, unknown>)[question.key];
    if (typeof value === "string" && (question.kind === "housing" ? HOUSING_CHOICES : CHOICES).has(value)) answers[question.key] = value;
  }
  return answers as Partial<IntakeAnswers>;
}

/** Reject partial, duplicate, or invented fields rather than overwriting saved answers with blanks. */
export function parseIntakeForm(formData: FormData): IntakeAnswers {
  const allowed = new Set<string>(["studentId", ...INTAKE_QUESTIONS.map((q) => q.key)]);
  for (const key of formData.keys()) if (!allowed.has(key)) throw new Error("Unexpected intake field");
  const answers: Record<string, string> = {};
  for (const question of INTAKE_QUESTIONS) {
    const values = formData.getAll(question.key);
    if (values.length !== 1 || typeof values[0] !== "string" || !(question.kind === "housing" ? HOUSING_CHOICES : CHOICES).has(values[0])) {
      throw new Error(`Choose a valid answer for ${question.title}`);
    }
    answers[question.key] = values[0];
  }
  return answers as IntakeAnswers;
}

/** Unknown/ask-later stays null, not false: potentially relevant steps remain visible. */
export function intakeRuleDefaults(answers: Partial<IntakeAnswers>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (answers.housing) result.housingPlan = answers.housing === "ask_later" ? "undecided" : answers.housing;
  const mappings = [
    ["vehicle", "bringingCar"], ["accessibility", "disabilityAccommodation"], ["campusLife", "greekInterest"],
    ["educationSavings", "educationSavings"], ["schoolScholarships", "schoolScholarships"],
    ["outsideScholarships", "outsideScholarships"], ["financialAid", "financialAid"],
    ["visits", "visits"], ["orientation", "orientation"], ["programNeeds", "programNeeds"], ["familyTravel", "familyTravel"],
  ] as const;
  for (const [key, attribute] of mappings) {
    const value = answers[key];
    if (value) result[attribute] = value === "yes" ? true : value === "no" ? false : null;
  }
  return result;
}

/** This summary is planning context, never a substitute for a school's rules. */
export function intakeSummary(answers: Partial<IntakeAnswers>): { explore: string[]; setAside: string[]; open: string[] } {
  const explore: string[] = [], setAside: string[] = [], open: string[] = [];
  for (const q of INTAKE_QUESTIONS) {
    const answer = answers[q.key];
    if (answer === "no") setAside.push(q.title);
    else if (answer === "yes" || (q.kind === "housing" && answer && answer !== "undecided" && answer !== "ask_later")) explore.push(q.title);
    else open.push(q.title);
  }
  return { explore, setAside, open };
}
