import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { answerPublicQuestion } from "../lib/public-ask";
import { isPublicPath } from "../lib/auth/env";
import { isApplicationProtectedPath } from "../lib/auth/protected-routes";

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const publicPage = read("../app/ask/page.tsx");
const publicForm = read("../app/ask/PublicAskForm.tsx");
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
      ["How does Campus Passage work?", "how-it-works"],
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
    ];
    for (const question of refused) {
      const answer = answerPublicQuestion(question);
      assert.equal(answer.kind, "redirect", question);
      assert.match(answer.answer, /Start Now/i, question);
    }
    assert.equal(answerPublicQuestion("").kind, "redirect");
    assert.equal(answerPublicQuestion("x".repeat(501)).kind, "redirect");
  });

  it("does not send public questions to the authenticated API and adds public and signed-in links", () => {
    assert.doesNotMatch(publicPage, /api\/ask|fetch\(/);
    assert.doesNotMatch(publicForm, /api\/ask|fetch\(/);
    assert.match(publicForm, /answerPublicQuestion\(question\)/);
    assert.match(navigation, /href="\/ask"[^>]*>Ask Campus Passage/);
    assert.match(homepage, /id="ask-campus-passage"/);
    assert.match(homepage, /href="\/ask"/);
    assert.match(homepage, /does not research a particular college/i);
    assert.match(dashboard, /href="\/ask\/research"[^>]*>Ask Campus Passage/);
  });
});
