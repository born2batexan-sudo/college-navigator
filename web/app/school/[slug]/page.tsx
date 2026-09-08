import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getInstitutionBySlug,
  listRulesForInstitution,
  listHouseholds,
  listStudentsForHousehold,
  listRelationshipsForStudent,
  listActionInstancesForRelationship,
} from "@/lib/db/repo";
import { COVERAGE_LABELS, COVERAGE_STYLES, STATE_LABELS, STATE_STYLES } from "@/lib/format";
import { StatePill } from "@/components/StatusPill";

export const dynamic = "force-dynamic";

export default function SchoolTrackerPage({ params }: { params: { slug: string } }) {
  const institution = getInstitutionBySlug(params.slug);
  if (!institution) notFound();

  const rules = listRulesForInstitution(institution.id);

  const household = listHouseholds()[0];
  const student = household ? listStudentsForHousehold(household.id)[0] : null;
  const relationship = student ? listRelationshipsForStudent(student.id).find((r) => r.institutionId === institution.id) : null;
  const actionsByRuleId = new Map<string, ReturnType<typeof listActionInstancesForRelationship>[number]>();
  if (relationship) {
    for (const a of listActionInstancesForRelationship(relationship.id)) {
      actionsByRuleId.set(a.ruleId, a);
    }
  }

  const domains = Array.from(new Set(rules.map((r) => r.domain)));
  const verifiedCount = rules.filter((r) => r.status === "verified").length;
  const criticalUnverified = rules.filter((r) => r.critical && r.status === "unverified").length;

  return (
    <main className="flex flex-col gap-6">
      <Link href="/" className="text-sm text-ink/50 hover:underline">
        ← Back to household dashboard
      </Link>

      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-ink">{institution.name}</h1>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COVERAGE_STYLES[institution.coverageStatus]}`}>
            {COVERAGE_LABELS[institution.coverageStatus]}
          </span>
        </div>
        <p className="text-sm text-ink/60">
          144-point inspection: {verifiedCount}/144 checkpoints verified ({institution.coveragePct}%).{" "}
          {criticalUnverified > 0
            ? `${criticalUnverified} critical checkpoints still need research — this school cannot certify until those clear.`
            : "All critical checkpoints are verified."}
        </p>
        <p className="text-xs text-ink/40">
          Certification gates (per the platform standard): Certified ≥90% with no critical gaps · Beta 75–89% or one
          critical gap · Research 50–74% · Unsupported below 50%.
        </p>
      </header>

      {domains.map((domain) => {
        const domainRules = rules.filter((r) => r.domain === domain);
        return (
          <section key={domain}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/50">{domain}</h2>
            <div className="overflow-hidden rounded-lg border border-line bg-white">
              {domainRules.map((rule, i) => {
                const action = actionsByRuleId.get(rule.id);
                const content = (
                  <div
                    className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm ${
                      i !== domainRules.length - 1 ? "border-b border-line" : ""
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-ink/40">{rule.checkpointCode}</span>
                        {rule.critical && <span className="text-[10px] font-semibold uppercase text-accent">Critical</span>}
                        <span className="truncate text-ink/80">{rule.title}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {rule.status === "verified" ? (
                        <span className="rounded-full bg-ok/10 px-2 py-0.5 text-[11px] font-medium text-ok">
                          Verified · {rule.confidence}
                        </span>
                      ) : (
                        <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[11px] font-medium text-ink/40">
                          Not yet researched
                        </span>
                      )}
                      {action && <StatePill state={action.state} styles={STATE_STYLES} labels={STATE_LABELS} />}
                    </div>
                  </div>
                );
                return action ? (
                  <Link key={rule.id} href={`/action/${action.id}`} className="block hover:bg-ink/[0.02]">
                    {content}
                  </Link>
                ) : (
                  <div key={rule.id}>{content}</div>
                );
              })}
            </div>
          </section>
        );
      })}
    </main>
  );
}
