#!/usr/bin/env python3
"""
Institutional Research Agent
=============================
Populates the 144-point checkpoint index for one institution by researching
each outstanding checkpoint against official sources, using Claude's
server-side web search tool, then writes the results back through the
app's /api/agent/rules and /api/agent/sources endpoints.

A checkpoint the model can't confidently verify from an official source is
left "unverified" rather than guessed.

Usage:
    python research_agent.py --institution ut-dallas --domains utdallas.edu
    python research_agent.py --institution ut-dallas --domains utdallas.edu --limit 6   # cheap smoke test
    python research_agent.py --institution arkansas --domain "Housing and Dining"
    python research_agent.py --institution arkansas --only-critical
    python research_agent.py --institution arkansas --dry-run   # print, don't write

Requires ANTHROPIC_API_KEY, APP_BASE_URL, AGENT_API_KEY (see agents/.env.example).

v2 changes (2026-09-18), all aimed at making a first paid run safe and measurable:
  * Cost/usage metering: tokens, web searches, and a run report (JSON + markdown).
  * Hard search budget (--budget-searches) so a run can never run away.
  * Smaller batches (--batch-size, default 6) so each checkpoint gets real search effort.
  * Optional strict domain allow-list (--domains): search is restricted to the school's own
    domains, and a "verified" answer whose source is off-list is downgraded to "unverified".
  * "verified" now REQUIRES a source URL (a verified rule with no source isn't defensible).
  * Population (who a rule applies to) is copied from the already-certified schools instead of
    trusting the model, so CAR-*/HOU-*/GRK-* rules can't silently become "everyone" rules.
    Adds the newer 'bringing_car' population.
  * Handles pause_turn (long web-search turns), retries unparseable output once, retries
    rate limits with backoff, and ignores any checkpoint code the model wasn't asked about
    (so it can never overwrite a verified rule).

v3 changes (2026-09-18), from the UT Dallas full-run review:
  * Target entering term (--term, default "Fall 2027"). Answers that only cover an earlier
    cycle are saved as "unverified" with a "Prior cycle only" label and NO absolute deadline,
    so last year's dates can never surface as this year's. Past-dated absolute deadlines are dropped.
  * Applicability: "not_applicable" (the school genuinely doesn't have the thing, shown by an
    official page + a quoted sentence) is saved as verified "Not applicable: ..."; "not_yet_published"
    (school does it, hasn't published this cycle's details) stays unverified with a clear label.
  * Confidence calibration: "high" is capped at "medium" when the source page is aimed at another
    audience (international, transfer, etc.) or when no supporting quote is given.
  * --codes CODE1,CODE2: re-research specific checkpoints (verified rules are never replaced by an
    unverified answer unless --allow-downgrade). Use it for targeted re-checks.
  * Every answer (with its evidence quote) is kept in the run report for auditing.
"""

import argparse
import json
import os
import re
import sys
import time
from collections import Counter, defaultdict
from urllib.parse import urlparse

from common import api_get, api_post, get_anthropic_client, ANTHROPIC_MODEL, PROTECTED_CONTENT_BOUNDARY

VALID_STATUS = {"verified", "unverified"}
VALID_CONFIDENCE = {"high", "medium", "low"}
VALID_POPULATION = {"all", "out_of_state", "campus_housing", "greek_pnm", "disability_accommodation", "bringing_car"}
VALID_TRIGGER = {"applying", "applied", "admitted", "enrolled", "attending"}
VALID_REFUNDABLE = {"yes", "no", "partial", "unknown"}
VALID_APPLICABILITY = {"applies", "not_applicable", "not_yet_published"}
VALID_CYCLE = {"current", "prior", "undated"}
VALID_AUDIENCE = {"freshman", "general", "other"}
DEFAULT_TERM = "Fall 2027"

