// Fictional two-applicant household illustration used only by the public
// interactive demo on the marketing page (components/CampusPassageLanding.tsx)
// and its tests. The product model is not capped at two: a qualifying
// purchaser may include two or more students who share a graduation year and
// admissions cycle. Every name, school, date and source below is a
// representative example. It never reads, writes, or represents a real
// household, school, or source.

export type DemoTone = "action" | "waiting" | "complete" | "aware";
export type DemoStudentId = "priya" | "mateo";
export type DemoSelection = DemoStudentId | "household";

export type DemoActionRow = {
  student: DemoStudentId;
  school: string;
  kind: string;
  title: string;
  detail: string;
  status: string;
  tone: DemoTone;
  queueTag: string;
  source: string;
};

export type DemoHorizonEvent = {
  student: DemoStudentId;
  label: string;
  state: "Opens" | "Due" | "Window" | "Response deadline" | "Not yet published";
  date?: string;
  note: string;
};

export type DemoPreferenceKey = "car" | "housing" | "greekLife" | "accommodations";

export type DemoStudent = {
  id: DemoStudentId;
  name: string;
  graduationYear: 2027;
  stage: string;
  term: "Fall 2027";
  pathway: string;
  priority: string;
  color: "coral" | "teal";
  schools: string[];
  preferences: Record<DemoPreferenceKey, boolean>;
};

export type DemoHiddenWork = {
  student: DemoStudentId;
  preference: DemoPreferenceKey;
  title: string;
  hideReason: string;
};

export const demoStudents: DemoStudent[] = [
  {
    id: "priya",
    name: "Priya Alvarez",
    graduationYear: 2027,
    stage: "Applicant · materials in progress",
    term: "Fall 2027",
    pathway: "Comparing admissions and aid paths",
    priority: "Official document and aid timing",
    color: "coral",
    schools: ["Cedar Hill College", "North Valley University", "Lakeview Institute"],
    preferences: { car: true, housing: true, greekLife: false, accommodations: false },
  },
  {
    id: "mateo",
    name: "Mateo Alvarez",
    graduationYear: 2027,
    stage: "Applicant · pathway questions open",
    term: "Fall 2027",
    pathway: "Exploring visit and accessibility paths",
    priority: "Campus fit and accommodations contact",
    color: "teal",
    schools: ["Riverbend State University", "Pinecrest Polytechnic"],
    preferences: { car: false, housing: false, greekLife: false, accommodations: true },
  },
];

export const demoActions: DemoActionRow[] = [
  { student: "priya", school: "Cedar Hill College", kind: "Family action", title: "Send the official transcript", detail: "Ask the school to send it through its own official process by October 12 (sample date).", status: "Due: October 12", tone: "action", queueTag: "This week", source: "Cedar Hill College · official admissions page · Fall 2027 · reviewed sample deadline: October 12" },
  { student: "priya", school: "North Valley University", kind: "School update", title: "Housing date not posted yet", detail: "No date is invented when a school has not published one.", status: "Waiting on school", tone: "waiting", queueTag: "Waiting", source: "North Valley University · official housing page · Fall 2027 · no date shown because none is published" },
  { student: "priya", school: "Lakeview Institute", kind: "Status check", title: "Enrollment deposit received", detail: "The school's status is shown separately from Priya's own submission.", status: "Complete: September 26", tone: "complete", queueTag: "Complete", source: "Lakeview Institute · official enrollment page · Fall 2027 · reviewed sample date: September 26" },
  { student: "priya", school: "Cedar Hill College", kind: "Aid & scholarship awareness", title: "A regional scholarship is posted", detail: "Sponsor, link, and November 8 deadline are shown as published. The sponsor alone decides eligibility and awards.", status: "Notice: review by November 8", tone: "aware", queueTag: "Notice", source: "Cedar Hill College region · named community-foundation listing · Fall 2027 · sample deadline November 8 · awareness only, not an eligibility determination" },
  { student: "mateo", school: "Pinecrest Polytechnic", kind: "Family action", title: "Register for the campus-visit day", detail: "Reserve the published October 20 visit slot directly on the school's own page.", status: "Due: October 20", tone: "action", queueTag: "This week", source: "Pinecrest Polytechnic · official visit page · Fall 2027 · reviewed sample deadline: October 20" },
  { student: "mateo", school: "Riverbend State University", kind: "School update", title: "Test-optional policy not posted for this cycle", detail: "No policy is assumed until the school publishes one.", status: "Waiting on school", tone: "waiting", queueTag: "Waiting", source: "Riverbend State University · official admissions page · Fall 2027 · no policy shown because none is published" },
  { student: "mateo", school: "Pinecrest Polytechnic", kind: "Accessibility awareness", title: "Accommodations office contact confirmed", detail: "The family can see the official contact, published September 30, and decide whether to reach out.", status: "Complete: September 30", tone: "complete", queueTag: "Complete", source: "Pinecrest Polytechnic · official accessibility page · Fall 2027 · reviewed sample date: September 30" },
];

export const demoHorizon: DemoHorizonEvent[] = [
  { student: "priya", label: "Aid-offer portal", state: "Opens", date: "January 15", note: "From the Cedar Hill College aid fact sheet." },
  { student: "priya", label: "Enrollment response", state: "Response deadline", date: "May 1", note: "Example response deadline, shown once a school publishes one." },
  { student: "priya", label: "Fall billing statement", state: "Not yet published", note: "No date is invented when a source has not published one." },
  { student: "mateo", label: "Campus-visit registration", state: "Window", date: "October 20–27", note: "Example open registration window for this Fall 2027 applicant." },
  { student: "mateo", label: "Accessibility conversation", state: "Due", date: "November 14", note: "Example family planning date for a question to bring to the official office." },
  { student: "mateo", label: "Test-optional policy update", state: "Not yet published", note: "Held as an honest unknown, never estimated." },
];

export const demoHiddenWork: DemoHiddenWork[] = [
  { student: "priya", preference: "greekLife", title: "Greek-life orientation note", hideReason: "Hidden because Priya is marked as not interested in Greek life." },
  { student: "priya", preference: "accommodations", title: "Accommodations office contact", hideReason: "Hidden because Priya has not asked to see accommodations information." },
  { student: "mateo", preference: "car", title: "Student parking permit window", hideReason: "Hidden because Mateo is not yet bringing a car to campus." },
  { student: "mateo", preference: "housing", title: "Campus housing preference form", hideReason: "Hidden because Mateo is not choosing housing at this planning stage." },
];

export function actionsFor(selection: DemoSelection): DemoActionRow[] {
  return selection === "household" ? demoActions : demoActions.filter((row) => row.student === selection);
}

export function horizonFor(selection: DemoSelection): DemoHorizonEvent[] {
  return selection === "household" ? demoHorizon : demoHorizon.filter((event) => event.student === selection);
}

export function hiddenWorkFor(selection: DemoSelection): DemoHiddenWork[] {
  return selection === "household" ? demoHiddenWork : demoHiddenWork.filter((item) => item.student === selection);
}

export function studentById(id: DemoStudentId): DemoStudent {
  const student = demoStudents.find((entry) => entry.id === id);
  if (!student) throw new Error(`Unknown demo student: ${id}`);
  return student;
}

export function summarizeSelection(selection: DemoSelection) {
  const rows = actionsFor(selection);
  return {
    dueThisWeek: rows.filter((row) => row.tone === "action").length,
    waiting: rows.filter((row) => row.tone === "waiting").length,
    complete: rows.filter((row) => row.tone === "complete").length,
    awareness: rows.filter((row) => row.tone === "aware").length,
  };
}
