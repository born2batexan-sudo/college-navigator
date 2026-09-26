import { actionsFor, demoStudents, horizonFor, studentById, type DemoActionRow, type DemoSelection, type DemoStudentId } from "./landing-demo";

// Fixed, fictional answers in a read-only browser illustration. No account or school data is read or saved.
export type LivingPlan = "campus" | "offCampus" | "commute" | "undecided";
export type TransportPlan = "car" | "other" | "undecided";
export type IntakeAnswers = {
  living: LivingPlan;
  transport: TransportPlan;
  aid: boolean;
  schoolScholarships: boolean;
  outsideScholarships: boolean;
  educationSavings: boolean;
  access: boolean;
  studentLife: boolean;
  visits: boolean;
  orientation: boolean;
  familyMoveIn: boolean;
};
export type IntakeByStudent = Record<DemoStudentId, IntakeAnswers>;
export type PlanItem = DemoActionRow & { whyShown: string; exception?: boolean };
export type SetAsideItem = { student: DemoStudentId; title: string; reason: string };

export const initialIntake: IntakeByStudent = {
  priya: { living: "campus", transport: "car", aid: true, schoolScholarships: true, outsideScholarships: true, educationSavings: true, access: false, studentLife: false, visits: false, orientation: true, familyMoveIn: true },
  mateo: { living: "commute", transport: "other", aid: true, schoolScholarships: false, outsideScholarships: false, educationSavings: false, access: true, studentLife: false, visits: true, orientation: false, familyMoveIn: false },
};

export function updateStudentAnswer<K extends keyof IntakeAnswers>(answers: IntakeByStudent, student: DemoStudentId, key: K, value: IntakeAnswers[K]): IntakeByStudent {
  return { ...answers, [student]: { ...answers[student], [key]: value } };
}

function exampleRow(student: DemoStudentId, title: string, detail: string, kind: string, school: string): DemoActionRow {
  return { student, school, kind, title, detail, stake: "Use the official source to check what applies before making a decision.", status: "For planning · no date assumed", tone: "aware", queueTag: "For planning", source: `Fictional source example — ${school} · illustrative ${kind.toLowerCase()} page · Fall 2027 · no live page reviewed` };
}

type OptionalStep = { row: DemoActionRow; show: boolean; whyShown: string; whyAside: string };
function optionalSteps(student: DemoStudentId, a: IntakeAnswers): OptionalStep[] {
  const school = studentById(student).schools[0];
  const add = (title: string, detail: string, kind: string, show: boolean, whyShown: string, whyAside: string, at = school): OptionalStep => ({ row: exampleRow(student, title, detail, kind, at), show, whyShown, whyAside });
  return [
    add("Compare aid requirements", "Check the school's own aid steps and timing before relying on an offer.", "Financial aid", a.aid, "Shown because financial aid is part of this student's plan.", "Set aside because financial aid is not selected; school requirements still need independent checking."),
    add("Review school scholarship routes", "Check whether the school considers applicants automatically or asks for a separate submission.", "School scholarships", a.schoolScholarships, "Shown because school scholarships are selected.", "Set aside because school scholarships are not selected."),
    add("Look for community scholarships", "Check sponsor instructions; a listing is not an eligibility or award decision.", "Outside scholarships", a.outsideScholarships && student !== "priya", "Shown because outside scholarships are selected.", "Set aside because outside scholarships are not selected.", "Fictional community sponsor"),
    add("Plan a 529 or prepaid-plan question", "Ask the plan administrator and school billing office about their own payment instructions; this example makes no qualified-expense determination.", "Education savings", a.educationSavings, "Shown because 529 or prepaid funds may be used.", "Set aside because 529 or prepaid use is not selected."),
    add("Explore campus housing choices", "Review the school's housing process separately from admission.", "Housing", a.living === "campus" && student !== "priya", "Shown because on-campus residence is selected.", "Set aside because on-campus residence is not selected; any school requirement still takes priority."),
    add("Consider off-campus housing questions", "Check local and school guidance before committing to a lease.", "Housing", a.living === "offCampus", "Shown because off-campus housing is selected.", "Set aside because off-campus housing is not selected."),
    add("Plan a commuting route", "Check travel time and school transportation guidance.", "Transportation", a.living === "commute", "Shown because commuting is selected.", "Set aside because commuting is not selected."),
    add("Keep the living plan open", "Compare residence, off-campus, and commute options without assuming a deadline.", "Housing", a.living === "undecided", "Shown because the living plan is undecided.", "Set aside because a living plan was chosen."),
    add("Check student parking options", "Review permit eligibility and published dates before bringing a car.", "Transportation", a.transport === "car", "Shown because bringing a car is selected.", "Set aside because bringing a car is not selected."),
    add("Explore travel without a car", "Review transit, shuttle, and arrival options relevant to this campus.", "Transportation", a.transport === "other", "Shown because transit or other transportation is selected.", "Set aside because transit or other transportation is not selected."),
    add("Ask about accommodations", "Contact the school's accessibility office about its process if useful.", "Access", a.access && student !== "mateo", "Shown because access or accommodations are selected.", "Set aside because accommodations information is not selected."),
    add("Explore student organizations", "Check official student-life information and any recruitment timing if relevant.", "Student life", a.studentLife, "Shown because Greek or student life is selected.", "Set aside because Greek or student life is not selected."),
    add("Consider a campus visit", "Use the school's own page for visits and registration.", "Campus visit", a.visits && student !== "mateo", "Shown because campus visits are selected.", "Set aside because campus visits are not selected."),
    add("Watch for orientation information", "Check who can register and when the school publishes details.", "Orientation", a.orientation, "Shown because orientation planning is selected.", "Set aside because orientation planning is not selected."),
    add("Plan family and move-in logistics", "Review family access and move-in guidance once the school publishes it.", "Family and move-in", a.familyMoveIn, "Shown because family or move-in planning is selected.", "Set aside because family or move-in planning is not selected."),
  ];
}