SYSTEM_PROMPT = f"""You are the Institutional Research Agent for the College Lifecycle Intelligence \
Platform. Your job is to research specific, atomic checkpoints about a named university's \
undergraduate freshman lifecycle (admissions through career services) and report back \
structured, sourced facts.

Rules you must follow:
1. {PROTECTED_CONTENT_BOUNDARY}
2. Prefer authoritative sources: the university's own admissions, housing, bursar, financial \
aid, health center, and student life web pages. Avoid third-party aggregators, forums, or \
SEO content sites unless no official source exists.
3. Distinguish verified facts from guesses. If you cannot find a specific, dated fact from an \
official source, report status "unverified" rather than inventing a plausible-sounding one. \
Never fabricate a dollar amount, a date, or a policy detail.
4. For each checkpoint, give a single best official source URL if one exists. A "verified" \
answer MUST have a source_url that you actually retrieved through search.
5. Only mark confidence "high" if (a) you found the fact stated explicitly on an official page AND \
(b) that page is written for the family's audience: domestic first-year (freshman) students. If \
your only source is aimed at another audience (international students, transfers, graduate \
students, athletes, one specific program), set source_audience "other" and use confidence \
"medium" at most. Use "medium" also when the fact is implied or you combined two related \
official statements, and "low" when you're inferring from indirect evidence.
6. Entering term. The request names the entering term the family is planning for. Set "cycle" to \
"current" if the page states or clearly covers that term (or is an evergreen policy with no \
year), "prior" ONLY if the information you found explicitly names an earlier year or cycle, and \
"undated" if you cannot tell. Never present an earlier year's dates as if they were current: for \
"prior", put the earlier date in the requirement text labeled with its year and leave \
deadline_expr null.
7. Applicability. Use "applies" normally. Use "not_applicable" ONLY when the school genuinely does \
not have the thing at all (for example no freshman enrollment deposit, no football program, no \
Greek system) AND an official page states or clearly shows that; then status is "verified", \
source_url is that page, evidence_quote is the sentence that shows it, and requirement starts \
with "Not applicable: ". Use "not_yet_published" when the school does have the thing but has not \
yet published details for the entering term; then status is "unverified" and requirement starts \
with "Not yet published: ". If you simply cannot find anything, that is status "unverified" with \
applicability "applies". Never treat a lack of search results as proof that something does not exist.
8. For every "verified" answer, copy a short verbatim quote (under 200 characters) from the \
page that supports it into evidence_quote.
9. Return ONLY a JSON array as your final output, wrapped in a ```json code fence, matching \
this schema exactly, one object per checkpoint you were asked about:

```json
[
  {{
    "checkpoint_code": "HOU-02",
    "status": "verified" | "unverified",
    "requirement": "Plain-English statement of the actual rule/requirement/fact.",
    "population": "all" | "out_of_state" | "campus_housing" | "greek_pnm" | "disability_accommodation" | "bringing_car",
    "trigger": null or one of "applying" | "applied" | "admitted" | "enrolled" | "attending",
    "deadline_expr": null or "YYYY-MM-DD" or "N days after admission",
    "cost_cents": null or integer,
    "refundable": "yes" | "no" | "partial" | "unknown",
    "consequence": null or a plain-English sentence describing what happens if missed,
    "confidence": "high" | "medium" | "low",
    "source_url": null or the URL you used,
    "source_label": null or a short human label for that page,
    "source_owner": null or the office/department that owns it,
    "source_audience": "freshman" | "general" | "other",
    "cycle": "current" | "prior" | "undated",
    "applicability": "applies" | "not_applicable" | "not_yet_published",
    "evidence_quote": null or a short verbatim quote from the source page
  }}
]
```
"""


# ---------------------------------------------------------------------------
# Usage metering
# ---------------------------------------------------------------------------

