"use client";

import { useState } from "react";
import { answerPublicQuestion, type PublicAskAnswer } from "@/lib/public-ask";

export default function PublicAskForm({ answerQuestion = answerPublicQuestion }: {
  answerQuestion?: (question: string) => PublicAskAnswer;
}) {
  const [answer, setAnswer] = useState<PublicAskAnswer | null>(null);
  const [error, setError] = useState("");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAnswer(null);
    const trimmed = (event.currentTarget.elements.namedItem("question") as HTMLTextAreaElement).value.trim();
    if (!trimmed) {
      setError("What would you like to know about Campus Passage?");
      return;
    }
    try {
      // The public FAQ runs locally: never send visitor text to the protected research service.
      const result = answerQuestion(trimmed);
      if (!result?.answer) throw new Error("No public FAQ answer");
      setError("");
      setAnswer(result);
    } catch {
      setError("Please try your question again in a moment. You can also choose Start Now to explore your household plan.");
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={submit} noValidate className="space-y-3">
        <label htmlFor="public-question" className="block text-sm font-medium">What would you like to know about Campus Passage?</label>
        <textarea
          id="public-question"
          name="question"
          onInput={() => { setAnswer(null); setError(""); }}
          maxLength={500}
          rows={3}
          aria-describedby="public-question-help"
          aria-invalid={!!error}
          className="w-full min-w-0 rounded-lg border border-line bg-white p-3 text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          placeholder="For example: What happens from Start Now through the household plan?"
        />
        <p id="public-question-help" className="text-xs text-ink/65">Your question stays in this browser and is not saved. Please leave out passwords and sensitive personal details.</p>
        <button type="submit" className="min-h-11 rounded-md bg-accent px-4 py-2 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Ask about Campus Passage</button>
      </form>
      {error && <p role="alert" className="rounded-lg border border-urgent/40 bg-urgent/10 p-4 text-sm text-urgent">{error}</p>}
      {answer && (
        <section role="status" aria-live="polite" className="rounded-lg border border-line bg-white p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/65">
            {answer.kind === "faq" ? "About Campus Passage" : answer.kind === "clarify" ? "Let's narrow it down" : "Continue in your Passage"}
          </p>
          <p className="whitespace-pre-wrap text-sm">{answer.answer}</p>
          {answer.source && <p className="mt-3 text-xs text-ink/65">Source: {answer.source}</p>}
          {answer.kind === "redirect" && (
            <div className="mt-3 flex flex-wrap gap-4 text-sm font-semibold">
              <a className="text-accent underline" href="/login?next=%2Fonboarding">Start Now</a>
              <a className="text-accent underline" href="/login?next=%2Fask%2Fresearch">Sign in to ask about your journey</a>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
