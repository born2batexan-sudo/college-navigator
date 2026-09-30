"use client";

import Link from "next/link";
import { useState } from "react";
import { answerPublicQuestion, type PublicAskAnswer } from "@/lib/public-ask";

export default function PublicAskForm() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<PublicAskAnswer | null>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Public Ask is intentionally offline and deterministic: it never calls /api/ask.
    setAnswer(answerPublicQuestion(question));
  }

  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="space-y-3">
        <label htmlFor="public-question" className="block text-sm font-medium">Your general question</label>
        <textarea
          id="public-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={500}
          required
          rows={3}
          className="w-full rounded-lg border border-line bg-white p-3"
          placeholder="For example: How does Campus Passage cite its sources?"
        />
        <p className="text-xs text-ink/55">Do not include a school-specific research request, passwords, or sensitive personal information.</p>
        <button type="submit" className="rounded-md bg-accent px-4 py-2 text-white">Ask</button>
      </form>
      {answer && (
        <section role="status" aria-live="polite" className="rounded-lg border border-line bg-white p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/55">
            {answer.kind === "faq" ? "FAQ-grounded answer" : "Outside public Ask scope"}
          </p>
          <p className="whitespace-pre-wrap text-sm">{answer.answer}</p>
          {answer.source && <p className="mt-3 text-xs text-ink/55">Source: {answer.source}</p>}
          {answer.kind === "redirect" && (
            <div className="mt-3 flex flex-wrap gap-4 text-sm font-semibold">
              <Link className="text-accent underline" href="/login?next=%2Fonboarding">Start Now</Link>
              <Link className="text-accent underline" href="/login?next=%2Fask%2Fresearch">Sign in for school-specific Ask</Link>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
