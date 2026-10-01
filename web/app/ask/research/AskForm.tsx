"use client";

import { useState } from 'react';
import type { Answer } from '@/lib/db/ask-campus';

export default function AskForm({ studentId }: { studentId: string }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setAnswer(null);
    try {
      const response = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId, question }) });
      if (!response.ok) throw new Error();
      setAnswer(await response.json());
    } catch {
      setAnswer({ kind: 'unknown', text: 'Please try again later. You can follow the official source links in your plan in the meantime.', citations: [] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="space-y-3">
        <label htmlFor="question" className="block text-sm font-medium">Ask about a task at a tracked college</label>
        <textarea id="question" value={question} onChange={e => setQuestion(e.target.value)} maxLength={500} required className="w-full rounded-lg border border-line p-3" rows={3} />
        <p className="text-xs text-ink/55">Keep passwords, application answers, and sensitive details out of your question. For decisions or submissions, follow the school’s official instructions.</p>
        <button disabled={busy} className="rounded-md bg-accent px-4 py-2 text-white disabled:opacity-50">{busy ? 'Checking sources…' : 'Ask about your journey'}</button>
      </form>
      {answer && <section role="status" className="rounded-lg border border-line bg-white p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/55">{answer.kind === 'fact' ? 'Official source quotation and citation' : 'Check with the school'}</p>
        <p className="whitespace-pre-wrap text-sm">{answer.text}</p>
        {answer.citations.length > 0 && <ul className="mt-3 list-disc pl-5 text-xs">{answer.citations.map((c, i) => <li key={i}><a className="underline" href={c.url} rel="noopener noreferrer" target="_blank">{c.title} — official source</a> · {c.term} · checked {c.sourceVerifiedAt.slice(0, 10)}</li>)}</ul>}
      </section>}
    </div>
  );
}
