#!/usr/bin/env python3
"""
Guidance Generation Agent
=========================
Turns verified Rules into household-facing guidance: WHAT / WHEN / WHY /
HOW / CONSEQUENCE, per the brief's guidance framework (Section 11). Only
ever drafts from rules that are already status="verified" — it does not
do its own research, and it never touches essay/personal-statement
content (there is nothing in a Rule's requirement text for it to see,
by construction of the Institutional Research Agent's boundary).

Usage:
    python guidance_agent.py --institution alabama
    python guidance_agent.py --institution alabama --checkpoint HOU-04
    python guidance_agent.py --institution alabama --dry-run
"""

import argparse
import json
import re
import sys

from common import api_get, api_post, get_anthropic_client, ANTHROPIC_MODEL, PROTECTED_CONTENT_BOUNDARY

SYSTEM_PROMPT = f"""You write short, warm, extremely clear guidance for a college-bound student's \
household, based on ONE verified institutional rule you'll be given. {PROTECTED_CONTENT_BOUNDARY}

Write in plain language a stressed parent or 17-year-old could act on immediately. Be specific \
about dollar amounts, dates, and portals when the rule gives you them — don't hedge with vague \
language if the underlying rule is precise. Do not invent any fact not present in the rule you \
were given.

Output ONLY a JSON object in a ```json code fence with exactly these fields: what, when, why, \
how, consequence, deep_link (a URL if the rule includes a source URL, else null). Each of what/ \
when/why/how/consequence should be one to two sentences."""


def build_prompt(institution_name: str, rule: dict, source_url: str | None) -> str:
    return f"""Institution: {institution_name}
Checkpoint: {rule['checkpointCode']} — {rule['title']}
Domain: {rule['domain']}
Critical: {rule['critical']}
Verified requirement: {rule['requirement']}
Deadline expression: {rule.get('deadlineExpr')}
Cost (cents): {rule.get('costCents')}
Refundable: {rule.get('refundable')}
Consequence on file: {rule.get('consequence')}
Source URL: {source_url}

Write the guidance JSON now."""


def extract_json_object(text: str):
    match = re.search(r"```json\s*(\{.*?\})\s*```", text, re.DOTALL)
    if not match:
        match = re.search(r"(\{.*\})", text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError as e:
        print(f"Could not parse JSON: {e}", file=sys.stderr)
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--institution", required=True)
    parser.add_argument("--checkpoint", help="Only generate guidance for this checkpoint code")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    rules = api_get("/api/agent/rules", {"institutionSlug": args.institution})["rules"]
    targets = [r for r in rules if r["status"] == "verified" and not r["hasGuidance"]]
    if args.checkpoint:
        targets = [r for r in targets if r["checkpointCode"] == args.checkpoint]

    if not targets:
        print("Nothing to draft — every verified rule already has guidance (or none match the filter).")
        return

    sources = {s["id"]: s for s in api_get("/api/agent/sources", {"institutionSlug": args.institution})["sources"]}
    institutions = api_get("/api/agent/institutions")["institutions"]
    institution_name = next(i["name"] for i in institutions if i["slug"] == args.institution)

    client = get_anthropic_client()
    written = 0

    for rule in targets:
        source_url = sources.get(rule.get("sourceId"), {}).get("url") if rule.get("sourceId") else None
        message = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=1500,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": build_prompt(institution_name, rule, source_url)}],
        )
        text = "".join(b.text for b in message.content if getattr(b, "type", None) == "text")
        g = extract_json_object(text)
        if not g:
            print(f"  {rule['checkpointCode']}: could not parse guidance, skipping")
            continue

        print(f"  {rule['checkpointCode']}: {g.get('what', '')[:80]}")
        if args.dry_run:
            continue

        api_post(
            "/api/agent/guidance",
            {
                "institutionSlug": args.institution,
                "checkpointCode": rule["checkpointCode"],
                "what": g.get("what", ""),
                "when": g.get("when", ""),
                "why": g.get("why", ""),
                "how": g.get("how", ""),
                "consequence": g.get("consequence", ""),
                "deepLink": g.get("deep_link") or source_url,
            },
        )
        written += 1

    print(f"\nDone. {'Would have written' if args.dry_run else 'Wrote'} guidance for {written} checkpoint(s).")


if __name__ == "__main__":
    main()
