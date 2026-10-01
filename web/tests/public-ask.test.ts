import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { answerPublicQuestion, type PublicAskCategory } from "../lib/public-ask";
import { isPublicPath } from "../lib/auth/env";
import { isApplicationProtectedPath } from "../lib/auth/protected-routes";

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const publicPage = read("../app/ask/page.tsx");
const publicForm = read("../app/ask/PublicAskForm.tsx");
const publicLibrary = read("../lib/public-ask.ts");
const researchPage = read("../app/ask/research/page.tsx");
const researchForm = read("../app/ask/research/AskForm.tsx");
const authenticatedApi = read("../app/api/ask/route.ts");
const homepage = read("../components/CampusPassageLanding.tsx");
const navigation = read("../components/HeaderNav.tsx");
const dashboard = read("../app/dashboard/page.tsx");

const matrix: readonly [string, PublicAskCategory, RegExp][] = [
  ["what does this cost?", "access-cost", /no charge to start using Campus Passage right now.*payments are paused.*checkout is disabled.*full experience without payment while we gather feedback/i],
  ["What does Campus Passage do?", "overview", /organizes college steps.*student, school, and term/i],
  ["What is the full experience from start to finish?", "full-experience", /sample plan.*illustrative, read-only/i],
  ["How do I get started?", "getting-started", /Start Now, verify your email/i],
  ["Can I track multiple students?", "multiple-students", /graduation year.*separate/i],
  ["How many colleges can we add?", "college-allowance", /up to 10 unique colleges/i],
  ["How do official citations stay fresh?", "sources", /official public sources.*when they were checked/i],
  ["Does a Completed checkbox tell the school I finished?", "task-completion", /does not confirm that a school received/i],
  ["What appears on the dashboard?", "dashboard", /selected student.*school tasks/i],
  ["How private is my data?", "privacy", /runs in your browser.*without saving/i],
  ["Can you connect my inbox?", "email-coming-soon", /Coming Soon.*optional/i],
  ["Where can I send feedback?", "feedback", /Share feedback on the dashboard/i],
  ["Can I reach an administrator for help?", "administrator-support", /No live support is promised/i],
  ["Can it replace my counselor?", "product-boundaries", /You stay in control of submissions and decisions/i],
];
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

