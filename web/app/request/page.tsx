import Link from "next/link";
import { requireOnboardedHousehold } from "@/lib/auth/session";
import { listFamilyRequests, searchDirectory } from "@/lib/db/requests";
import { requestSchool } from "./actions";

export const dynamic = "force-dynamic";

type Params = { q?: string; submitted?: string; error?: string };
const statusText: Record<string, string> = {
  queued: "In line — research has not started.",
  running: "Research in progress.",
  ready: "Ready — verified school plan available.",
  review: "Held for review — nothing uncertain is shown as verified.",
  failed: "Needs review — we will not publish an unverified plan.",
};

export default async function RequestSchoolPage({ searchParams }: { searchParams: Params }) {
  const { household } = await requireOnboardedHousehold();
  const q = (searchParams.q ?? "").trim().slice(0, 100);
  const [matches, requests] = await Promise.all([searchDirectory(q), listFamilyRequests(household.id)]);
  return (
    <main className="flex max-w-3xl flex-col gap-7">
      <header>
        <Link href="/" className="text-sm text-ink/50 underline">Back to dashboard</Link>
        <h1 className="mt-3 text-2xl font-semibold text-ink">Request a school</h1>
        <p className="mt-1 max-w-2xl text-ink/60">Search the federal school directory. We research one school at a time and show a plan only after it passes the verification gate.</p>
      </header>
      {searchParams.error && <p role="alert" className="rounded-md border border-urgent/30 bg-urgent/10 p-3 text-sm text-urgent">{searchParams.error}</p>}
      {searchParams.submitted && <p role="status" className="rounded-md border border-ok/30 bg-ok/10 p-3 text-sm text-ok">Your request is in line. We will update this page when a verified plan is ready.</p>}
      <form method="get" className="flex gap-2">
        <label htmlFor="q" className="sr-only">Search schools</label>
        <input id="q" name="q" defaultValue={q} placeholder="School name, city, or state" minLength={2} className="min-w-0 flex-1 rounded-md border border-line bg-white px-3 py-2 text-sm" />
        <button className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white" type="submit">Search</button>
      </form>
      {q.length >= 2 && <section className="rounded-lg border border-line bg-white p-4"><h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/50">Directory matches</h2>{matches.length === 0 ? <p className="text-sm text-ink/50">No match found. Try a shorter name or the city.</p> : <div className="flex flex-col divide-y divide-line">{matches.map((school) => <div key={school.unitid} className="flex items-center justify-between gap-3 py-3"><div><p className="font-medium text-ink">{school.name}</p><p className="text-xs text-ink/50">{[school.city, school.state].filter(Boolean).join(", ")}</p></div><form action={requestSchool}><input type="hidden" name="unitid" value={school.unitid} /><button className="shrink-0 rounded-md border border-accent px-3 py-1.5 text-sm font-medium text-accent" type="submit">Request</button></form></div>)}</div>}</section>}
      <section><h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/50">Your requests</h2>{requests.length === 0 ? <p className="rounded-lg border border-dashed border-line p-5 text-sm text-ink/50">No school requests yet.</p> : <div className="flex flex-col gap-2">{requests.map((item) => { const ready = item.job?.status === "ready" && item.institution?.coverageStatus === "certified"; const status = ready ? "ready" : item.job?.status ?? "queued"; return <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white p-4"><div><p className="font-medium text-ink">{item.school.name}</p><p className="text-xs text-ink/40">{item.term}</p><p className="text-sm text-ink/60">{statusText[status] ?? "Queued for research."}</p></div><span className="text-xs text-ink/40">{status === "ready" ? <Link href={`/school/${item.institution?.slug}`} className="underline">Open plan</Link> : "Updates appear here"}</span></div>})}</div>}</section>
      <p className="text-xs text-ink/40">New requests are limited to three per household per calendar month. Research is switched off until the service is ready to spend within its monthly safety budget.</p>
    </main>
  );
}
