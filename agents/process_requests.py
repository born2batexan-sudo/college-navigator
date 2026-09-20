#!/usr/bin/env python3
"""Run one request-driven school research attempt, with one bounded re-check."""
from __future__ import annotations
import json, os, re, subprocess, sys
from pathlib import Path
from common import api_get, api_post, require_env, APP_BASE_URL, AGENT_API_KEY

RESEARCHED_TERM = "Fall 2027"
DEFAULT_TERM = os.environ.get("REQUEST_RESEARCH_TERM", RESEARCHED_TERM)
ROOT = Path(__file__).resolve().parent

def slugify(name: str, unitid: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    # UnitID prevents same-name campuses from sharing one institution row.
    return f"{(s[:70] or 'requested-school')}-{unitid}"

def cost(report: dict | None) -> int:
    if not report: return 0
    v = report.get("estimated_cost_usd")
    return max(0, round(float(v) * 100)) if isinstance(v, (int, float)) else 0

def run_agent(slug: str, domains: str, term: str, report_name: str, codes: str = "", budget: str = "400") -> tuple[int, dict | None]:
    args = [sys.executable, str(ROOT / "research_agent.py"), "--institution", slug, "--domains", domains,
            "--budget-searches", budget, "--report-file", report_name, "--term", term]
    if codes: args += ["--codes", codes]
    proc = subprocess.run(args, cwd=ROOT, check=False)
    path = ROOT / report_name
    if not path.exists(): return proc.returncode, None
    try: return proc.returncode, json.loads(path.read_text())
    except (ValueError, OSError): return proc.returncode, None

def current_coverage(slug: str) -> tuple[bool, list[str], dict | None]:
    data = api_get("/api/agent/institutions").get("institutions", [])
    item = next((x for x in data if x.get("slug") == slug), None)
    if not item: return False, [], None
    codes = [x.get("code") for x in item.get("outstandingCriticalCheckpoints", []) if x.get("code")]
    if not codes: codes = [x.get("code") for x in item.get("outstandingCheckpoints", []) if x.get("code")]
    return str(item.get("coverageStatus", "")).lower() == "certified", codes, item

def main():
    require_env("APP_BASE_URL", APP_BASE_URL); require_env("AGENT_API_KEY", AGENT_API_KEY)
    claim = api_post("/api/agent/requests/claim", {})
    if not claim.get("claimed"):
        print("Nothing to do", flush=True); return
    job, school = claim["job"], claim["school"]
    unitid, term, attempt = school["unitid"], job.get("term") or DEFAULT_TERM, int(job["attempts"])
    slug = slugify(school["name"], unitid)
    domains = school.get("domain") or ""
    print(f"Claimed {school['name']} ({unitid}, {term}), attempt {attempt}", flush=True)
    # Non-Fall jobs are queued and counted now, but this slice cannot safely
    # certify them until rules gain a term dimension (the agent's --term flag
    # alone is not sufficient to make shared rules term-correct).
    if term != RESEARCHED_TERM:
        result = api_post("/api/agent/requests/report", {"unitid": unitid, "term": term, "attempt": attempt, "outcome": "review", "costCents": 0, "slug": slug, "note": f"Term-specific research is not enabled for {term}; held without publishing Fall-only data."})
        print(f"RESULT {result['job']['status']} {school['name']}", flush=True); return
    # Onboarding is idempotent and seeds all 144 explicit unverified placeholders.
    api_post("/api/agent/institutions", {"name": school["name"], "slug": slug, "domains": [domains] if domains else []})
    api_post("/api/agent/directory", {"link": {"unitid": unitid, "slug": slug}})
    rc, first = run_agent(slug, domains, term, "run-report.json")
    first_cost = cost(first)
    certified, codes, coverage = current_coverage(slug)
    if certified:
        result = api_post("/api/agent/requests/report", {"unitid": unitid, "term": term, "attempt": attempt, "outcome": "certified", "costCents": first_cost, "coveragePct": coverage.get("coveragePct") if coverage else None, "slug": slug, "note": "Research run passed the server certification gate."})
        print(f"RESULT {result['job']['status']} {school['name']}", flush=True); return
    # The first weak result gets exactly one targeted re-check. It is marked on
    # the server before work starts, preventing a retry loop after worker death.
    if not job.get("recheckDone") and codes:
        api_post("/api/agent/requests/report", {"unitid": unitid, "term": term, "attempt": attempt, "outcome": "recheck", "costCents": first_cost, "slug": slug, "note": "First pass was not certifiable; running one targeted re-check."})
        codes_arg = ",".join(codes[:40])
        rc2, second = run_agent(slug, domains, term, "run-report-recheck.json", codes_arg, "150")
        total_cost = first_cost + cost(second)
        certified2, _, coverage2 = current_coverage(slug)
        if certified2:
            result = api_post("/api/agent/requests/report", {"unitid": unitid, "term": term, "attempt": attempt, "outcome": "certified", "costCents": total_cost, "coveragePct": coverage2.get("coveragePct") if coverage2 else None, "slug": slug, "note": "Targeted re-check passed the server certification gate."})
            print(f"RESULT {result['job']['status']} {school['name']}", flush=True); return
        result = api_post("/api/agent/requests/report", {"unitid": unitid, "term": term, "attempt": attempt, "outcome": "review", "costCents": total_cost, "coveragePct": coverage2.get("coveragePct") if coverage2 else None, "slug": slug, "note": "Research remains below certification after the bounded re-check."})
        print(f"RESULT {result['job']['status']} {school['name']}", flush=True); return
    result = api_post("/api/agent/requests/report", {"unitid": unitid, "term": term, "attempt": attempt, "outcome": "failed" if rc else "review", "costCents": first_cost, "coveragePct": coverage.get("coveragePct") if coverage else None, "slug": slug, "note": "No certifiable result was produced; held without publishing uncertain data."})
    print(f"RESULT {result['job']['status']} {school['name']}", flush=True)

if __name__ == "__main__":
    try: main()
    except Exception as exc:
        print(f"Reported failure: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise
