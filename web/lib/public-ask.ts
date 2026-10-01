export type PublicAskCategory =
  | "access-cost" | "overview" | "full-experience" | "getting-started" | "multiple-students"
  | "college-allowance" | "sources" | "task-completion" | "dashboard"
  | "privacy" | "email-coming-soon" | "feedback" | "administrator-support"
  | "product-boundaries";

export type PublicAskAnswer = {
  kind: "faq" | "redirect" | "clarify";
  category?: PublicAskCategory;
  answer: string;
  source?: string;
};

// Local, deterministic product help. No network, visitor-text interpolation, account or research imports.
// Keep these facts aligned with public copy and signed-in controls; they are not live school answers.
const answers: Record<PublicAskCategory, { label: string; answer: string }> = {
  "access-cost": {
    label: "Current access and cost",
    answer: "There is no charge to start using Campus Passage right now. Payments are paused and checkout is disabled. Start Now gives your household the full experience without payment while we gather feedback.",
  },
  overview: {
    label: "What Campus Passage does",
    answer: "Campus Passage organizes college steps into a plan by student, school, and term. It separates family actions from school-side waits and unknowns, with official-source links where findings are verified.",
  },
  "full-experience": {
    label: "The household experience",
    answer: "After email verification, set up your household, add students and schools, and answer intake questions. Then use each student's plan from applications through enrollment and move-in; the sample plan is an illustrative, read-only example before sign-in.",
  },
  "getting-started": {
    label: "Getting started",
    answer: "Select Start Now, verify your email, and set up your household. Add students and schools, then answer a few questions about your priorities to shape each student's plan.",
  },
  "multiple-students": {
    label: "Multiple students",
    answer: "Eligible students sharing a high-school graduation year and admissions cycle can use one household. Each student's schools, intake answers, tasks, and term remain separate; switch students in the signed-in plan.",
  },
  "college-allowance": {
    label: "Colleges in a household plan",
    answer: "A household plan can track up to 10 unique colleges in the current admissions cycle across its eligible students. A school shared by siblings counts once toward that household total; each student's plan stays separate.",
  },
  sources: {
    label: "Official sources and freshness",
    answer: "Verified school findings in a signed-in plan link to official public sources for the applicable term and show when they were checked. Missing, stale, or conflicting details are labeled instead of guessed; the school's current instructions remain authoritative.",
  },
  "task-completion": {
    label: "Family task completion",
    answer: "A family's Completed checkbox records its own completion marker for each task and can be unchecked. It does not confirm that a school received anything or act in a school portal; unanswered or school-side steps remain visible.",
  },
  dashboard: {
    label: "Dashboard and task plan",
    answer: "The signed-in dashboard shows a separate plan for the selected student, with school tasks, what needs attention, and an official destination where one is verified. A missing destination is called out, not invented; your task marker is separate from school confirmation.",
  },
  privacy: {
    label: "Privacy and account controls",
    answer: "Public Ask runs in your browser without saving or sending this question to the signed-in research service. Household plans require sign-in, keep student information separate, and offer account deletion controls; don't enter passwords or sensitive details here.",
  },
  "email-coming-soon": {
    label: "Email Connectivity — Coming Soon",
    answer: "Email Connectivity is Coming Soon and is not needed to start. A future inbox connection would be optional, require separate consent, and include disconnect and connected-mail deletion controls; public Ask cannot read email.",
  },
  feedback: {
    label: "Sharing feedback",
    answer: "After signing in and setting up a household, choose Share feedback on the dashboard. It is privately reviewed, with a separate choice if you want follow-up; this public question box does not submit feedback.",
  },
  "administrator-support": {
    label: "Administrators and help",
    answer: "Administrators review submitted feedback privately; public Ask cannot reach an administrator or inspect your account. For a product issue, sign in and use Share feedback on the dashboard, with an optional follow-up choice. No live support is promised here.",
  },
  "product-boundaries": {
    label: "Your choices and next steps",
    answer: "Campus Passage organizes evidence-backed steps and official links so your family can see what to do next. You stay in control of submissions and decisions, with the school's instructions and your counselor there for guidance.",
  },
};

const redirect = (answer: string): PublicAskAnswer => ({ kind: "redirect", answer });

