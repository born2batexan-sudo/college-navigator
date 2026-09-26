#!/usr/bin/env python3
"""Default-off 12-lane, bounded first-view research. Never publishes actions/certification.

Provider configuration is explicit; no household identity or authenticated campus portal is used.
All responses are proposals; the server reclassifies unsafe evidence before family display.
"""
from __future__ import annotations
import concurrent.futures as cf
import datetime as dt
import ipaddress
import json
import os
import re
import socket
import threading
import time
from urllib.parse import urlparse, urljoin
from urllib.robotparser import RobotFileParser
import requests
from bs4 import BeautifulSoup

STATES = {"verified", "not_applicable", "not_yet_published", "publication_date_unknown", "not_publicly_available", "not_found_official", "conflicting", "under_review", "withheld"}
UA = "CollegeLifecycleResearch/1.0 (+public-source-only; no login)"

class CostCeiling(Exception): pass
class Meter:
    def __init__(self, limit_cents=800):
        self.limit = limit_cents
        self.outstanding = 0.0
        self.actual = 0.0
        self.lock = threading.Lock()
    def reserve(self, cents):
        with self.lock:
            if self.outstanding + self.actual + cents > self.limit: raise CostCeiling("Attempt cost ceiling reached")
            self.outstanding += cents
    def settle(self, reserved, cents):
        with self.lock:
            self.outstanding -= reserved
            self.actual += cents
            if self.actual + self.outstanding > self.limit: raise CostCeiling("Provider actual exceeded reservation; stop work")
    @property
    def charged(self):
        # Unknown/failed provider receipts retain their full outstanding reservation.
        return min(self.limit, int(self.actual + self.outstanding + 0.999))

class PublicSources:
    """HTTPS official-host-only reader; robots failures, redirects, DNS/private IP fail closed."""
    def __init__(self, domain):
        self.domain=domain.lower().removeprefix("www.")
        self.cache={}
        self.lock=threading.Lock()
    def allowed(self, url):
        p=urlparse(url)
        host=(p.hostname or "").lower()
        if p.scheme!="https" or p.username or p.password or p.port or not (host==self.domain or host.endswith("."+self.domain)): return False
        try:
            ips=socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)
            return bool(ips) and all(ipaddress.ip_address(i[4][0]).is_global for i in ips)
        except (socket.gaierror, ValueError): return False
    def _get(self,url,timeout):
        if not self.allowed(url): return None
        try:
            with requests.get(url,headers={"User-Agent":UA,"Accept":"text/html,text/plain"},timeout=timeout,stream=True,allow_redirects=False) as r:
                if r.status_code in (301,302,303,307,308):
                    final=urljoin(url,r.headers.get("Location",""))
                    return (final,None) if final!=url and self.allowed(final) else None
                content_type=r.headers.get("Content-Type","")
                if r.status_code!=200 or not ("text/html" in content_type or "text/plain" in content_type): return None
                chunks=[]; size=0
                for chunk in r.iter_content(16384):
                    size+=len(chunk)
                    if size>1_000_000: return None
                    chunks.append(chunk)
                return url,b"".join(chunks).decode(r.encoding or "utf-8",errors="replace")
        except requests.RequestException: return None
    def fetch(self,url,timeout=6,depth=0):
        if depth>3: return None
        with self.lock:
            if url in self.cache: return self.cache[url]
        if not self.allowed(url): return None
        parsed=urlparse(url); robots=f"https://{parsed.hostname}/robots.txt"
        # Do not use requests with cookies, authorization, proxy credentials or browser sessions.
        try:
            with requests.get(robots,headers={"User-Agent":UA},timeout=timeout,allow_redirects=False) as r:
                if r.status_code!=200 or len(r.content)>250000: return None
                rp=RobotFileParser(); rp.parse(r.text.splitlines())
                if not rp.can_fetch(UA,url): return None
        except requests.RequestException: return None
        raw=self._get(url,timeout)
        if not raw: return None
        final,body=raw
        if final!=url: return self.fetch(final,timeout,depth+1)  # re-evaluate destination robots
        soup=BeautifulSoup(body,"html.parser")
        for tag in soup(["script","style","form","input","textarea","nav","footer"]): tag.decompose()
        text=" ".join(soup.stripped_strings)[:200000]
        # Never store essay/personal-statement content as source excerpts.
        if re.search(r"essay prompt|personal statement|write an essay",text,re.I): return None
        result={"url":final,"text":text}
        with self.lock: self.cache[url]=result
        return result

