export type PublicAskCategory =
  | "overview"
  | "full-experience"
  | "getting-started"
  | "privacy"
  | "sources"
  | "product-boundaries"
  | "multiple-students"
  | "feedback"
  | "email-coming-soon";

export type PublicAskAnswer = {
  kind: "faq" | "redirect";
  category?: PublicAskCategory;
  answer: string;
  source?: string;
};

const REDIRECT_ANSWER =
  "I can only explain Campus Passage generally here. I cannot look up a school, deadlines, eligibility, scholarships, personalized advice, portal actions, or your household records in public Ask. Choose Start Now to set up a household, or sign in for school-specific Ask; always check the school's official instructions.";

// Public product copy only. Never import research, request, session, or household modules here.
const answers: Record<PublicAskCategory, { label: string; answer: string }> = {
  overview: {
    label: "What Campus Passage does",
    answer: "Campus Passage organizes the college journey into a plan for each student, school, and term. It shows verified dates and next steps, whose move each is, and links findings to official public sources. Missing, conflicting, or unpublished details stay labeled rather than guessed.",
  },
  "full-experience": {
    label: "The household experience",
    answer: "Start with a verified email and a household plan. Add eligible students and schools, share priorities such as housing or aid, and follow separate student, school, and term plans through applications, enrollment, and move-in planning. The plan distinguishes family actions, school-side waits, and unknowns; the sample plan lets you explore a fictional example before signing in.",
  },
  "getting-started": {
    label: "Getting started",
    answer: "Choose Start Now, verify your email, and set up your household. Add your students and schools, then answer a few intake questions to tailor the plan. School-specific Ask is separate and requires sign-in and household onboarding.",
  },
  privacy: {
    label: "Privacy and access",
    answer: "Public Ask has no access to a household's records and does not send your question to the signed-in research service. Household plans and school-specific Ask require sign-in; student, school, and term information stays distinct. Account privacy and deletion controls are available in the signed-in experience. Do not enter passwords or sensitive personal information here.",
  },
  sources: {
    label: "Official sources and uncertainty",
    answer: "Verified findings in a signed-in plan link to official public school sources for the applicable term, with citations and check dates. Missing, stale, or conflicting evidence is labeled rather than treated as a fact. School instructions and portals remain authoritative.",
  },
  "product-boundaries": {
    label: "Product boundaries",
    answer: "Campus Passage organizes information; it does not apply to colleges, complete or submit forms, sign into school portals, decide admission, eligibility or awards, initiate payments, move funds, or change school records. It does not replace a counselor or the school's official instructions.",
  },
  "multiple-students": {
    label: "Multiple students",
    answer: "A qualifying household can include two or more eligible students who share the same high-school graduation year and admissions cycle. The current household plan includes up to 10 unique colleges. Each student's schools, tasks, preferences, and term stay separate.",
  },
  feedback: {
    label: "Sharing feedback",
    answer: "After signing in and setting up a household, choose Share feedback on the dashboard to send product feedback for private review. Public Ask does not collect feedback or save the question you type here.",
  },
  "email-coming-soon": {
    label: "Email Connectivity — Coming Soon",
    answer: "Email Connectivity is Coming Soon, not part of public Ask or the core start flow. A future connection would be optional, require separate consent, and offer controls to disconnect and delete connected-mail data. No inbox access is needed to start.",
  },
};

