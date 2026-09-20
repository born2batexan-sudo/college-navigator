#!/usr/bin/env python3
"""Import the IPEDS HD (directory) ZIP into the authenticated queue API.

The federal file's column names have changed slightly across releases, so this
parser uses aliases and skips rows that cannot be safely identified. It only
imports four-year institutions (ICLEVEL=1 when that field is present).
"""
from __future__ import annotations
import argparse, csv, io, re, zipfile
from urllib.parse import urlparse
from common import api_post, require_env


def value(row: dict, *names: str) -> str:
    for name in names:
        if row.get(name) not in (None, "", "-1"):
            return str(row[name]).strip()
    return ""


def domain(url: str) -> str | None:
    raw = url.strip()
    if not raw: return None
    if "://" not in raw: raw = "https://" + raw
    host = urlparse(raw).hostname
    if not host: return None
    host = host.lower().removeprefix("www.")
    return host if re.fullmatch(r"[a-z0-9.-]+", host) else None


def rows_from_zip(path: str):
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if n.lower().endswith(".csv") and "hd" in n.lower()]
        if not names: names = [n for n in z.namelist() if n.lower().endswith(".csv")]
        if not names: raise RuntimeError("The IPEDS ZIP has no CSV file")
        with z.open(names[0]) as raw:
            text = io.TextIOWrapper(raw, encoding="latin-1", newline="")
            for row in csv.DictReader(text):
                level = value(row, "ICLEVEL", "FLEVEL")
                if level and level not in {"1", "1.0"}: continue
                unitid = value(row, "UNITID", "unitid")
                name = value(row, "INSTNM", "name")
                if not unitid.isdigit() or not name: continue
                website = value(row, "WEBADDR", "WEBADDRESS", "website")
                yield {"unitid": unitid, "name": name, "alias": value(row, "IALIAS", "alias") or None,
                       "city": value(row, "CITY", "city") or None, "state": value(row, "STABBR", "state") or None,
                       "website": website or None, "domain": domain(website), "control": value(row, "CONTROL", "control") or None}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    args = parser.parse_args()
    require_env("APP_BASE_URL", __import__("common").APP_BASE_URL)
    require_env("AGENT_API_KEY", __import__("common").AGENT_API_KEY)
    batch, total = [], 0
    for row in rows_from_zip(args.file):
        batch.append(row)
        if len(batch) == 500:
            result = api_post("/api/agent/directory", {"schools": batch})
            total += int(result.get("imported", 0)); print(f"Imported {total} rows", flush=True); batch = []
    if batch:
        result = api_post("/api/agent/directory", {"schools": batch}); total += int(result.get("imported", 0))
    print(f"Imported {total} four-year directory rows")

if __name__ == "__main__": main()
