#!/usr/bin/env python3
"""
Monitoring / Change-Detection Agent
====================================
Re-fetches every known Source for an institution, fingerprints its content,
and compares that fingerprint against what's on file. A source checked for
the first time just gets its baseline fingerprint recorded. A source whose
fingerprint changed gets a ChangeEvent logged (via Claude, classified as
"material" or "cosmetic") into the review queue at
GET /api/agent/change-events, for a human or the Research Agent to triage.

This is deliberately conservative: it never rewrites a Rule itself. A
material change should prompt someone (or the Research Agent, pointed at
that one checkpoint) to re-verify and re-file the rule; this agent's job
stops at "something changed, and here's whether it looks like it matters."

Usage:
    python monitoring_agent.py --institution alabama
    python monitoring_agent.py --institution alabama --url https://admissions.ua.edu/freshman/deposit/
    python monitoring_agent.py --institution alabama --dry-run

Run this on a schedule (e.g. daily via cron) for continuous monitoring —
see the README for a sample crontab line.
"""

import argparse
import hashlib
import json
import re
import sys

import requests
from bs4 import BeautifulSoup

from common import api_get, api_post, api_patch, get_anthropic_client, ANTHROPIC_MODEL

HEADERS = {"User-Agent": "CollegeNavigatorMonitoringAgent/0.1 (+https://example.com/bot)"}

SYSTEM_PROMPT = """You compare two versions of the same university web page (old text, then new \
text) and decide whether the change is MATERIAL (affects a deadline, dollar amount, eligibility \
rule, required step, or policy that a family would need to act on differently) or COSMETIC \
(wording, formatting, navigation, unrelated announcements, typo fixes).

Output ONLY a JSON object in a ```json fence: {"materiality": "material" | "cosmetic", \
"summary": "one sentence describing what changed and why it does or doesn't matter"}."""


def fetch_text(url: str) -> str | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"  fetch failed for {url}: {e}", file=sys.stderr)
        return None
    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True))
    return text


def fingerprint(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def classify_change(client, old_text: str, new_text: str) -> dict:
    prompt = f"OLD TEXT (truncated):\n{old_text[:6000]}\n\nNEW TEXT (truncated):\n{new_text[:6000]}"
    message = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=500,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(b.text for b in message.content if getattr(b, "type", None) == "text")
    match = re.search(r"```json\s*(\{.*?\})\s*```", text, re.DOTALL) or re.search(r"(\{.*\})", text, re.DOTALL)
    if not match:
        return {"materiality": "unclassified", "summary": "Could not classify change."}
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return {"materiality": "unclassified", "summary": "Could not parse classification."}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--institution", required=True)
    parser.add_argument("--url", help="Only check this one source URL")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    sources = api_get("/api/agent/sources", {"institutionSlug": args.institution})["sources"]
    if args.url:
        sources = [s for s in sources if s["url"] == args.url]

    if not sources:
        print("No known sources to check for this institution yet — run the Research Agent first.")
        return

    print(f"Checking {len(sources)} source(s) for {args.institution}...")
    client = None  # lazily created only if we actually need to classify a change
    flagged = 0

    for source in sources:
        new_text = fetch_text(source["url"])
        if new_text is None:
            continue
        new_fp = fingerprint(new_text)
        old_fp = source.get("fingerprint")

        if old_fp is None:
            print(f"  {source['url']}: baseline captured")
            if not args.dry_run:
                api_patch("/api/agent/sources", {"institutionSlug": args.institution, "url": source["url"], "fingerprint": new_fp, "content": new_text})
            continue

        if old_fp == new_fp:
            print(f"  {source['url']}: unchanged")
            continue

        print(f"  {source['url']}: CHANGED — classifying...")
        if client is None:
            client = get_anthropic_client()
        old_text = source.get("lastContent") or "(no prior content was stored for this source — treat as a first real diff)"
        classification = classify_change(client, old_text, new_text)
        print(f"    -> {classification.get('materiality')}: {classification.get('summary')}")
        flagged += 1

        if not args.dry_run:
            api_post(
                "/api/agent/change-events",
                {
                    "institutionSlug": args.institution,
                    "sourceUrl": source["url"],
                    "materiality": classification.get("materiality", "unclassified"),
                    "oldFingerprint": old_fp,
                    "newFingerprint": new_fp,
                    "newContent": new_text,
                    "summary": classification.get("summary"),
                },
            )

    print(f"\nDone. {flagged} change(s) flagged for review.")


if __name__ == "__main__":
    main()