describe("public Ask Campus Passage", () => {
  it("keeps only the public product FAQ anonymous; research and records remain authenticated", () => {
    assert.equal(isPublicPath("/ask"), true);
    assert.equal(isPublicPath("/ask/research"), false);
    assert.equal(isApplicationProtectedPath("/ask"), false);
    assert.equal(isApplicationProtectedPath("/ask/research"), true);
    assert.match(publicPage, /PublicAskForm/);
    assert.doesNotMatch(publicPage, /requireOnboardedHousehold|import AskForm|api\/ask/);
    assert.match(researchPage, /requireOnboardedHousehold\(/);
    assert.match(researchForm, /fetch\('\/api\/ask'/);
    assert.match(authenticatedApi, /authorizedApiHousehold\(/);
  });

  it("leads with what public Ask offers and distinguishes the signed-in, cited student journey", () => {
    assert.match(publicPage, /<h1[^>]*>Ask about Campus Passage<\/h1>/);
    assert.match(publicPage, /Ask about getting started, building a household plan, official sources, privacy/);
    assert.match(publicPage, /Inside your signed-in Passage, Ask about your journey draws on certified official sources and citations for your tracked student, college, and term when available/);
    assert.match(publicPage, /href="\/login\?next=%2Fask%2Fresearch"[^>]*>Sign in to ask about your journey/);
    assert.match(publicForm, /What would you like to know about Campus Passage\?/);
    assert.match(publicForm, /question stays in this browser and is not saved/);
    assert.match(researchPage, /requireOnboardedHousehold\(\)/);
    assert.match(researchPage, /<h1[^>]*>Ask about your journey<\/h1>/);
    assert.match(researchPage, /current, certified official source supports the answer for the entering term/);
    assert.match(researchForm, /Ask about a task at a tracked college/);
    assert.match(researchForm, /answer\.citations\.map/);
    assert.doesNotMatch(`${publicPage}\n${publicForm}\n${homepage}`, /Public Ask is not a college research tool|It cannot look up a particular school|For school-specific research|school-specific Ask|Public Ask does not research a particular college/);
    assert.doesNotMatch(publicPage, /cannot|can't|does not/i);
  });

  it("gives directly relevant, auditable, materially different answers across 14 intents", () => {
    const unique = new Set<string>();
    for (const [question, category, fact] of matrix) {
      const answer = answerPublicQuestion(question);
      assert.equal(answer.kind, "faq", question);
      assert.equal(answer.category, category, question);
      assert.match(answer.answer, fact, question);
      assert.match(answer.source ?? "", /^Public Campus Passage FAQ · /);
      unique.add(normalize(answer.answer));
    }
    assert.equal(unique.size, matrix.length, "No normalized duplicate responses in broad prompt matrix");
  });

  it("recognizes paraphrases without a capitalization heuristic or generic default", () => {
    const paraphrases: readonly [PublicAskCategory, string[]][] = [
      ["access-cost", ["How much is it?", "Is Campus Passage free right now?", "How much does the subscription cost?", "What are your prices?", "What are the charges?", "Do I need to pay?", "Are payments required?", "Are there fees?", "What is the pricng?", "What is the prcie?", "Do you have subscriptions?", "Will I be billed?", "Is there a charge to start?"]],
      ["overview", ["What is Campus Passage?", "What is this?", "What does this do?", "How does this product help parents organize the college journey?"]],
      ["full-experience", ["How does it work?", "How does this work?", "Describe the whole family journey."]],
      ["getting-started", ["Where do we begin using the product?", "I want to sign up", "Do I need an email?", "What happens after Start Now?"]],
      ["multiple-students", ["Can siblings share one household?", "Is there a second student profile?", "Can we include two kids?"]],
      ["college-allowance", ["Is there a college limit?", "How many schools may I track?"]],
      ["sources", ["What happens if information is stale or conflicts?", "When were sources last checked?", "Where do you get your school information?"]],
      ["task-completion", ["Can I check off a task?", "If I mark a task done, does the school know?"]],
      ["dashboard", ["Where can I see the plan?", "What needs attention on the dashboard?"]],
      ["privacy", ["Who can see our data?", "Can I delete my account?", "Is my info private?"]],
      ["email-coming-soon", ["Is inbox connectivity required?", "What is Email Connectivity?"]],
      ["feedback", ["How do I share feedback?", "Can I report a bug?"]],
      ["administrator-support", ["How do I contact your support team?", "Can I speak to someone?"]],
      ["product-boundaries", ["Does Campus Passage need my school portal password?", "What can't it do?"]],
    ];
    for (const [category, prompts] of paraphrases) for (const question of prompts) {
      const answer = answerPublicQuestion(question);
      assert.equal(answer.kind, "faq", question);
      assert.equal(answer.category, category, question);
    }
    assert.equal(answerPublicQuestion("hOW maNY coLLEges can WE ADD?").category, "college-allowance");
  });

  it("answers multiple safe intents together without dropping the first or burying the second", () => {
    for (const [question, facts] of [
      ["What does Campus Passage do and how do I start?", [/organizes college steps/i, /Start Now, verify your email/i]],
      ["Can siblings track separate schools, and how many colleges can we add?", [/graduation year/i, /up to 10 unique colleges/i]],
      ["Are citations current and who can see my data?", [/official public sources/i, /runs in your browser/i]],
      ["How does the dashboard show task completion?", [/Completed checkbox/i, /signed-in dashboard/i]],
      ["Can I send feedback and reach an administrator?", [/Share feedback on the dashboard/i, /Administrators review submitted feedback privately/i]],
      ["What does this cost, and what happens after Start Now?", [/no charge to start using Campus Passage right now/i, /verify your email.*set up your household/i]],
      ["Is it free, can I include two kids, and where do you get your information?", [/full experience without payment while we gather feedback/i, /graduation year.*separate/i, /official public sources.*when they were checked/i]],
      ["What is this and do I need an email to start?", [/organizes college steps/i, /Start Now, verify your email/i]],
      ["How does this work and is my info private?", [/sample plan.*illustrative, read-only/i, /runs in your browser.*without saving/i]],
    ] as const) {
      const answer = answerPublicQuestion(question);
      assert.equal(answer.kind, "faq", question);
      for (const fact of facts) assert.match(answer.answer, fact, question);
    }
  });

  it("refuses school-specific requests, personalized decisions, portal actions, and records even mixed with safe topics", () => {
    const refused = [
      "When is the application deadline at UT Austin?", "Which scholarships are open?", "Is my student eligible for aid?",
      "What does Harvard require?", "What does harvard require?", "Should my daughter apply to Stanford?",
      "Please log in to my school portal and check the application.", "Show me my household records.",
      "What do you know about my student?", "Write my personal statement.", "What is the FAFSA priority deadline?",
      "When does Rice require deposits?", "Can you recommend the best school for my child?",
      "What is my student's task status?", "What scholarships does my daughter qualify for?",
      "Can you submit my transcript?", "What does Stanford require for Fall 2027?",
      "What does Campus Passage do, and when is Harvard's deadline?",
      "How do I start and can you submit my application?",
      "What does Campus Passage do, and what is the FAFSA deadline?",
      "How does Campus Passage work and can you submit my transcript?",
      "Can you research Elmwood College scholarship requirements?", "How much does Harvard tuition cost?",
      "What are the college application fees?", "What does Rice cost?", "What does this cost, and when is Harvard's deadline?",
    ];
    for (const question of refused) {
      const answer = answerPublicQuestion(question);
      assert.equal(answer.kind, "redirect", question);
      assert.match(answer.answer, /Start Now/i, question);
      assert.doesNotMatch(answer.answer, /Harvard's deadline is|Stanford requires|eligible for aid|^I can't|^Public Ask is not/i, question);
      assert.equal(answer.source, undefined, `Redirects must not claim an official source: ${question}`);
    }
    assert.notEqual(answerPublicQuestion("When is Harvard's deadline?").answer, answerPublicQuestion("Show my household records").answer);
  });

  it("asks a concise question on unknown intent instead of repeating an overview", () => {
    for (const question of ["", "Tell me more", "What about colleges?", "Could you explain that?", "x".repeat(501)]) {
      const answer = answerPublicQuestion(question);
      assert.equal(answer.kind, "clarify", question.slice(0, 30));
      assert.match(answer.answer, /\?/);
      assert.notEqual(answer.answer, answerPublicQuestion("What does Campus Passage do?").answer);
    }
  });

  it("neither reflects visitor input nor invents archived prices, a subscription, or permanent free access", () => {
    assert.doesNotMatch(publicLibrary, /^\s*import\s|\bfetch\s*\(|\bqueryRows\s*\(|\bgetSessionUser\s*\(/m);
    const sentinel = "SENSITIVE_TEST_HOUSEHOLD_RECORD_8493";
    for (const question of [`What is Campus Passage? ${sentinel}`, `When is Harvard's deadline? ${sentinel}`, `Show my household records ${sentinel}`]) {
      assert.doesNotMatch(JSON.stringify(answerPublicQuestion(question)), /SENSITIVE_TEST_HOUSEHOLD_RECORD_8493|access_token|refresh_token|school_research_queue|student_id/i);
    }
    const directCostPrompts = ["what does this cost?", "What does Campus Passage cost?", "What does it cost?", "Is it free?", "Do I have to pay?", "What's the prcie?", "What does this cost and how do I start?"];
    assert.equal(answerPublicQuestion("what does this cost?").source, "Public Campus Passage FAQ · Current access and cost");
    for (const question of directCostPrompts) {
      const response = answerPublicQuestion(question);
      assert.equal(response.kind, "faq", question);
      assert.match(response.answer, /no charge.*right now/i, question);
      assert.match(response.answer, /full experience without payment while we gather feedback/i, question);
      assert.doesNotMatch(response.answer, /\$\s*(?:199|19)\b|(?:permanent(?:ly)?|forever|always) free|(?:requires?|must buy|must pay for) (?:a |an )?subscription/i, question);
      assert.doesNotMatch(response.answer, /current access details|account details are available after sign-in/i, question);
    }
    for (const response of matrix.map(([q]) => answerPublicQuestion(q))) {
      assert.doesNotMatch(response.answer, /\$\s*(?:199|19)\b|live ai/i);
    }
    assert.doesNotMatch(`${publicPage}\n${publicForm}`, /\b(?:pricing|price|payment)\b/i);
  });

  it("renders local FAQ and protected research separately in navigation and UI", () => {
    assert.doesNotMatch(publicPage, /api\/ask|fetch\(/);
    assert.doesNotMatch(publicForm, /api\/ask|fetch\(/);
    assert.match(publicForm, /answerQuestion\(trimmed\)/);
    assert.match(navigation, /href="\/ask"[^>]*>Ask about Campus Passage/);
    assert.match(homepage, /id="ask-campus-passage"/);
    assert.match(homepage, /Ask how Campus Passage works/);
    assert.match(homepage, /Once you’re inside the Passage, ask about your tracked student and college journey with certified official-source citations when available/);
    assert.match(dashboard, /href="\/ask\/research"[^>]*>Ask about your journey/);
  });
});