class Providers:
    def __init__(self,meter,deadline):
        self.meter=meter; self.deadline=deadline
        self.search_key=os.environ["BRAVE_SEARCH_API_KEY"]
        self.model_key=os.environ["ANTHROPIC_API_KEY"]
        self.model=os.environ["REQUEST_RESEARCH_MODEL"]
        self.search_cents=float(os.environ["REQUEST_SEARCH_COST_CENTS"])
        self.lane_reserved=float(os.environ["REQUEST_LANE_RESERVATION_CENTS"])
        if self.search_cents<=0 or self.lane_reserved<=self.search_cents: raise ValueError("Positive provider cost reservations required")
    def search(self,query):
        if time.monotonic()>self.deadline: return []
        self.meter.reserve(self.search_cents)
        r=requests.get("https://api.search.brave.com/res/v1/web/search",params={"q":query,"count":5},headers={"X-Subscription-Token":self.search_key,"Accept":"application/json"},timeout=8)
        r.raise_for_status(); self.meter.settle(self.search_cents,self.search_cents)
        return [x.get("url","") for x in r.json().get("web",{}).get("results",[])][:5]
    def propose(self,term,domain,checkpoints,pages):
        if time.monotonic()>self.deadline: return []
        reserved=self.lane_reserved-self.search_cents
        self.meter.reserve(reserved)
        from anthropic import Anthropic
        client=Anthropic(api_key=self.model_key,timeout=min(55,max(1,int(self.deadline-time.monotonic()))),max_retries=0)
        prompt={"term":term,"domain":domain,"checkpoints":checkpoints,"official_pages":[{"url":p["url"],"text":p["text"][:4500]} for p in pages]}
        msg=client.messages.create(model=self.model,max_tokens=4500,temperature=0,system=(
            "Return only a JSON array, one object per checkpoint with code,state,sourceUrl,quote,secondSourceUrl,secondQuote,publicationDate. "
            "Use exact quoted substrings from supplied official pages, including the exact requested term. "
            "Never invent evidence or dates. If no exact-term answer, choose not_found_official, publication_date_unknown, "
            "not_publicly_available or under_review. No admission essays or personal content. "
            "For high-risk deadlines/costs/requirements, find independently corroborating text on a second supplied page or mark under_review."),
            messages=[{"role":"user","content":json.dumps(prompt)}])
        input_price=float(os.environ["REQUEST_INPUT_CENTS_PER_MILLION"]); output_price=float(os.environ["REQUEST_OUTPUT_CENTS_PER_MILLION"])
        self.meter.settle(reserved,(msg.usage.input_tokens*input_price+msg.usage.output_tokens*output_price)/1_000_000)
        text="".join(getattr(c,"text","") for c in msg.content).strip()
        if text.startswith("```"): text=re.sub(r"^```(?:json)?|```$","",text).strip()
        value=json.loads(text)
        return value if isinstance(value,list) else []

def research_lane(domain,term,checkpoints,sources,provider,deadline):
    if time.monotonic()>deadline: return []
    lane=checkpoints[0]["domain"]
    urls=provider.search(f"site:{domain} {term} {lane} first-year official dates fees process")
    pages=[]
    for url in urls:
        if time.monotonic()>deadline or len(pages)>=3: break
        page=sources.fetch(url,timeout=min(6,max(1,deadline-time.monotonic())))
        if page: pages.append(page)
    if not pages: return [{"code":c["code"],"state":"not_found_official"} for c in checkpoints]
    proposed=provider.propose(term,domain,checkpoints,pages)
    lookup={p["url"]:p["text"][:6000] for p in pages}
    result=[]; codes={c["code"] for c in checkpoints}
    for p in proposed:
        if not isinstance(p,dict) or p.get("code") not in codes or p.get("state") not in STATES: continue
        p={k:p.get(k) for k in ("code","state","sourceUrl","quote","secondSourceUrl","secondQuote","publicationDate")}
        p["pageText"]=lookup.get(p.get("sourceUrl"),"")
        p["secondPageText"]=lookup.get(p.get("secondSourceUrl"),"")
        result.append(p)
    return result