class Usage:
    def __init__(self):
        self.calls = 0
        self.input_tokens = 0
        self.output_tokens = 0
        self.cache_read_tokens = 0
        self.cache_write_tokens = 0
        self.searches = 0

    def add(self, u):
        self.calls += 1
        if u is None:
            return
        self.input_tokens += getattr(u, "input_tokens", 0) or 0
        self.output_tokens += getattr(u, "output_tokens", 0) or 0
        self.cache_read_tokens += getattr(u, "cache_read_input_tokens", 0) or 0
        self.cache_write_tokens += getattr(u, "cache_creation_input_tokens", 0) or 0
        stu = getattr(u, "server_tool_use", None)
        if stu is not None:
            self.searches += getattr(stu, "web_search_requests", 0) or 0

    def as_dict(self):
        return {
            "api_calls": self.calls,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cache_read_tokens": self.cache_read_tokens,
            "cache_write_tokens": self.cache_write_tokens,
            "web_searches": self.searches,
        }


def estimate_cost_usd(usage: Usage):
    """Optional estimate. Token prices are NOT hard-coded (they change); set them as env vars if you
    want an estimate here. The Anthropic Console's Usage/Cost page is always the authoritative number."""
    per_search = float(os.environ.get("PRICE_PER_1K_SEARCHES", "10.0")) / 1000.0
    in_price = os.environ.get("PRICE_INPUT_PER_MTOK")
    out_price = os.environ.get("PRICE_OUTPUT_PER_MTOK")
    search_cost = usage.searches * per_search
    if in_price is None or out_price is None:
        return None, search_cost
    token_cost = (
        (usage.input_tokens + usage.cache_write_tokens) * float(in_price)
        + usage.output_tokens * float(out_price)
        + usage.cache_read_tokens * float(in_price) * 0.1
    ) / 1_000_000.0
    return token_cost + search_cost, search_cost


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def normalize_domains(raw):
    out = []
    for d in (raw or "").split(","):
        d = d.strip().lower()
        if not d:
            continue
        d = re.sub(r"^https?://", "", d)
        d = d.split("/")[0]
        d = re.sub(r"^www\.", "", d)
        if d and d not in out:
            out.append(d)
    return out


def source_host(url):
    try:
        return (urlparse(url).hostname or "").lower()
    except Exception:
        return ""


def host_allowed(url, domains):
    host = source_host(url)
    if not host:
        return False
    if not domains:
        return False
    return any(host == d or host.endswith("." + d) for d in domains)


def build_user_prompt(institution_name: str, checkpoints: list, domains: list, term: str = DEFAULT_TERM) -> str:
    lines = [
        f"Research these checkpoints for {institution_name}.",
        f"The family is planning for {term} entry (domestic first-year student). Report requirements and "
        f"dates for that entering cycle.\n",
    ]
    for cp in checkpoints:
        crit = " [CRITICAL]" if cp["critical"] else ""
        lines.append(f"- {cp['code']}{crit}: {cp['title']}")
    if domains:
        lines.append(
            "\nWeb search is restricted to these official domains (and their subdomains): "
            + ", ".join(domains)
            + ". If the answer is not on those domains, report status \"unverified\"."
        )
    lines.append(
        "\nUse web search as needed. Work through each checkpoint. Then output the JSON array "
        "described in your instructions, and nothing else after it."
    )
    return "\n".join(lines)


def extract_json_array(text: str):
    blocks = re.findall(r"```json\s*(\[.*?\])\s*```", text, re.DOTALL)
    candidate = blocks[-1] if blocks else None
    if candidate is None:
        match = re.search(r"(\[.*\])", text, re.DOTALL)
        candidate = match.group(1) if match else None
    if candidate is None:
        return None
    try:
        data = json.loads(candidate)
    except json.JSONDecodeError as e:
        print(f"    Could not parse JSON from model output: {e}", file=sys.stderr)
        return None
    return data if isinstance(data, list) else None


def _text_of(message):
    return "".join(b.text for b in message.content if getattr(b, "type", None) == "text")


