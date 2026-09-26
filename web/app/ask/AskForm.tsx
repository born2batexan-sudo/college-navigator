"use client";
import { useState } from 'react';
import type { Answer } from '@/lib/db/ask-campus';
export default function AskForm({studentId}:{studentId:string}) {
 const [question,setQuestion]=useState(''),[answer,setAnswer]=useState<Answer|null>(null),[busy,setBusy]=useState(false);
 async function submit(e:React.FormEvent) {e.preventDefault();setBusy(true);setAnswer(null);
  try {const response=await fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({studentId,question})});
   if(!response.ok) throw new Error(); setAnswer(await response.json());} catch {setAnswer({kind:'unknown',text:'Question unavailable. Please try again later.',citations:[]});} finally{setBusy(false);}
 }
 return <div className="space-y-5"><form onSubmit={submit} className="space-y-3"><label htmlFor="question" className="block text-sm font-medium">Ask about a tracked school task</label><textarea id="question" value={question} onChange={e=>setQuestion(e.target.value)} maxLength={500} required className="w-full rounded-lg border border-line p-3" rows={3}/><p className="text-xs text-ink/55">Do not enter essays, application answers, account credentials, financial or medical details. This tool cannot submit or change anything.</p><button disabled={busy} className="rounded-md bg-accent px-4 py-2 text-white disabled:opacity-50">{busy?'Checking…':'Ask'}</button></form>{answer&&<section role="status" className="rounded-lg border border-line bg-white p-4"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/55">{answer.kind==='fact'?'Official source quotation — not a decision':'Unable to answer from verified sources'}</p><p className="whitespace-pre-wrap text-sm">{answer.text}</p>{answer.citations.length>0&&<ul className="mt-3 list-disc pl-5 text-xs">{answer.citations.map((c,i)=><li key={i}><a className="underline" href={c.url} rel="noopener noreferrer" target="_blank">{c.title} — official source</a> · {c.term} · checked {c.sourceVerifiedAt.slice(0,10)}</li>)}</ul>}</section>}</div>;
}