def run_lanes(checkpoints,domain,term,provider,sources=None,budget_seconds=105):
    """Exactly 12 lifecycle lanes; timed-out/omitted codes are under review, never falsely searched."""
    by_domain={}
    for c in checkpoints: by_domain.setdefault(c["domain"],[]).append(c)
    if len(checkpoints)!=144 or len(by_domain)!=12 or any(len(x)!=12 for x in by_domain.values()): raise ValueError("Expected canonical 12x12 checkpoint index")
    sources=sources or PublicSources(domain)
    deadline=time.monotonic()+budget_seconds
    results=[]
    pool=cf.ThreadPoolExecutor(max_workers=12)
    try:
        futures=[pool.submit(research_lane,domain,term,lane,sources,provider,deadline) for lane in by_domain.values()]
        done,_=cf.wait(futures,timeout=max(0,deadline-time.monotonic()))
        for future in done:
            try: results.extend(future.result())
            except (requests.RequestException,ValueError,KeyError,CostCeiling,TimeoutError): pass
    finally: pool.shutdown(wait=False,cancel_futures=True)
    found={r["code"] for r in results}
    results.extend({"code":c["code"],"state":"under_review"} for c in checkpoints if c["code"] not in found)
    return results

def queue_api(method,path,body=None):
    base=os.environ["APP_BASE_URL"].rstrip("/")
    if not (base.startswith("https://") or base.startswith("http://localhost:")): raise ValueError("Queue API requires HTTPS outside localhost")
    headers={"Authorization":"Bearer "+os.environ["QUEUE_AGENT_API_KEY"],"Content-Type":"application/json"}
    # Bounded transport; claim is never blindly retried after an ambiguous response.
    for attempt in range(2 if path!="/api/agent/requests/claim" else 1):
        try:
            r=requests.request(method,base+path,json=body,headers=headers,timeout=(3,15))
            if r.status_code in (502,503,504) and attempt==0 and path!="/api/agent/requests/claim": continue
            r.raise_for_status()
            return r.json()
        except requests.RequestException:
            if attempt==0 and path!="/api/agent/requests/claim": continue
            raise
    raise RuntimeError("Queue API unavailable")

def main():
    if os.environ.get("REQUEST_PIPELINE_ENABLED")!="1":
        print("Request pipeline disabled; no claim or provider call."); return
    required=("APP_BASE_URL","QUEUE_AGENT_API_KEY","BRAVE_SEARCH_API_KEY","ANTHROPIC_API_KEY","REQUEST_RESEARCH_MODEL","REQUEST_SEARCH_COST_CENTS","REQUEST_LANE_RESERVATION_CENTS","REQUEST_INPUT_CENTS_PER_MILLION","REQUEST_OUTPUT_CENTS_PER_MILLION")
    for name in required:
        if not os.environ.get(name): raise RuntimeError(f"Missing explicit configuration: {name}")
    claim=queue_api("POST","/api/agent/requests/claim",{})
    if not claim.get("claimed"): print("No eligible funded job"); return
    job,school=claim["job"],claim["school"]
    meter=Meter(int(os.environ.get("REQUEST_ATTEMPT_CEILING_CENTS","800")))
    term,domain=job["term"],school["domain"]
    outcome="review"
    try:
        cps=queue_api("GET","/api/agent/requests/evidence")["checkpoints"]
        candidates=run_lanes(cps,domain,term,Providers(meter,time.monotonic()+105),budget_seconds=105)
        response=queue_api("POST","/api/agent/requests/evidence",{"unitid":school["unitid"],"term":term,"attemptId":job["attemptId"],"candidates":candidates})
        print(json.dumps({"changed":response["changed"],"counts":response["counts"],"term":term}))
    except Exception as exc:
        # A lease/retry or owner exception, never a fabricated complete view.
        outcome="failed"
        print(f"Research exception: {type(exc).__name__}; details withheld from public workflow logs")
    finally:
        queue_api("POST","/api/agent/requests/report",{"unitid":school["unitid"],"term":term,"attempt":job["attempts"],"attemptId":job["attemptId"],"outcome":outcome,"costCents":meter.charged,"note":"Partial evidence view; no automated certification" if outcome=="review" else "Provider or evidence submission exception"})

if __name__=="__main__": main()
