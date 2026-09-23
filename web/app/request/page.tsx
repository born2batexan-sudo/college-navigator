import Link from "next/link";
import { requireOnboardedHousehold } from "@/lib/auth/session";
import { listFamilyRequests, searchDirectory } from "@/lib/db/requests";
import { requestSchool } from "./actions";
import { familyResearchView } from "@/lib/db/request-pipeline";
import { ALL_CHECKPOINTS } from "@/lib/checkpoints";

export const dynamic = "force-dynamic";

type Params = { q?: string; submitted?: string; error?: string };
const statusText: Record<string, string> = {
  queued: "In line — research has not started.",
  running: "Research in progress.",
  ready: "Legacy ready label withheld until reviewed certification; partial evidence only.",
  review: "Held for review — nothing uncertain is shown as verified.",
  failed: "Needs review — we will not publish an unverified plan.",
};

export default async function RequestSchoolPage({ searchParams }: { searchParams: Promise<Params> }) {
  const query = await searchParams;
  const { household, isDemo } = await requireOnboardedHousehold();
  const q = (query.q ?? "").trim().slice(0, 100);
  const [matches, requests] = await Promise.all([searchDirectory(q), listFamilyRequests(household.id)]);
  const views = await Promise.all(requests.map(r => familyResearchView(household.id,r.unitid,r.term)));
  const subjects = new Map(ALL_CHECKPOINTS.map(c=>[c.code,c]));
  return (
    <main className="flex max-w-3xl flex-col gap-7">
      <header>
        <Link href="/" className="text-sm text-ink/50 underline">Back to dashboard</Link>
        <h1 className="mt-3 text-2xl font-semibold text-ink">Request a school</h1>
        <p className="mt-1 max-w-2xl text-ink/60">Search the federal school directory. A first evidence view may be partial. Unresolved subjects are not verified actions or a certified plan.</p>
      </header>
      {isDemo && <p className="rounded-xl border border-accent/25 bg-accent/10 p-3 text-sm text-ink/75"><strong className="text-accent">Private Preview</strong> · You can explore the directory, but new research requests are disabled.</p>}
      {query.error && <p role="alert" className="rounded-md border border-urgent/30 bg-urgent/10 p-3 text-sm text-urgent">{query.error}</p>}
      {query.submitted && <p role="status" className="rounded-md border border-ok/30 bg-ok/10 p-3 text-sm text-ok">Your request is in line. We will update this page when a verified plan is ready.</p>}
      <form method="get" className="flex gap-2">
        <label htmlFor="q" className="sr-only">Search schools</label>
        <input id="q" name="q" defaultValue={q} placeholder="School name, city, or state" minLength={2} className="min-w-0 flex-1 rounded-md border border-line bg-white px-3 py-2 text-sm" />
        <button className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white" type="submit">Search</button>
      </form>
      {q.length >= 2 && <section className="rounded-lg border border-line bg-white p-4"><h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/50">Directory matches</h2>{matches.length === 0 ? <p className="text-sm text-ink/50">No match found. Try a shorter name or the city.</p> : <div className="flex flex-col divide-y divide-line">{matches.map((school) => <div key={school.unitid} className="flex items-center justify-between gap-3 py-3"><div><p className="font-medium text-ink">{school.name}</p><p className="text-xs text-ink/50">{[school.city, school.state].filter(Boolean).join(", ")}</p></div><form action={requestSchool}><input type="hidden" name="unitid" value={school.unitid} /><button disabled={isDemo} className="shrink-0 rounded-md border border-accent px-3 py-1.5 text-sm font-medium text-accent disabled:cursor-not-allowed disabled:border-line disabled:text-ink/35" type="submit">{isDemo ? "Preview only" : "Request"}</button></form></div>)}</div>}</section>}
      <section><h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/50">Your requests</h2>{requests.length === 0 ? <p className="rounded-lg border border-dashed border-line p-5 text-sm text-ink/50">No school requests yet.</p> : <div className="flex flex-col gap-2">{requests.map((item,index) => { const rows=views[index] ?? []; const checked=rows[0]?.checkedAt; const next=rows.length ? rows.map(r=>r.nextCheckAt).sort()[0] : null; const visible=rows.filter(r=>r.state==='verified'||r.state==='not_applicable'||r.state==='not_yet_published'); return <div key={item.id} className="rounded-lg border border-line bg-white p-4"><p className="font-medium text-ink">{item.school.name} · {item.term}</p><p className="text-sm text-ink/60">{rows.length ? `${rows.length}/144 subjects have explicit states; ${visible.length} with exact-term official evidence. Partial view, not certification.` : statusText[item.job?.status ?? 'queued']}</p>{checked && <p className="text-xs text-ink/50">Last checked {checked}; next check {next}. Unchanged checks do not send updates.</p>}{rows.length>0 && <details className="mt-2 text-sm"><summary className="cursor-pointer">View subject states and safe sources</summary><ul className="mt-2 space-y-2">{rows.map(r=><li key={r.code}><strong>{r.code} {subjects.get(r.code)?.title}</strong> — {r.state.replaceAll('_',' ')}{r.sourceUrl && <span> · <a className="underline" href={r.sourceUrl} rel="noopener noreferrer" target="_blank">Official source</a> · {r.quote}</span>}</li>)}</ul></details>}</div>})}</div>}</section>
      <p className="text-xs text-ink/40">New requests are limited to three per household per calendar month. Research is switched off until the service is ready to spend within its monthly safety budget.</p>
    </main>
  );
}