def call_model(client, usage, user_prompt, tools, max_continuations=4, prior_messages=None):
    """One logical model call. Handles pause_turn (server-side tool loop taking multiple turns)."""
    messages = list(prior_messages or []) + [{"role": "user", "content": user_prompt}]
    texts = []
    stop_reason = None
    for _ in range(max_continuations + 1):
        kwargs = dict(model=ANTHROPIC_MODEL, max_tokens=8000, system=SYSTEM_PROMPT, messages=messages)
        if tools:
            kwargs["tools"] = tools
        msg = client.messages.create(**kwargs)
        usage.add(getattr(msg, "usage", None))
        texts.append(_text_of(msg))
        stop_reason = getattr(msg, "stop_reason", None)
        if stop_reason == "pause_turn":
            messages = messages + [{"role": "assistant", "content": msg.content}]
            continue
        break
    return "\n".join(texts), stop_reason


def research_batch(client, usage, institution_name, checkpoints, domains, max_uses, term=DEFAULT_TERM):
    tool = {"type": "web_search_20250305", "name": "web_search", "max_uses": max_uses}
    if domains:
        tool["allowed_domains"] = domains
    prompt = build_user_prompt(institution_name, checkpoints, domains, term)

    text, stop = call_model(client, usage, prompt, [tool])
    results = extract_json_array(text)

    if results is None and text.strip():
        # One cheap retry, no more searching: ask for just the JSON.
        print("    Output wasn't valid JSON; asking once more for JSON only...", file=sys.stderr)
        retry_prompt = (
            "Your previous reply was not a valid JSON array in a ```json code fence. Using what you "
            "already found (do NOT search again), output ONLY the JSON array described in your instructions."
        )
        text2, _ = call_model(
            client, usage, retry_prompt, None,
            prior_messages=[{"role": "user", "content": prompt}, {"role": "assistant", "content": text}],
        )
        results = extract_json_array(text2)

    if results is None:
        print(f"    WARNING: no parseable results for batch starting {checkpoints[0]['code']} (stop={stop})", file=sys.stderr)
        return []
    return results


def load_reference_profile(institutions, exclude_slug, max_refs=5):
    """Majority-vote 'population' per checkpoint code from already-certified schools."""
    refs = [
        i for i in institutions
        if i["slug"] != exclude_slug and str(i.get("coverageStatus", "")).lower() == "certified"
    ][:max_refs]
    votes = defaultdict(Counter)
    used = []
    for inst in refs:
        try:
            rules = api_get("/api/agent/rules", params={"institutionSlug": inst["slug"]})["rules"]
        except Exception as e:  # noqa: BLE001
            print(f"  (could not load reference rules from {inst['slug']}: {e})", file=sys.stderr)
            continue
        used.append(inst["slug"])
        for r in rules:
            if r.get("population") and r.get("checkpointCode"):
                votes[r["checkpointCode"]][r["population"]] += 1
    profile = {code: c.most_common(1)[0][0] for code, c in votes.items()}
    return profile, used


def _label(prefix, text):
    """Prefix a requirement once (case-insensitive) so labels never stack."""
    t = (text or "").strip() or "Not yet researched."
    return t if t.lower().startswith(prefix.lower().rstrip(": ")) else f"{prefix}{t}"


