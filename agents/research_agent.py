#!/usr/bin/env python3
"""
Institutional Research Agent
=============================
Populates the 144-point checkpoint index for one institution by researching
each outstanding checkpoint against official sources, using Claude's
server-side web search tool, then writes the results back through the
app's /api/agent/rules and /api/agent/sources endpoints.

This is the agent that does at scale what the initial Alabama seed did by
hand: turn "we don't know yet" into a sourced, dated, confidence-scored
Rule — never a fabricated one. A checkpoint the model can't confidently
verify is left "unverified" rather than guessed.

Usage:
    python research_agent.py --institution arkansas
    python research_agent.py --institution arkansas --domain "Housing and Dining"
    python research_agent.py --institution arkansas --only-critical
    python research_agent.py --institution arkansas --dry-run   # print, don't write

Requires ANTHROPIC_API_KEY, APP_BASE_URL, AGENT_API_KEY (see agents/.env.example).
"""

import argparse
import json
import re
import sys
from collections import defaultdict

from common import api_get, api_post, get_anthropic_client, ANTHROPIC_MODEL, PROTECTED_CONTENT_BOUNDARY

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
4. For each checkpoint, give a single best official source URL if one exists.
5. Only mark confidence "high" if you found the fact stated explicitly on an official page. \
Use "medium" when it's implied or you're combining two related official statements, and \
"low" when you're inferring from indirect evidence.
6. Return ONLY a JSON array as your final output, wrapped in a ```json code fence, matching \
this schema exactly, one object per checkpoint you were asked about:

```json
[
  {{
    "checkpoint_code": "HOU-02",
    "status": "verified" | "unverified",
    "requirement": "Plain-English statement of the actual rule/requirement/fact.",
    "population": "all" | "out_of_state" | "campus_housing" | "greek_pnm" | "disability_accommodation",
    "trigger": null or one of "applying" | "applied" | "admitted" | "enrolled" | "attending",
    "deadline_expr": null or "YYYY-MM-DD" or "N days after admission",
    "cost_cents": null or integer,
    "refundable": "yes" | "no" | "partial" | "unknown",
    "consequence": null or a plain-English sentence describing what happens if missed,
    "confidence": "high" | "medium" | "low",
    "source_url": null or the URL you used,
    "source_label": null or a short human label for that page,
    "source_owner": null or the office/department that owns it
  }}
]
```

If a checkpoint doesn't apply to this school at all (e.g. no Greek system), still return an \
entry with status "unverified" and requirement explaining that, confidence "high" if you're \
sure it doesn't apply."""


def build_user_prompt(institution_name: str, checkpoints: list[dict]) -> str:
    lines = [f"Research these checkpoints for {institution_name}:\n"]
    for cp in checkpoints:
        crit = " [CRITICAL]" if cp["critical"] else ""
        lines.append(f"- {cp['code']}{crit}: {cp['title']}")
    lines.append(
        "\nUse web search as needed. Work through each checkpoint. Then output the JSON array "
        "described in your instructions, and nothing else after it."
    )
    return "\n".join(lines)


def extract_json_array(text: str):
    match = re.search(r"```json\s*(\[.*?\])\s*```", text, re.DOTALL)
    if not match:
        match = re.search(r"(\[.*\])", text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError as e:
        print(f"Could not parse JSON from model output: {e}", file=sys.stderr)
        return None


def research_domain(client, institution_name: str, checkpoints: list[dict]) -> list[dict]:
    message = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=8000,
        system=SYSTEM_PROMPT,
        tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 8}],
        messages=[{"role": "user", "content": build_user_prompt(institution_name, checkpoints)}],
    )

    final_text = "".join(block.text for block in message.content if getattr(block, "type", None) == "text")
    results = extract_json_array(final_text)
    if results is None:
        print(f"  WARNING: no parseable results for domain batch starting {checkpoints[0]['code']}", file=sys.stderr)
        return []
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--institution", required=True, help="Institution slug, e.g. arkansas")
    parser.add_argument("--domain", help="Only research checkpoints in this domain")
    parser.add_argument("--only-critical", action="store_true", help="Only research critical checkpoints")
    parser.add_argument("--limit", type=int, default=None, help="Cap the number of checkpoints researched this run")
    parser.add_argument("--dry-run", action="store_true", help="Print results without writing them to the app")
    args = parser.parse_args()

    institutions = api_get("/api/agent/institutions")["institutions"]
    institution = next((i for i in institutions if i["slug"] == args.institution), None)
    if not institution:
        print(f"Unknown institution slug '{args.institution}'. Known: {[i['slug'] for i in institutions]}", file=sys.stderr)
        sys.exit(1)

    outstanding = institution["outstandingCriticalCheckpoints"] if args.only_critical else institution["outstandingCheckpoints"]
    if args.domain:
        outstanding = [c for c in outstanding if c["domain"] == args.domain]
    if args.limit:
        outstanding = outstanding[: args.limit]

    if not outstanding:
        print(f"{institution['name']} has nothing outstanding for that filter. Nothing to do.")
        return

    print(f"Researching {len(outstanding)} checkpoints for {institution['name']}...")

    by_domain: dict[str, list[dict]] = defaultdict(list)
    for cp in outstanding:
        by_domain[cp["domain"]].append(cp)

    client = get_anthropic_client()
    total_written = 0

    for domain, checkpoints in by_domain.items():
        print(f"\n--- {domain} ({len(checkpoints)} checkpoints) ---")
        results = research_domain(client, institution["name"], checkpoints)

        for r in results:
            code = r.get("checkpoint_code")
            if not code:
                continue
            status = r.get("status", "unverified")
            print(f"  {code}: {status} ({r.get('confidence', 'low')}) — {r.get('requirement', '')[:90]}")

            if args.dry_run:
                continue

            source_id = None
            if r.get("source_url"):
                source = api_post(
                    "/api/agent/sources",
                    {
                        "institutionSlug": args.institution,
                        "url": r["source_url"],
                        "label": r.get("source_label") or r["source_url"],
                        "owner": r.get("source_owner"),
                        "lastVerified": None,
                    },
                )
                source_id = source["source"]["id"]

            api_post(
                "/api/agent/rules",
                {
                    "institutionSlug": args.institution,
                    "checkpointCode": code,
                    "requirement": r.get("requirement", "Not yet researched."),
                    "status": status,
                    "confidence": r.get("confidence", "low"),
                    "population": r.get("population", "all"),
                    "trigger": r.get("trigger"),
                    "deadlineExpr": r.get("deadline_expr"),
                    "costCents": r.get("cost_cents"),
                    "refundable": r.get("refundable", "unknown"),
                    "consequence": r.get("consequence"),
                    "sourceId": source_id,
                },
            )
            total_written += 1

    print(f"\nDone. {'Would have written' if args.dry_run else 'Wrote'} {total_written} rule(s).")
    if not args.dry_run:
        updated = api_get("/api/agent/institutions")["institutions"]
        inst = next(i for i in updated if i["slug"] == args.institution)
        print(f"{institution['name']} coverage is now {inst['coveragePct']}% ({inst['coverageStatus']}).")


if __name__ == "__main__":
    main()
