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


def api_get(path: str, params: dict | None = None) -> Any:
    resp = requests.get(f"{APP_BASE_URL}{path}", headers=_headers(), params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def api_post(path: str, body: dict) -> Any:
    resp = requests.post(f"{APP_BASE_URL}{path}", headers=_headers(), data=json.dumps(body), timeout=30)
    if not resp.ok:
        print(f"POST {path} -> {resp.status_code}: {resp.text}", file=sys.stderr)
    resp.raise_for_status()
    return resp.json()


def api_patch(path: str, body: dict) -> Any:
    resp = requests.patch(f"{APP_BASE_URL}{path}", headers=_headers(), data=json.dumps(body), timeout=30)
    if not resp.ok:
        print(f"PATCH {path} -> {resp.status_code}: {resp.text}", file=sys.stderr)
    resp.raise_for_status()
    return resp.json()


def get_anthropic_client():
    require_env("ANTHROPIC_API_KEY", ANTHROPIC_API_KEY)
    from anthropic import Anthropic

    return Anthropic(api_key=ANTHROPIC_API_KEY)