function outsideScope(q: string): PublicAskAnswer | null {
  // Deny direct research and private/actions requests before attempting FAQ classification.
  // A question about the PRODUCT's capabilities is different from requesting a personal answer.
  const product = /\b(?:campus passage|this (?:app|product|service)|your (?:app|product|service))\b/.test(q);
  const capability = product && /\b(?:does|can|could|will|how does|what does|what can|why doesn't|why can't)\b/.test(q);
  if ((/\b(?:harvard|stanford|rice|baylor|ucla|usc|mit|nyu|ut austin)\b/.test(q) && /\b(?:when|how|what|can|should|deadline|scholarship|aid|require|apply|eligible|portal|admission|tuition|cost|fees?)\b/.test(q)) ||
      (/\b(?:university of [a-z]+|[a-z]+ (?:university|college|institute))\b/.test(q) && /\b(?:when|deadline|scholarship|aid|require|apply|eligible|portal|admission|research|look up|offer|accept|tuition|cost|fees?)\b/.test(q))) {
    return redirect("For a tracked college and student, choose Start Now to enter your Passage. There, Ask about your journey can cite current, certified official findings for the entering term when available; check the school's own instructions for decisions.");
  }
  if (/\b(?:my|our)\b.{0,55}\b(?:household|account|profile|student|child|daughter|son|task|status|application|record|plan)\b/.test(q) &&
      /\b(?:show|check|look up|retrieve|read|tell|what|where|when|update|change|access|see|know|is|are|did|has|have)\b/.test(q) &&
      !/\b(?:how (?:do|can) i (?:start|add|track|switch|mark|share)|can i (?:track|add|have)|what happens to my data|delete my data)\b/.test(q)) {
    return redirect("Your household plan is available after sign-in. Choose Start Now to see your student's schools and tasks in the Passage; this public question stays separate from household records.");
  }
  if ((/\b(?:log\s*in(?:to)?|sign\s*in(?:to)?|open|submit|send|upload|file|complete|change|update|write|draft|pay)\b.{0,60}\b(?:school portal|college portal|application|transcript|deposit|school record|essay|personal statement|form)\b|\b(?:submit|send|upload|write|draft)\b.{0,45}\b(?:my|our)\b.{0,25}\b(?:application|essay|transcript|form)\b/.test(q) && !capability) ||
      /\b(?:you|please)\s+(?:submit|send|upload|write|draft|open|log in|check|change|update)\s+(?:my|our)\b|\b(?:submit|send|upload|write|draft)\s+(?:my|our)\b/.test(q)) {
    return redirect("Choose Start Now to organize your next steps in a signed-in plan. For portal actions, submissions, or application writing, you stay in control and follow the school's own instructions.");
  }
  if (/\b(?:recommend|recommendation|which (?:college|school|university)|best (?:college|school)|where should|should (?:i|we|my|our)|compare (?:colleges|schools)|chances? of (?:admission|getting in))\b/.test(q) && !capability) {
    return redirect("Choose Start Now to organize each student's options in the Passage. For a choice about where to apply or enroll, talk with your counselor and the schools; the decision stays with your family.");
  }
  const researchRequest = /\b(?:when (?:is|does|are)|which|what is|what's|tell me|find|look up)\b.{0,80}\b(?:deadlines?|due dates?|scholarships?|eligib(?:ility|le)|qualif(?:y|ies)|requirements?)\b/.test(q);
  if (/\b(?:deadlines?|due dates?|scholarships?|eligib(?:ility|le)|qualif(?:y|ies)|admission requirements?|requirements? for|financial aid award|fafsa priority|when (?:does|is|do)\b.{0,50}\b(?:open|close|start|due|require))\b/.test(q) && (!capability || researchRequest)) {
    return redirect("For a tracked college's dates, scholarships, or requirements, choose Start Now and ask about your journey inside the Passage. Answers cite current, certified official findings for the student and term when available; confirm eligibility with the school.");
  }
  if (/\b(?:what does|does|when does)\s+(?!(?:campus passage|it|this|your (?:app|product|service))\b)[a-z][a-z\s'-]{1,40}\s+(?:require|offer|accept|open|close|need)\b/.test(q) && !capability) {
    return redirect("Choose Start Now to track the college in your Passage and ask about its tasks there. When certified official evidence supports an answer for your student's term, Ask provides a citation; check the school's current instructions.");
  }
  // A college's tuition or fees are school research, not the cost of this product.
  if (/\b(?:tuition|(?:school|college|university|application|enrollment) (?:fee|fees|costs?|price))\b/.test(q) && !product) {
    return redirect("For a tracked college's tuition or fees, choose Start Now and ask about your journey inside the Passage. Check the school's current official information for the applicable student and term.");
  }
  return null;
}

/** Product-help FAQ only: no live AI, school lookup, personal records, or network calls. */
export function answerPublicQuestion(input: string): PublicAskAnswer {
  const q = input.trim().toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ");
  if (!q) return { kind: "clarify", answer: "What would you like to know about Campus Passage—getting started, your household plan, official sources, privacy, or feedback?" };
  if (q.length > 500) return { kind: "clarify", answer: "Could you shorten your question to 500 characters and ask about one or two Campus Passage topics?" };
  const refusal = outsideScope(q);
  if (refusal) return refusal;

  const matches: PublicAskCategory[] = [];
  const include = (category: PublicAskCategory, pattern: RegExp) => { if (pattern.test(q)) matches.push(category); };
  // Cost is a public product fact, not a private account detail. Keep this in the
  // normal topic classifier so a compound question can receive both answers.
  include("access-cost", /\b(?:costs?|costing|pric(?:e|es|ing)|prcie|prcies|pricng|charg(?:e|es|ed|ing)|payment(?:s)?|paym?ents?|paymnts?|paid|pay|billing|billed|subscriptions?|subcription|subscrption|purchas(?:e|ing)|fees?|free|how much)\b/);
  include("overview", /\b(?:what is (?:campus passage|the app|the product|this (?:app|product|service)|this|it)|what (?:does|can) (?:campus passage|the app|the product|this (?:app|product|service)|this|it) do|what's (?:campus passage|this)|about campus passage|tell me about (?:campus passage|the product|this)|overview|help (?:families|parents)|organize (?:college|the journey)|college journey)\b/);
  include("full-experience", /\b(?:full (?:campus passage )?experience|whole (?:experience|journey)|entire (?:experience|journey)|end.to.end|start to finish|from (?:application|applying|start).{0,30}(?:move.in|finish)|how (?:does (?:campus passage|it|this)|(?:campus passage|it|this)) work|family journey|sample plan)\b/);
  include("getting-started", /\b(?:start now|get started|how (?:do|can) (?:i|we) start|how to (?:start|begin)|what happens (?:after|when) (?:i |we )?(?:start|sign up|select start now)|sign up|sign in|log in|create an account|make an account|register|onboard|set up (?:my|our|a|the) household|begin using|gain access|access (?:the|my) (?:plan|product|experience)|(?:need|require|verify|use) (?:an? |my |our )?email(?: address)?|email (?:address|verification|required))\b/);
  include("multiple-students", /\b(?:multiple students|more than one (?:student|kid|child)|several (?:students|kids|children)|two (?:students|kids|children)|siblings|student profiles|how many students|another student|second student|my (?:kids|children|daughter and son)|switch students|separate students|both (?:of my )?(?:students|kids|children))\b/);
  include("college-allowance", /\b(?:how many (?:colleges|schools)|number of (?:colleges|schools)|college (?:limit|allowance|maximum)|school (?:limit|allowance)|up to (?:10|ten) (?:colleges|schools)|ten unique colleges|add (?:more|another) (?:college|school)|track (?:more than|multiple|several|ten) (?:colleges|schools)|colleges (?:can|may) (?:i|we) (?:add|track))\b/);
  include("sources", /\b(?:sources?|citations?|cite|official|verified|verification|evidence|uncertain|conflict|published|current information|accurate|fresh|stale|recheck|check date|last checked|outdated|up.to.date|where (?:does|do) (?:the |your )?(?:school )?(?:information|info|facts|answers) come from|where do you get (?:your |the )?(?:school )?(?:information|info|facts|answers))\b/);
  include("task-completion", /\b(?:completed|completion|check(?:ed)? off|checkbox|mark(?:ing)? (?:a |my |the )?task|finish(?:ed)? (?:a |my |the )?task|done with (?:a |my |the )?task|undo a task)\b/);
  include("dashboard", /\b(?:dashboard|task list|task status|tasks (?:show|appear|stay|disappear)|what needs attention|whose move|see (?:my|our|the) plan|school tasks|where (?:can|do) (?:i|we) (?:see|find) (?:the |my |our )?(?:plan|tasks))\b/);
  include("privacy", /\b(?:privacy|private|my data|our data|personal data|delete (?:my|our) (?:data|account)|deletion|stored|store (?:my|our)|retention|secure|security|who can see|household access|data sharing|protect (?:my|our)|(?:my|our) (?:info|information)|is (?:my|our) (?:info|information) private|how (?:is|do you keep) (?:my|our) (?:info|information))\b/);
  include("email-coming-soon", /\b(?:email connectivity|connected mail|inbox|coming soon|connect (?:my |an? )?email|email connection|read (?:my|our) email|mail privacy|email consent)\b/);
  include("feedback", /\b(?:feedback|suggestion|report a bug|feature request|share (?:my|our) thoughts|send (?:a )?comment)\b/);
  include("administrator-support", /\b(?:administrator|admin(?:istrator)?s?|human help|contact (?:a|an|the|your) (?:person|team|admin|support)|customer support|support team|get support|help desk|trouble with (?:my|our) account|speak to (?:someone|a person))\b/);
  include("product-boundaries", /\b(?:portal password|school portal|portal|submit|apply for me|application for me|counselor|replace|limitations|boundaries|recommendations?|can't|cannot|doesn't|don't do|what (?:won't|can't) (?:it|campus passage) do)\b/);

  if (!matches.length) {
    if (/\b(?:college|school|research)\b/.test(q)) return { kind: "clarify", answer: "Would you like to know how many colleges you can track or how official-source research works? For a tracked school's tasks, choose Start Now to ask inside your Passage." };
    return { kind: "clarify", answer: "Could you ask about a Campus Passage topic—getting started, students and colleges, the task dashboard, sources, privacy, or feedback?" };
  }
  // At most three directly requested topics; no single all-purpose overview for unmatched input.
  const selected = matches.slice(0, 3);
  return { kind: "faq", category: selected[0], answer: selected.map(c => answers[c].answer).join("\n\n"),
    source: selected.map(c => `Public Campus Passage FAQ · ${answers[c].label}`).join("; ") };
}
