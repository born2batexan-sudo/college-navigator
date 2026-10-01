import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { answerPublicQuestion } from "../lib/public-ask";
import { isPublicPath } from "../lib/auth/env";
import { isApplicationProtectedPath } from "../lib/auth/protected-routes";

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const publicPage = read("../app/ask/page.tsx");
const publicForm = read("../app/ask/PublicAskForm.tsx");
const publicLibrary = read("../lib/public-ask.ts");
const researchPage = read("../app/ask/research/page.tsx");
const researchForm = read("../app/ask/AskForm.tsx");
const authenticatedApi = read("../app/api/ask/route.ts");
const homepage = read("../components/CampusPassageLanding.tsx");
const navigation = read("../components/HeaderNav.tsx");
const dashboard = read("../app/dashboard/page.tsx");

describe("public Ask Campus Passage boundary", () => {
  it("makes only the exact /ask page public and keeps research behind auth", () => {
    assert.equal(isPublicPath("/ask"), true);
    assert.equal(isPublicPath("/ask/research"), false);
    assert.equal(isApplicationProtectedPath("/ask"), false);
    assert.equal(isApplicationProtectedPath("/ask/research"), true);
    assert.equal(isApplicationProtectedPath("/ask/research/extra"), false);
    assert.match(publicPage, /PublicAskForm/);
    assert.doesNotMatch(publicPage, /requireOnboardedHousehold|import AskForm|api\/ask/);
    assert.match(researchPage, /requireOnboardedHousehold\(/);
    assert.match(researchPage, /AskForm studentId=\{ctx\.student\.id\}/);
    assert.match(researchForm, /fetch\('\/api\/ask'/);
    assert.match(authenticatedApi, /authorizedApiHousehold\(/);
  });

  it("answers only supported general FAQ topics with auditable FAQ sources", () => {
    const accepted = [
      ["How does Campus Passage work?", "full-experience"],
      ["What does Campus Passage do?", "overview"],
      ["What is the full experience from start to finish?", "full-experience"],
      ["What is the full Campus Passage experience?", "full-experience"],
      ["How do I share feedback?", "feedback"],
      ["How are your sources and citations verified?", "sources"],
      ["How do I get started?", "getting-started"],
      ["What is the privacy and deletion policy?", "privacy"],
      ["How many students can a household support?", "multiple-students"],
      ["What is Email Connectivity?", "email-coming-soon"],
      ["Does Campus Passage need my school portal password?", "product-boundaries"],
    ] as const;
    for (const [question, category] of accepted) {
      const answer = answerPublicQuestion(question);
      assert.equal(answer.kind, "faq", question);
      assert.equal(answer.category, category, question);
      assert.match(answer.source ?? "", /^Public Campus Passage FAQ · /);
    }
  });

  it("keeps every public Ask message illustrative and free of retired sample wording", () => {
    const accepted = [
      "How does Campus Passage work?",
      "What does Campus Passage do?",
      "What is the full experience from start to finish?",
      "How do I share feedback?",
      "How are your sources and citations verified?",
      "How do I get started?",
      "What is the privacy and deletion policy?",
      "How many students can a household support?",
      "What is Email Connectivity?",
      "Does Campus Passage need my school portal password?",
    ];
    const fullExperience = answerPublicQuestion("What is the full experience from start to finish?");
    assert.match(fullExperience.answer, /illustrative example/i);
    const publicResponses = [...accepted.map(answerPublicQuestion), answerPublicQuestion("When is Harvard's application deadline?")];
    for (const response of publicResponses) assert.doesNotMatch(JSON.stringify(response), /\bfictional\b/i);
    assert.doesNotMatch(`${publicPage}\n${publicForm}\n${publicLibrary}`, /\bfictional\b/i);
  });

  it("redirects school research, deadlines, scholarships, eligibility, advice, actions, payments, and records", () => {
    const refused = [
      "When is the application deadline at UT Austin?",
      "Which scholarships are open?",
      "Is my student eligible for aid?",
      "What does Harvard require?",
      "Should my daughter apply to Stanford?",
      "Please log in to my school portal and check the application.",
      "Pay my housing deposit.",
      "Show me my household records.",
      "What do you know about my student?",
      "Write my personal statement.",
      "What is the FAFSA priority deadline?",
      "What does harvard require?",
      "When does Rice require deposits?",
      "Can you recommend the best school for my child?",
      "What is my student's task status?",
      "What scholarships does my daughter qualify for?",
      "Can you submit my transcript?",
      "What does Stanford require for Fall 2027?",
      "What does Campus Passage cost?",
    ];
    for (const question of refused) {
      const answer = answerPublicQuestion(question);
      assert.equal(answer.kind, "redirect", question);
      assert.match(answer.answer, /Start Now/i, question);
    }
    assert.equal(answerPublicQuestion("").kind, "redirect");
    assert.equal(answerPublicQuestion("x".repeat(501)).kind, "redirect");
    const combined = answerPublicQuestion("What does Campus Passage do and how do I start?");
    assert.equal(combined.kind, "faq");
    assert.match(combined.answer, /organizes the college journey/i);
    assert.match(combined.answer, /verify your email/i);
    for (const [question, expected] of [
      ["Tell me more about the full experience", /household plan.*Add eligible students/i],
      ["What about privacy and access?", /no access to a household's records/i],
      ["Can I track my two students?", /same high-school graduation year/i],
      ["Where can I send feedback?", /Share feedback on the dashboard/i],
      ["Is inbox connectivity required?", /Coming Soon.*optional/i],
      ["Can it replace my counselor?", /does not replace a counselor/i],
    ] as const) {
      const result = answerPublicQuestion(question);
      assert.equal(result.kind, "faq", question);
      assert.match(result.answer, expected, question);
    }
    assert.doesNotMatch(JSON.stringify(Object.values([combined, answerPublicQuestion("What is the full experience?")])), /student_\w+|household_\w+|https?:\/\/[^\s]+\/api\/|access_token|refresh_token/i);
  });

  it("cannot reflect visitor input or import protected research or household data", () => {
    assert.doesNotMatch(publicLibrary, /^\s*import\s|\bfetch\s*\(|\bqueryRows\s*\(|\bgetSessionUser\s*\(/m);
    const sentinel = "SENSITIVE_TEST_HOUSEHOLD_RECORD_8493";
    for (const question of [
      `What is Campus Passage? ${sentinel}`,
      `When is Harvard's deadline? ${sentinel}`,
      `Show my household records ${sentinel}`,
      `How do I share feedback? ${sentinel}`,
    ]) {
      const result = answerPublicQuestion(question);
      assert.doesNotMatch(JSON.stringify(result), /SENSITIVE_TEST_HOUSEHOLD_RECORD_8493/);
      assert.doesNotMatch(JSON.stringify(result), /access_token|refresh_token|school_research_queue|student_id/i);
    }
  });

  it("does not send public questions to the authenticated API and adds public and signed-in links", () => {
    assert.doesNotMatch(publicPage, /api\/ask|fetch\(/);
    assert.doesNotMatch(publicForm, /api\/ask|fetch\(/);
    assert.match(publicForm, /answerQuestion\(trimmed\)/);
    assert.match(publicForm, /answerQuestion = answerPublicQuestion/);
    assert.match(navigation, /href="\/ask"[^>]*>Ask Campus Passage/);
    assert.match(homepage, /id="ask-campus-passage"/);
    assert.match(homepage, /href="\/ask"/);
    assert.match(homepage, /does not research a particular college/i);
    assert.match(dashboard, /href="\/ask\/research"[^>]*>Ask Campus Passage/);
  });
});
