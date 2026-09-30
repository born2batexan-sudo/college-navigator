export type PublicAskCategory =
  | "how-it-works"
  | "getting-started"
  | "privacy"
  | "sources"
  | "product-boundaries"
  | "multiple-students"
  | "email-coming-soon";

export type PublicAskAnswer = {
  kind: "faq" | "redirect";
  category?: PublicAskCategory;
  answer: string;
  source?: string;
};

const REDIRECT_ANSWER =
  "I can only answer general questions about Campus Passage. College- or school-specific research, deadlines, scholarships, eligibility, personalized advice, portal actions, payments, and questions about a household's records belong in the signed-in household experience. Choose Start Now to get started.";

const answers: Record<PublicAskCategory, { label: string; answer: string }> = {
  "how-it-works": {
    label: "How Campus Passage works",
    answer:
      "Campus Passage organizes college-journey information into a plan by student, school, and term. It highlights next steps and who owns them, and links verified findings to official public sources. Unpublished or uncertain information stays labeled instead of being guessed.",
  },
  "getting-started": {
    label: "Getting started",
    answer:
      "Choose Start Now, verify your email, and set up your household. The school-specific Ask experience is separate: it is available only after sign-in and household onboarding, and answers from verified official sources for the student's term.",
  },
  privacy: {
    label: "Privacy and data controls",
    answer:
      "Campus Passage keeps each household's plan organized by student, school, and term. Current privacy and deletion controls govern household data. Do not include passwords or sensitive personal, financial, medical, or application information in a question.",
  },
  sources: {
    label: "Sources and citations",
    answer:
      "Campus Passage links verified findings to official school sources. Signed-in school-specific Ask quotes current, certified official sources for the selected student's term and shows the citation and check date. If evidence is missing, stale, or conflicting, it abstains; the school's own instructions remain authoritative.",
  },
  "product-boundaries": {
    label: "What Campus Passage does not do",
    answer:
      "Campus Passage organizes information; it does not apply to a school, complete or submit forms, sign into school portals, make admission or eligibility decisions, decide awards, initiate payments, move funds, or change school records. The school and other official providers remain in control.",
  },
  "multiple-students": {
    label: "Support for multiple students",
    answer:
      "A household plan can support eligible students in the same high-school graduation year and admissions cycle, with up to 10 unique colleges for the current cycle. Each student's schools, tasks, and term stay separate.",
  },
  "email-coming-soon": {
    label: "Email Connectivity — Coming Soon",
    answer:
      "Email Connectivity is Coming Soon and is not part of the current Ask experience. Any future email connection would be optional, require separate consent, and include controls to disconnect and delete connected-mail data.",
  },
};

const isOutOfScope = (question: string): boolean => {
  // These requests can easily be mistaken for a public FAQ. Fail closed rather
  // than answering anything about a student's actual school research or outcome.
  if (
    /\b(deadlines?|due dates?|scholarships?|eligib(?:ility|le)|qualif(?:y|ication)|personal(?:ized)? advice|recommend(?:ation|ations)?|chances? of admission|admission chances|which college|compare (?:colleges|schools|universities)|college-specific|school-specific|application essay|personal statement|payments?|pay|purchase|transaction)\b/i.test(
      question,
    )
  ) {
    return true;
  }

  // Reject institution-like proper names even if the question avoids usual
  // research keywords (for example, "What does Harvard require?").
  const withoutProductNames = question
    .replace(/\b(?:Campus Passage|Ask Campus Passage|Email Connectivity|Start Now|Coming Soon)\b/g, " ")
    .replace(/^\s*[A-Z][a-z]+\b/, " ")
    .replace(/\bI\b/g, " ");
  const namedInstitution = /\b(?:[A-Z]{2,}|[A-Z][a-z]+)\b/.test(withoutProductNames) &&
    !/\b(?:Fall|Spring|Summer|Winter)\b/.test(withoutProductNames);
  if (namedInstitution) return true;

  // Disallow commands to operate on portals, applications, accounts, payments,
  // or stored household records; general questions about product boundaries
  // are handled below and remain answerable.
  if (
    /^\s*(?:please\s+)?(?:log\s*in|sign\s*in|open|check|access|submit|apply|pay|purchase|change|update|complete|send)\b/i.test(
      question,
    ) ||
    /\b(?:please|i need you to|go ahead and)\s+(?:log\s*in|sign\s*in|open|check|access|submit|apply|pay|purchase|change|update|complete|send)\b/i.test(
      question,
    ) ||
    /\b(?:log\s*in|sign\s*in|open|check|access|submit|change|update)\b.{0,35}\b(?:school|student|college)?\s*portal\b/i.test(question) ||
    /\b(?:show|list|retrieve|look up|read|display)\b.{0,50}\b(?:my|our)\b.{0,35}\b(?:student|household|account|profile|record|task|plan)\b/i.test(
      question,
    ) ||
    /\bwhat do you know about (?:my|our)\s+(?:student|child|daughter|son|household|account)\b/i.test(
      question,
    ) ||
    /\b(?:my|our)\s+(?:daughter|son|child|student)'s\s+(?:deadline|scholarship|eligibility|application|school|record|plan)\b/i.test(
      question,
    ) ||
    /\b(?:write|draft|review|edit)\b.{0,40}\b(?:essay|application answer|personal statement)\b/i.test(
      question,
    )
  ) {
    return true;
  }

  return false;
};

/**
 * Answers a deliberately small, FAQ-grounded public scope. There is no model,
 * network call, school lookup, or access to household records in this function.
 */
export function answerPublicQuestion(input: string): PublicAskAnswer {
  const question = input.trim().replace(/\s+/g, " ");
  if (!question || question.length > 500 || isOutOfScope(question)) {
    return { kind: "redirect", answer: REDIRECT_ANSWER };
  }

  const normalized = question.toLowerCase();
  let category: PublicAskCategory | undefined;

  if (/\b(?:multiple students|more than one student|several students|siblings|two students|student profiles|how many students|add another student)\b/.test(normalized)) {
    category = "multiple-students";
  } else if (/\b(?:email connectivity|connected mail|inbox|email|coming soon)\b/.test(normalized)) {
    category = "email-coming-soon";
  } else if (/\b(?:source|citation|cite|official|verified|verification|evidence)\b/.test(normalized)) {
    category = "sources";
  } else if (/\b(?:privacy|private|data|consent|delete|deletion|stored|store|retention)\b/.test(normalized)) {
    category = "privacy";
  } else if (/\b(?:start now|get started|start|sign up|sign in|log in|create an account|new family|register|access campus passage)\b/.test(normalized)) {
    category = "getting-started";
  } else if (/\b(?:portal password|school portal login|portal|submit|apply|application|counselor|replace|change a school record|what can(?:not|'t) campus passage do)\b/.test(normalized)) {
    category = "product-boundaries";
  } else if (/\b(?:how does campus passage work|how does it work|what does campus passage do|what is campus passage|how do you organize|how it works)\b/.test(normalized)) {
    category = "how-it-works";
  }

  if (!category) return { kind: "redirect", answer: REDIRECT_ANSWER };
  return {
    kind: "faq",
    category,
    answer: answers[category].answer,
    source: `Public Campus Passage FAQ · ${answers[category].label}`,
  };
}
