#!/usr/bin/env python3
"""Conservative official-source change detector.

The monitor records first baselines, advances freshness after successful
unchanged checks, and creates review events for changed content. It never
rewrites family guidance. Dry-run performs no writes and no paid/model calls.
"""

import argparse
import hashlib
import json
import re
import sys
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from common import api_get, api_post, api_patch, get_anthropic_client, ANTHROPIC_MODEL

HEADERS = {"User-Agent": "CampusPassageMonitoringAgent/0.2 (+https://campuspassage.com/)"}
ALLOWED_MATERIALITY = {"material", "cosmetic", "unclassified"}

SYSTEM_PROMPT = """You compare two versions of the same university web page (old text, then new \
text) and decide whether the change is MATERIAL (affects a deadline, dollar amount, eligibility \
rule, required step, or policy that a family would need to act on differently) or COSMETIC \
(wording, formatting, navigation, unrelated announcements, typo fixes).

Output ONLY a JSON object in a ```json fence: {"materiality": "material" | "cosmetic", \
"summary": "one sentence describing what changed and why it does or doesn't matter"}."""


def _normalized_host(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
        return ""
    return (parsed.hostname or "").lower().removeprefix("www.")


def fetch_text(url: str) -> str | None:
    """Fetch public HTTPS content while failing closed on cross-host redirects."""
    allowed_host = _normalized_host(url)
    if not allowed_host:
        print(f"  unsafe source URL: {url}", file=sys.stderr)
        return None
    current = url
    try:
        for _ in range(4):
            resp = requests.get(current, headers=HEADERS, timeout=20, allow_redirects=False)
            if 300 <= resp.status_code < 400:
                destination = urljoin(current, resp.headers.get("location", ""))
                if _normalized_host(destination) != allowed_host:
                    raise requests.RequestException("cross-host redirect refused")
                current = destination
                continue
            resp.raise_for_status()
            if _normalized_host(resp.url or current) != allowed_host:
                raise requests.RequestException("final host changed")
            break
        else:
            raise requests.RequestException("too many redirects")
    except requests.RequestException as error:
        print(f"  fetch failed for {url}: {error}", file=sys.stderr)
        return None
    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    return re.sub(r"\s+", " ", soup.get_text(" ", strip=True))


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
    text = "".join(block.text for block in message.content if getattr(block, "type", None) == "text")
    match = re.search(r"```json\s*(\{.*?\})\s*```", text, re.DOTALL) or re.search(r"(\{.*\})", text, re.DOTALL)
    if not match:
        return {"materiality": "unclassified", "summary": "Could not classify change."}
    try:
        result = json.loads(match.group(1))
    except json.JSONDecodeError:
        return {"materiality": "unclassified", "summary": "Could not parse classification."}
    if result.get("materiality") not in ALLOWED_MATERIALITY:
        return {"materiality": "unclassified", "summary": "Classifier returned an unsupported materiality."}
    return {"materiality": result["materiality"], "summary": str(result.get("summary") or "")[:1000]}


def check_source(source: dict, institution: str, *, dry_run: bool = False, fetcher=fetch_text, classifier=None) -> str:
    """Check one source. Returns failed, baseline, unchanged, or changed."""
    new_text = fetcher(source["url"])
    if new_text is None:
        return "failed"
    new_fp = fingerprint(new_text)
    old_fp = source.get("fingerprint")
    payload = {"institutionSlug": institution, "url": source["url"], "fingerprint": new_fp}

    if old_fp is None:
        print(f"  {source['url']}: baseline captured")
        if not dry_run:
            api_patch("/api/agent/sources", {**payload, "content": new_text})
        return "baseline"

    if old_fp == new_fp:
        print(f"  {source['url']}: unchanged")
        if not dry_run:
            # A successful unchanged fetch is still a verification event. Advance
            # freshness without replacing the previously stored content.
            api_patch("/api/agent/sources", payload)
        return "unchanged"

    print(f"  {source['url']}: CHANGED")
    if dry_run:
        print("    -> dry-run: classification and writes skipped")
        return "changed"

    old_text = source.get("lastContent") or "(no prior content was stored for this source)"
    classification = (classifier or classify_change)(old_text, new_text)
    materiality = classification.get("materiality", "unclassified")
    if materiality not in ALLOWED_MATERIALITY:
        materiality = "unclassified"
    summary = str(classification.get("summary") or "")[:1000]
    print(f"    -> {materiality}: {summary}")
    api_post(
        "/api/agent/change-events",
        {
            "institutionSlug": institution,
            "sourceUrl": source["url"],
            "materiality": materiality,
            "oldFingerprint": old_fp,
            "newFingerprint": new_fp,
            "newContent": new_text,
            "summary": summary,
        },
    )
    return "changed"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--institution", required=True)
    parser.add_argument("--url", help="Only check this one source URL")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and compare only; never write or call a model")
    args = parser.parse_args()

    sources = api_get("/api/agent/sources", {"institutionSlug": args.institution})["sources"]
    if args.url:
        sources = [source for source in sources if source["url"] == args.url]
    if not sources:
        print("No known sources to check for this institution yet — run the Research Agent first.")
        return

    print(f"Checking {len(sources)} source(s) for {args.institution}...")
    client = None
    flagged = 0

    def model_classifier(old_text: str, new_text: str) -> dict:
        nonlocal client
        if client is None:
            client = get_anthropic_client()
        return classify_change(client, old_text, new_text)

    for source in sources:
        result = check_source(source, args.institution, dry_run=args.dry_run, classifier=model_classifier)
        if result == "changed":
            flagged += 1
    print(f"\nDone. {flagged} change(s) flagged for review.")


if __name__ == "__main__":
    main()
