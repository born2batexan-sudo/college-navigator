"""
Shared config and helpers for the three College Navigator agents:
  - research_agent.py     (Institutional Research Agent)
  - monitoring_agent.py   (Monitoring / Change-Detection Agent)
  - guidance_agent.py     (Guidance Generation Agent)

Each agent is a standalone script that talks to two things:
  1. The Anthropic API directly (for research, classification, drafting)
  2. This app's own /api/agent/* HTTP endpoints (to read/write state)

They do NOT touch the SQLite file directly. That keeps them runnable from
anywhere (a cron box, a serverless function, your laptop) regardless of
where the app itself is deployed — only APP_BASE_URL has to change.
"""

import os
import sys
import json
import time
from typing import Any

import requests

try:
    from dotenv import load_dotenv

    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "web", ".env"))
except ImportError:
    pass

APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:3000")
AGENT_API_KEY = os.environ.get("AGENT_API_KEY", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5")

PROTECTED_CONTENT_BOUNDARY = (
    "You manage college-lifecycle PROCESS, TIMING, COST, and LOGISTICS only. "
    "You must never read, quote, store, summarize, generate, rewrite, or score "
    "admissions essays, personal statements, or other substantively evaluated "
    "application content. If a source page contains essay prompts, you may note "
    "that a prompt exists (checkpoint ADM-08) but must not reproduce or analyze "
    "its content."
)


def require_env(name: str, value: str):
    if not value:
        print(f"ERROR: {name} is not set. Set it in agents/.env or the environment.", file=sys.stderr)
        sys.exit(1)


def _headers() -> dict:
    return {"Authorization": f"Bearer {AGENT_API_KEY}", "Content-Type": "application/json"}


# The app runs on serverless hosting, so an occasional request is slow (a cold start, or the
# coverage recalculation that follows each rule save). Give it time, and retry a few times
# before giving up. Retrying is safe: saving a rule replaces the rule for that checkpoint, and
# registering a source returns the existing one if the URL is already known.
REQUEST_TIMEOUT = (15, 120)  # (connect seconds, read seconds)
RETRY_WAITS = (3, 10, 25)  # seconds to wait before retry 1, 2 and 3
RETRY_STATUSES = {429, 500, 502, 503, 504}


def _request(method: str, path: str, **kwargs) -> Any:
    last_error: Exception | None = None
    for attempt in range(len(RETRY_WAITS) + 1):
        try:
            resp = requests.request(method, f"{APP_BASE_URL}{path}", headers=_headers(), timeout=REQUEST_TIMEOUT, **kwargs)
            if resp.status_code in RETRY_STATUSES and attempt < len(RETRY_WAITS):
                print(f"{method} {path} -> {resp.status_code}; retrying in {RETRY_WAITS[attempt]}s", file=sys.stderr)
                time.sleep(RETRY_WAITS[attempt])
                continue
            if not resp.ok:
                print(f"{method} {path} -> {resp.status_code}: {resp.text}", file=sys.stderr)
            resp.raise_for_status()
            return resp.json()
        except (requests.Timeout, requests.ConnectionError) as e:
            last_error = e
            if attempt < len(RETRY_WAITS):
                print(f"{method} {path} -> {type(e).__name__}; retrying in {RETRY_WAITS[attempt]}s", file=sys.stderr)
                time.sleep(RETRY_WAITS[attempt])
                continue
            raise
    raise last_error  # pragma: no cover


def api_get(path: str, params: dict | None = None) -> Any:
    return _request("GET", path, params=params)


def api_post(path: str, body: dict) -> Any:
    return _request("POST", path, data=json.dumps(body))


def api_patch(path: str, body: dict) -> Any:
    return _request("PATCH", path, data=json.dumps(body))


def get_anthropic_client():
    require_env("ANTHROPIC_API_KEY", ANTHROPIC_API_KEY)
    from anthropic import Anthropic

    return Anthropic(api_key=ANTHROPIC_API_KEY)