function isOutOfScope(question: string): boolean {
  // Deny research, eligibility, advice, actions, and requests for stored records
  // before any public FAQ matching. Fail closed for named institutions and dates.
  if (/\b(?:pay|purchase|price|pricing|cost|transaction)\b/i.test(question)) return true;
  if (/\b(?:deadlines?|due dates?|scholarships?|eligib(?:ility|le)|qualif(?:y|ication)|financial aid award|admission chances|chance(?:s)? of (?:admission|getting in)|which (?:college|school|university)|compare (?:colleges|schools|universities)|college-specific|school-specific|essay|personal statement|recommend(?:ation|ations)?|should (?:i|we|my)|best (?:college|school))\b/i.test(question)) {
    // General FAQ wording about the product's boundaries is still useful.
    if (!/^\s*(?:what (?:does|can|can't|cannot|doesn't) campus passage|does campus passage|can campus passage)\b/i.test(question) || !/\b(?:do|handle|offer|replace|submit|apply|decide|look up|research|cost|price|pay)\b/i.test(question)) return true;
  }
  if (/\b(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}[/-]\d{1,2}[/-]\d{1,2}|fall|spring|summer|winter)\b.{0,25}\b(?:deadline|due|apply|require)/i.test(question)) return true;
  if (/\b(?:at|from|for)\s+(?:[A-Z][\w-]*\s+){0,4}(?:University|College|Institute)\b|\b(?:University|College|Institute)\s+of\s+[A-Z]/.test(question)) return true;
  const withoutProductNames = question.replace(/\b(?:campus passage|ask campus passage|email connectivity|start now|coming soon|share feedback)\b/gi, " ").replace(/^\s*(?:what|how|why|where|when|does|do|can|could|is|are|tell|please|i)\b/i, " ");
  if (/\b(?:[A-Z]{2,}|[A-Z][a-z]+)\b/.test(withoutProductNames)) return true;
  if (/\b(?:what do you know about|tell me about|show|list|retrieve|look up|read|display|check|what is|what's|update|change)\b.{0,65}\b(?:my|our)\b.{0,40}\b(?:student|child|daughter|son|household|record|profile|task|plan|status|application)\b/i.test(question)) return true;
  if (/\b(?:what does|does|when does)\s+(?!campus passage\b|it\b|this\b|the product\b|your product\b)[a-z]+(?:\s+[a-z]+){0,3}\s+(?:require|offer|accept|start|open|close|need)\b/i.test(question)) return true;
  if (/\b(?:my|our)\b.{0,35}\b(?:deadline|scholarship|eligibility|application status|admission|financial aid)\b/i.test(question)) return true;
  if (/\b(?:log\s*in|sign\s*in|open|check|access|submit|apply|pay|purchase|change|update|complete|send|write|draft)\b.{0,55}\b(?:portal|application|form|account|school record|essay|deposit|payment|transcript)\b/i.test(question)) return true;
  if (/^\s*(?:please\s+)?(?:show|list|retrieve|look up|read|display|check|open|submit|apply|pay|purchase|change|update|complete|send|write|draft)\b/i.test(question)) return true;
  return false;
}

/** Offline, deterministic answers grounded only in the public product FAQ. */
export function answerPublicQuestion(input: string): PublicAskAnswer {
  const question = input.trim().replace(/\s+/g, " ");
  if (!question || question.length > 500 || isOutOfScope(question)) return { kind: "redirect", answer: REDIRECT_ANSWER };

  const q = question.toLowerCase();
  const categories: PublicAskCategory[] = [];
  const include = (category: PublicAskCategory, pattern: RegExp) => { if (pattern.test(q)) categories.push(category); };
  include("overview", /\b(?:what (?:is|does) (?:campus passage|it)|what (?:can|will) (?:campus passage|it) do|about campus passage|tell me (?:about|more)|overview|help families|help parents|organize|track|college journey)\b/);
  include("full-experience", /\b(?:full experience|whole experience|entire experience|end.to.end|from start to finish|how (?:does campus passage|does it|it) work|how campus passage works|how it works|steps|sample plan|through move.in|family journey)\b/);
  include("getting-started", /\b(?:start now|get started|start|sign up|sign in|log in|create an account|new family|register|onboard|set up|access campus passage)\b/);
  include("privacy", /\b(?:privacy|private|data|consent|delete|deletion|stored|store|retention|secure|security|who can see|household access)\b/);
  include("sources", /\b(?:source|citation|cite|official|verified|verification|evidence|uncertain|conflict|published|current|accurate)\b/);
  include("product-boundaries", /\b(?:portal password|school portal|portal|submit|apply|application|counselor|replace|limitations|boundaries|can't|cannot|doesn't|don't do)\b/);
  include("multiple-students", /\b(?:multiple students|more than one student|several students|siblings|two students|student profiles|how many students|add another student|my (?:kids|children|daughter and son))\b/);
  include("feedback", /\b(?:feedback|suggestion|report a bug|feature request)\b/);
  include("email-coming-soon", /\b(?:email connectivity|connected mail|inbox|coming soon|connect (?:my |an? )?email|email connection)\b/);

  // Vague safe questions get a useful overview, not an empty/opaque refusal.
  if (categories.length === 0) categories.push("overview");
  const selected = categories.slice(0, 3);
  return {
    kind: "faq",
    category: selected[0],
    answer: selected.map((category) => answers[category].answer).join("\n\n"),
    source: selected.map((category) => `Public Campus Passage FAQ · ${answers[category].label}`).join("; "),
  };
}