function baseRelevance(row: DemoActionRow, a: IntakeAnswers): { show: boolean; why: string; aside: string } {
  switch (row.title) {
    case "Housing date not posted yet": return { show: true, why: a.living === "campus" ? "Shown for an on-campus living plan; the date remains unknown." : "The illustrated first-year residence rule keeps this unknown housing date visible even when another living plan is selected.", aside: "" };
    case "A regional scholarship is posted": return { show: a.outsideScholarships, why: "Shown for outside-scholarship awareness; the sponsor decides eligibility.", aside: "Set aside because outside scholarships are not selected; this is not a required school step." };
    case "Register for the campus-visit day": return { show: a.visits, why: "Shown because campus visits are selected.", aside: "Set aside because campus visits are not selected; this visit is optional in the illustration." };
    case "Accommodations office contact confirmed": return { show: a.access, why: "Shown because access or accommodations are selected.", aside: "Set aside because accommodations information is not selected; required access or compliance steps would remain visible." };
    default: return { show: true, why: "Shown because this student has a school step or status to review regardless of these preferences.", aside: "" };
  }
}

export function personalizedPlan(selection: DemoSelection, intake: IntakeByStudent) {
  const students = selection === "household" ? demoStudents : [studentById(selection)];
  const surfaced: PlanItem[] = [];
  const setAside: SetAsideItem[] = [];
  for (const student of students) {
    const a = intake[student.id];
    for (const row of actionsFor(student.id)) {
      const rule = baseRelevance(row, a);
      if (rule.show) surfaced.push({ ...row, whyShown: rule.why });
      else setAside.push({ student: student.id, title: row.title, reason: rule.aside });
    }
    // This is an illustrated school requirement, not an inferred one. It is never preference-filtered.
    if (student.id === "priya") {
      const conflict = a.living !== "campus";
      const required: PlanItem = {
        ...exampleRow(student.id, "Review first-year residence requirement", "In this fictional example, North Valley's first-year residence rule applies. Check the school's own instructions and exception process before planning a commute or other housing.", "School requirement", "North Valley University"),
        status: "School requirement · check official policy",
        whyShown: conflict ? `The ${a.living === "undecided" ? "living plan is undecided" : "selected living plan differs from the school's illustrated first-year residence rule"}. A school requirement stays visible even when a preference would filter out housing items.` : "Shown because the illustrated school requires first-year residence, even when other housing information is optional.",
        exception: conflict,
      };
      if (conflict) surfaced.unshift(required);
      else surfaced.push(required);
    }
    for (const step of optionalSteps(student.id, a)) {
      if (step.show) surfaced.push({ ...step.row, whyShown: step.whyShown });
      else if (!(step.row.title === "Look for community scholarships" && student.id === "priya") && !(step.row.title === "Explore campus housing choices" && student.id === "priya") && !(step.row.title === "Ask about accommodations" && student.id === "mateo") && !(step.row.title === "Consider a campus visit" && student.id === "mateo")) {
        setAside.push({ student: student.id, title: step.row.title, reason: step.whyAside });
      }
    }
  }
  const horizon = horizonFor(selection).filter((event) => {
    const a = intake[event.student];
    const filtered = event.label === "Aid-offer portal" && !a.aid ? "financial aid is not selected" :
      event.label === "Campus-visit registration" && !a.visits ? "campus visits are not selected" :
      event.label === "Accessibility conversation" && !a.access ? "access or accommodations are not selected" : "";
    if (filtered) setAside.push({ student: event.student, title: event.label, reason: `Set aside because ${filtered}; this is optional planning context, not a school requirement.` });
    return !filtered;
  });
  return { surfaced, setAside, horizon, counts: {
    dueThisWeek: surfaced.filter((row) => row.tone === "action").length,
    waiting: surfaced.filter((row) => row.tone === "waiting").length,
    complete: surfaced.filter((row) => row.tone === "complete").length,
    awareness: surfaced.filter((row) => row.tone === "aware").length,
  } };
}