def normalize_result(r, code, requested_cp, domains, reference_pop, term=DEFAULT_TERM, today=None):
    """Turn one model answer into a safe rules-POST payload (plus notes and audit info for the report)."""
    import datetime as _dt
    today = today or _dt.date.today()
    notes = []
    status = r.get("status") if r.get("status") in VALID_STATUS else "unverified"
    confidence = r.get("confidence") if r.get("confidence") in VALID_CONFIDENCE else "low"
    applicability = r.get("applicability") if r.get("applicability") in VALID_APPLICABILITY else "applies"
    cycle = r.get("cycle") if r.get("cycle") in VALID_CYCLE else "undated"
    audience = r.get("source_audience") if r.get("source_audience") in VALID_AUDIENCE else "general"
    quote = str(r.get("evidence_quote") or "").strip()[:300]
    requirement = (r.get("requirement") or "").strip() or "Not yet researched."
    deadline_expr = r.get("deadline_expr")

    source_url = r.get("source_url")
    if source_url and not host_allowed(source_url, domains):
        notes.append("source_off_allowlist")
        source_url = None
    if status == "verified" and not source_url:
        notes.append("verified_without_valid_source_downgraded")
        status = "unverified"
        confidence = "low"

    # --- Applicability ---------------------------------------------------------------------------
    if applicability == "not_applicable":
        if source_url and quote:
            status = "verified"
            requirement = _label("Not applicable: ", requirement)
            notes.append("not_applicable")
        else:
            notes.append("na_without_evidence_kept_unverified")
            status = "unverified"
            confidence = "low"
    elif applicability == "not_yet_published":
        status = "unverified"
        requirement = _label("Not yet published: ", requirement)
        notes.append("not_yet_published")

    # --- Entering-term cycle ---------------------------------------------------------------------
    if status == "verified" and applicability == "applies" and cycle == "prior":
        status = "unverified"
        requirement = _label(f"Prior cycle only, not yet confirmed for {term}: ", requirement)
        notes.append("prior_cycle_only")
    if isinstance(deadline_expr, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", deadline_expr.strip()):
        try:
            d = _dt.date.fromisoformat(deadline_expr.strip())
        except ValueError:
            d = None
        if d is None or cycle == "prior" or d < today:
            notes.append("dropped_stale_or_invalid_deadline")
            deadline_expr = None
    elif deadline_expr is not None and not isinstance(deadline_expr, str):
        deadline_expr = None

    # --- Confidence calibration ------------------------------------------------------------------
    if status == "verified" and confidence == "high":
        if audience == "other":
            confidence = "medium"
            notes.append("capped_medium_other_audience")
        elif not quote and applicability != "not_applicable":
            confidence = "medium"
            notes.append("capped_medium_no_quote")

    # Population: platform-known value wins; otherwise a validated model value; otherwise safe fallbacks.
    if code in reference_pop and not (code.startswith("CAR-") and reference_pop[code] == "bringing_car"):
        population = reference_pop[code]
    else:
        # CAR is Career and Progression, not car/vehicle logistics.
        population = r.get("population") if r.get("population") in VALID_POPULATION else "all"
    if code.startswith("CAR-") and population == "bringing_car":
        population = "all"
        notes.append("career_vehicle_population_rejected")

    trigger = r.get("trigger") if r.get("trigger") in VALID_TRIGGER else (None if code.startswith("ADM") else "admitted")

    cost = r.get("cost_cents")
    if isinstance(cost, bool) or not isinstance(cost, (int, float)):
        cost = None
    else:
        cost = int(cost)

    refundable = r.get("refundable") if r.get("refundable") in VALID_REFUNDABLE else "unknown"

    payload = {
        "checkpointCode": code,
        "requirement": requirement,
        "status": status,
        "confidence": confidence,
        "population": population,
        "trigger": trigger,
        "deadlineExpr": deadline_expr,
        "costCents": cost,
        "refundable": refundable,
        "consequence": r.get("consequence"),
        "researchTerm": term,
        "cycleState": cycle,
        "applicability": applicability,
        "evidenceQuote": quote or None,
    }
    source = None
    if source_url:
        source = {
            "url": source_url,
            "label": r.get("source_label") or source_url,
            "owner": r.get("source_owner"),
            "lastVerified": None,
        }
    audit = {"applicability": applicability, "cycle": cycle, "source_audience": audience, "evidence_quote": quote}
    return payload, source, notes, audit


def write_report(report, path):
    try:
        with open(path, "w") as f:
            json.dump(report, f, indent=2)
        print(f"Run report written to {path}")
    except OSError as e:
        print(f"Could not write report file: {e}", file=sys.stderr)


def render_markdown(report):
    u = report["usage"]
    lines = [
        f"## Research run: {report['institution']['name']} (`{report['institution']['slug']}`)",
        "",
        f"- Checkpoints attempted: **{report['attempted']}** | wrote: **{report['written']}** | write errors: **{report['write_errors']}**",
        f"- Verified: **{report['status_counts'].get('verified', 0)}** | unverified: **{report['status_counts'].get('unverified', 0)}**",
        f"- Confidence (all answers): high {report['confidence_counts'].get('high', 0)}, "
        f"medium {report['confidence_counts'].get('medium', 0)}, low {report['confidence_counts'].get('low', 0)}",
        f"- Answers touched by safety/quality checks: {report['downgraded']} | entering term: {report.get('term')}",
        f"- Flags: {report.get('flag_counts') or 'none'}",
        f"- Existing verified rules kept (re-check gave no better answer): {report.get('kept_existing_verified', 0)}",
        f"- Distinct source hosts: **{report['distinct_source_hosts']}** (fragmentation proxy)",
        f"- API calls: {u['api_calls']} | web searches: **{u['web_searches']}** | input tokens: {u['input_tokens']:,} | output tokens: **{u['output_tokens']:,}**"
        f" | cache read: {u['cache_read_tokens']:,}",
        f"- Wall time: {report['elapsed_seconds']}s | budget stopped early: {report['stopped_for_budget']}",
    ]
    if report.get("estimated_cost_usd") is not None:
        lines.append(f"- Estimated cost: ${report['estimated_cost_usd']:.2f} (search fees ${report['estimated_search_cost_usd']:.2f}) — confirm in Console")
    else:
        lines.append(f"- Search fees (est.): ${report['estimated_search_cost_usd']:.2f}; token cost: read the Console Usage page (authoritative)")
    if report.get("final_coverage"):
        fc = report["final_coverage"]
        lines.append(f"- App coverage now: **{fc.get('coveragePct')}%** ({fc.get('coverageStatus')}), {fc.get('verifiedCount')}/{fc.get('totalCheckpoints')} verified")
    lines.append(f"- Population source: {report['population_reference'] or 'none found (fallback rules used)'}")
    lines += ["", "Top source hosts:"]
    for host, n in report["top_source_hosts"]:
        lines.append(f"- {host}: {n}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--institution", required=True, help="Institution slug, e.g. arkansas")
    parser.add_argument("--domain", help="Only research checkpoints in this checkpoint domain (e.g. 'Housing and Dining')")
    parser.add_argument("--only-critical", action="store_true", help="Only research critical checkpoints")
    parser.add_argument("--limit", type=int, default=None, help="Cap the number of checkpoints researched this run")
    parser.add_argument("--dry-run", action="store_true", help="Print results without writing them to the app (still costs API money)")
    parser.add_argument("--domains", default="", help="Comma-separated official web domains to restrict search to, e.g. utdallas.edu")
    parser.add_argument("--batch-size", type=int, default=6, help="Checkpoints researched per model call (default 6)")
    parser.add_argument("--max-uses", type=int, default=8, help="Max web searches per model call (default 8)")
    parser.add_argument("--budget-searches", type=int, default=400, help="Hard stop once this many web searches have been used (default 400)")
    parser.add_argument("--pause", type=float, default=3.0, help="Seconds to wait between model calls (default 3)")
    parser.add_argument("--report-file", default="run-report.json", help="Where to write the JSON run report")
    parser.add_argument("--term", default=DEFAULT_TERM, help=f'Entering term the family is planning for (default "{DEFAULT_TERM}")')
    parser.add_argument("--codes", default="", help="Comma-separated checkpoint codes to (re-)research even if already answered, e.g. ACA-02,HOU-04")
    parser.add_argument("--allow-downgrade", action="store_true", help="With --codes: let ANY unverified answer replace an already-verified rule. Default: a verified rule is only replaced by a verified answer, or by a labeled 'prior cycle only' / 'not yet published' reclassification")
    args = parser.parse_args()

    started = time.time()
    domains = normalize_domains(args.domains)

    institutions = api_get("/api/agent/institutions", params={"term": args.term})["institutions"]
    institution = next((i for i in institutions if i["slug"] == args.institution), None)
    if not institution:
        print(f"Unknown institution slug '{args.institution}'. Known: {[i['slug'] for i in institutions]}", file=sys.stderr)
        sys.exit(1)

    existing_rules = {}
    if args.codes.strip():
        wanted = []
        for c in args.codes.split(","):
            c = c.strip().upper()
            if c and c not in wanted:
                wanted.append(c)
        rules_now = api_get("/api/agent/rules", params={"institutionSlug": args.institution, "term": args.term})["rules"]
        existing_rules = {r["checkpointCode"]: r for r in rules_now if r.get("checkpointCode")}
        outstanding = []
        for code in wanted:
            r = existing_rules.get(code)
            if not r:
                print(f"  (no rule/checkpoint {code} found for {args.institution}; skipping)", file=sys.stderr)
                continue
            outstanding.append({"code": code, "domain": r.get("domain") or "General", "title": r.get("title") or code, "critical": bool(r.get("critical"))})
    else:
        outstanding = institution["outstandingCriticalCheckpoints"] if args.only_critical else institution["outstandingCheckpoints"]
    if args.domain:
        outstanding = [c for c in outstanding if c["domain"] == args.domain]
    if args.limit:
        outstanding = outstanding[: args.limit]

    if not outstanding:
        print(f"{institution['name']} has nothing outstanding for that filter. Nothing to do.")
        return

    reference_pop, ref_used = load_reference_profile(institutions, args.institution)
    print(f"Population reference: {ref_used or 'none (using fallback rules)'} ({len(reference_pop)} codes)")
    print(f"Researching {len(outstanding)} checkpoints for {institution['name']}"
          f"{' [domains: ' + ', '.join(domains) + ']' if domains else ' [no domain restriction]'}...")

    by_domain = defaultdict(list)
    for cp in outstanding:
        by_domain[cp["domain"]].append(cp)

    # Sub-batch each checkpoint domain so every call has a manageable, well-searched workload.
    batches = []
    for domain, cps in by_domain.items():
        for i in range(0, len(cps), args.batch_size):
            batches.append((domain, cps[i:i + args.batch_size]))

    client = get_anthropic_client()
    try:
        client = client.with_options(max_retries=8)  # ride out rate limits with the SDK's backoff
    except Exception:  # noqa: BLE001
        pass

    usage = Usage()
    written = 0
    write_errors = 0
    downgraded = 0
    kept_verified = 0
    flag_counts = Counter()
    answers = []
    attempted = 0
    status_counts = Counter()
    confidence_counts = Counter()
    host_counts = Counter()
    source_ids = {}
    stopped_for_budget = False

    for n, (domain, checkpoints) in enumerate(batches, 1):
        if usage.searches >= args.budget_searches:
            print(f"\nBUDGET STOP: {usage.searches} searches used (limit {args.budget_searches}). Re-run to continue; researched rules are already saved.")
            stopped_for_budget = True
            break

        print(f"\n--- [{n}/{len(batches)}] {domain}: {', '.join(c['code'] for c in checkpoints)} ---")
        try:
            results = research_batch(client, usage, institution["name"], checkpoints, domains, args.max_uses, args.term)
        except Exception as e:  # noqa: BLE001
            print(f"    Batch failed: {type(e).__name__}: {e}", file=sys.stderr)
            results = []

        requested = {c["code"]: c for c in checkpoints}
        seen = set()
        for r in results:
            code = r.get("checkpoint_code") if isinstance(r, dict) else None
            if not code:
                continue
            if code not in requested:
                print(f"    (ignoring unrequested code {code})")
                continue
            if code in seen:
                continue
            seen.add(code)
            attempted += 1

            payload, source, notes, audit = normalize_result(r, code, requested[code], domains, reference_pop, args.term)
            if notes:
                downgraded += 1
            for nt in notes:
                flag_counts[nt] += 1
            answers.append({
                "code": code, "status": payload["status"], "confidence": payload["confidence"],
                "requirement": payload["requirement"], "source_url": source["url"] if source else None,
                "notes": notes, **audit,
            })
            status_counts[payload["status"]] += 1
            confidence_counts[payload["confidence"]] += 1
            if source:
                host_counts[source_host(source["url"])] += 1
            flag = f" [{','.join(notes)}]" if notes else ""
            print(f"    {code}: {payload['status']} ({payload['confidence']}) — {payload['requirement'][:90]}{flag}")

            if args.dry_run:
                continue

            prior = existing_rules.get(code)
            informative = {"prior_cycle_only", "not_yet_published"} & set(notes)  # a real reclassification, not a failed search
            if prior and prior.get("status") == "verified" and payload["status"] != "verified" and not informative and not args.allow_downgrade:
                kept_verified += 1
                print(f"    {code}: keeping the existing verified rule (new answer was unverified)")
                continue

            try:
                source_id = None
                if source:
                    if source["url"] in source_ids:
                        source_id = source_ids[source["url"]]
                    else:
                        resp = api_post("/api/agent/sources", {"institutionSlug": args.institution, **source})
                        source_id = resp["source"]["id"]
                        source_ids[source["url"]] = source_id
                api_post("/api/agent/rules", {"institutionSlug": args.institution, "sourceId": source_id, **payload})
                written += 1
            except Exception as e:  # noqa: BLE001
                write_errors += 1
                print(f"    WRITE ERROR for {code}: {type(e).__name__}: {e}", file=sys.stderr)

        missing = [c for c in requested if c not in seen]
        if missing:
            print(f"    No answer returned for: {', '.join(missing)} (stay outstanding for a later pass)")

        if n < len(batches) and args.pause:
            time.sleep(args.pause)

    est_total, est_search = estimate_cost_usd(usage)
    final_cov = None
    if not args.dry_run and written:
        try:
            updated = api_get("/api/agent/institutions")["institutions"]
            inst = next(i for i in updated if i["slug"] == args.institution)
            final_cov = {k: inst.get(k) for k in ("coveragePct", "coverageStatus", "verifiedCount", "totalCheckpoints")}
        except Exception as e:  # noqa: BLE001
            print(f"Could not read final coverage: {e}", file=sys.stderr)

    report = {
        "institution": {"slug": institution["slug"], "name": institution["name"]},
        "model": ANTHROPIC_MODEL,
        "domains": domains,
        "args": {k: v for k, v in vars(args).items()},
        "attempted": attempted,
        "written": written,
        "write_errors": write_errors,
        "downgraded": downgraded,
        "kept_existing_verified": kept_verified,
        "flag_counts": dict(flag_counts),
        "term": args.term,
        "answers": answers,
        "status_counts": dict(status_counts),
        "confidence_counts": dict(confidence_counts),
        "distinct_source_hosts": len(host_counts),
        "top_source_hosts": host_counts.most_common(15),
        "usage": usage.as_dict(),
        "estimated_cost_usd": est_total,
        "estimated_search_cost_usd": est_search,
        "elapsed_seconds": round(time.time() - started),
        "stopped_for_budget": stopped_for_budget,
        "population_reference": ref_used,
        "final_coverage": final_cov,
    }

    print(f"\nDone. {'Would have written' if args.dry_run else 'Wrote'} {written if not args.dry_run else attempted} rule(s).")
    md = render_markdown(report)
    print("\n" + md)
    write_report(report, args.report_file)
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        try:
            with open(summary_path, "a") as f:
                f.write(md + "\n")
        except OSError:
            pass

    if attempted == 0 or write_errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
