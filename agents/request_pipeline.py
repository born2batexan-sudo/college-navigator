#!/usr/bin/env python3
"""Default-off 12-lane, bounded first-view research. Never publishes actions/certification.

Provider configuration is explicit; no household identity or authenticated campus portal is used.
All responses are proposals; the server reclassifies unsafe evidence before family display.
"""
from __future__ import annotations
import concurrent.futures as cf
from contextlib import contextmanager
import ipaddress
import json
import math
import os
import re
import socket
import threading
import time
from urllib.parse import urlparse, urljoin
from urllib.parse import urlunparse
from urllib.robotparser import RobotFileParser
import requests
import urllib3
from bs4 import BeautifulSoup

STATES = {"verified", "not_applicable", "not_yet_published", "publication_date_unknown", "not_publicly_available", "not_found_official", "conflicting", "under_review", "withheld"}
UA = "CollegeLifecycleResearch/1.0 (+public-source-only; no login)"
MAX_MODEL_INPUT_BYTES=65000
MAX_MODEL_OUTPUT_TOKENS=4500

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
        # Public fetches pin the validated public IP, avoiding DNS rebinding and
        # environment proxies; cookies and authenticated sessions are never used.
    def _public_ip(self,url):
        try:
            p=urlparse(url)
            host=(p.hostname or "").lower()
            if (p.scheme!="https" or p.username or p.password or p.port or p.fragment or
                    not (host==self.domain or host.endswith("."+self.domain))): return None
            ips=socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)
            if not ips or not all(ipaddress.ip_address(i[4][0]).is_global for i in ips): return None
            return ips[0][4][0]
        except (socket.gaierror,ValueError): return None
    def allowed(self,url):
        return self._public_ip(url) is not None
    @contextmanager
    def _open(self,url,timeout,accept="text/html,text/plain"):
        # Connect to the *validated* address, with TLS SNI/cert check against the
        # actual official host. No second DNS resolution, proxy, or redirect.
        ip=self._public_ip(url)
        if not ip: raise ValueError("Non-public or off-domain source")
        parsed=urlparse(url); host=parsed.hostname
        pool=urllib3.HTTPSConnectionPool(ip,443,assert_hostname=host,server_hostname=host,
            timeout=urllib3.Timeout(connect=timeout,read=timeout),retries=False)
        path=urlunparse(("","",parsed.path or "/",parsed.params,parsed.query,""))
        try:
            response=pool.urlopen("GET",path,headers={"Host":host,"User-Agent":UA,"Accept":accept},
                                  preload_content=False,redirect=False,retries=False)
            try: yield response
            finally: response.close()
        finally: pool.close()
    def _get(self,url,timeout):
        if not self.allowed(url): return None
        try:
            with self._open(url,timeout) as r:
                if r.status in (301,302,303,307,308):
                    final=urljoin(url,r.headers.get("Location",""))
                    return (final,None) if final!=url and self.allowed(final) else None
                content_type=r.headers.get("Content-Type","")
                if r.status!=200 or not ("text/html" in content_type or "text/plain" in content_type): return None
                chunks=[]; size=0
                for chunk in r.stream(16384):
                    size+=len(chunk)
                    if size>1_000_000: return None
                    chunks.append(chunk)
                return url,b"".join(chunks).decode("utf-8",errors="replace")
        except (urllib3.exceptions.HTTPError,ValueError,OSError): return None
    def fetch(self,url,timeout=6,depth=0):
        if depth>3: return None
        with self.lock:
            if url in self.cache: return self.cache[url]
        if not self.allowed(url): return None
        parsed=urlparse(url); robots=f"https://{parsed.hostname}/robots.txt"
        # Do not use requests with cookies, authorization, proxy credentials or browser sessions.
        try:
            with self._open(robots,timeout,accept="text/plain") as r:
                if r.status!=200 or not any(t in r.headers.get("Content-Type","").lower() for t in ("text/plain","text/html")): return None
                chunks=[]; size=0
                for chunk in r.stream(16384):
                    size+=len(chunk)
                    if size>250000: return None
                    chunks.append(chunk)
                rp=RobotFileParser(); rp.parse(b"".join(chunks).decode("utf-8",errors="replace").splitlines())
                if not rp.can_fetch(UA,url): return None
        except (urllib3.exceptions.HTTPError,ValueError,OSError): return None
        raw=self._get(url,timeout)
        if not raw: return None
        final,body=raw
        if final!=url: return self.fetch(final,timeout,depth+1)  # re-evaluate destination robots
        soup=BeautifulSoup(body,"html.parser")
        for tag in soup(["script","style","form","input","textarea","footer"]): tag.decompose()
        links=[]
        for a in soup.find_all("a",href=True):
            link=urljoin(final,a["href"]).split("#",1)[0]
            parsed=urlparse(link)
            host=(parsed.hostname or "").lower()
            if (link not in links and parsed.scheme=="https" and not parsed.username and not parsed.password
                    and not parsed.port and (host==self.domain or host.endswith("."+self.domain))
                    and not re.search(r"essay|personal.statement|supplement|upload|login|sign.in",link,re.I)):
                links.append(link)
            if len(links)>=80: break
        for tag in soup(["nav"]): tag.decompose()
        text=" ".join(soup.stripped_strings)[:200000]
        # Forms, inputs, textareas, and essay/personal-statement links are excluded above.
        # A public policy page is not discarded merely because it states that a personal
        # statement may be required; the provider is separately forbidden to reproduce
        # applicant-authored content.
        result={"url":final,"text":text,"links":links}
        with self.lock: self.cache[url]=result
        return result

class OfficialPublicProvider:
    """No paid discovery/model calls. Shallow, bounded official-link crawl only.

    The extractive rules are deliberately narrow: an exact-term first-year
    application platform or an evergreen official application-platform sentence
    with no competing cycle/date/cost claim. Everything else remains under_review;
    lack of pages is not proof a college did not publish them.
    """
    paid=False
    def __init__(self,sources,deadline):
        self.sources=sources; self.deadline=deadline
    def search(self,query):
        if time.monotonic()>=self.deadline: return []
        home=None
        for root in (f"https://{self.sources.domain}/",f"https://www.{self.sources.domain}/"):
            home=self.sources.fetch(root,timeout=min(5,max(1,self.deadline-time.monotonic())))
            if home: break
        if not home: return []
        lane=query.split(" ",3)[3].split(" first-year official dates fees process")[0].lower()
        keywords={"admissions":("admission","apply","undergraduate"),
                  "admission to enrollment":("admitted","enroll"),
                  "financial aid":("financial","aid","fafsa"),
                  "scholarships and funding":("scholarship",)}
        terms=keywords.get(lane,tuple(w.lower() for w in lane.split() if len(w)>3))
        matches=[link for link in home.get("links",[]) if any(w in link.lower() for w in terms)]
        matches.sort(key=lambda link:(bool(re.search(r"visit|tour|news|research",link,re.I)),
                                      0 if re.search(r"/apply(?:/|$)|first[-_]?year|freshm",link,re.I) else 1,
                                      len(urlparse(link).path)))
        deep=[]
        if lane=="admissions":
            for link in matches[:3]:
                if time.monotonic()>=self.deadline: break
                landing=self.sources.fetch(link,timeout=min(5,max(1,self.deadline-time.monotonic())))
                if not landing: continue
                for child in landing.get("links",[]):
                    if re.search(r"first[-_]?year|freshm|/apply/(?!certificates?\b)",child,re.I) and child not in deep:
                        deep.append(child)
        ordered=[]
        for link in deep+matches+[home["url"]]:
            if link not in ordered: ordered.append(link)
        return ordered[:5]
    def propose(self,term,domain,checkpoints,pages):
        if checkpoints[0]["domain"]!="Admissions": return []
        exact=re.compile(r"\b"+re.escape(term)+r"\b.{0,120}\bfirst[- ]year\b.{0,120}\b(?:Common App(?:lication)?|Apply\s*Texas|Coalition App(?:lication)?)\b",re.I)
        platform=re.compile(r"\b(?:recommend using the Common App to apply|apply (?:using|through) (?:the )?(?:Common App(?:lication)?|Apply\s*Texas|Coalition App(?:lication)?))\b",re.I)
        for page in pages:
            match=exact.search(page["text"])
            if match and len(match.group())>=12:
                return [{"code":"ADM-01","state":"verified","sourceUrl":page["url"],"quote":match.group()}]
        for page in pages:
            for sentence in re.split(r"(?<=[.!?])\s+",page["text"]):
                if 12<=len(sentence)<=500 and platform.search(sentence):
                    return [{"code":"ADM-01","state":"verified","sourceUrl":page["url"],"quote":sentence}]
        return []

def official_search_urls(message,domain):
    """Extract only HTTPS URLs on the approved school domain from Anthropic search blocks/citations."""
    approved=domain.lower().removeprefix("www.")
    urls=[]
    def field(value, name):
        return value.get(name) if isinstance(value, dict) else getattr(value, name, None)
    def add(raw):
        try:
            parsed=urlparse(str(raw)); host=(parsed.hostname or "").lower()
            if (parsed.scheme=="https" and not parsed.username and not parsed.password and not parsed.port
                    and (host==approved or host.endswith("."+approved))):
                value=parsed._replace(fragment="").geturl()
                if value not in urls: urls.append(value)
        except ValueError: pass
    for block in getattr(message,"content",[]):
        if getattr(block,"type",None)=="web_search_tool_result":
            content=getattr(block,"content",[])
            if isinstance(content,list):
                for result in content: add(field(result,"url"))
        if getattr(block,"type",None)=="text":
            for citation in getattr(block,"citations",[]) or []: add(field(citation,"url"))
    return urls[:5]

class Providers:
    paid=True
    def __init__(self,meter,deadline,domain):
        self.meter=meter; self.deadline=deadline
        self.domain=domain.lower().removeprefix("www.")
        self.model_key=os.environ["ANTHROPIC_API_KEY"]
        self.model=os.environ["REQUEST_RESEARCH_MODEL"]
        self.search_cents=float(os.environ["REQUEST_SEARCH_COST_CENTS"])
        self.lane_reserved=float(os.environ["REQUEST_LANE_RESERVATION_CENTS"])
        self.input_price=float(os.environ["REQUEST_INPUT_CENTS_PER_MILLION"])
        self.output_price=float(os.environ["REQUEST_OUTPUT_CENTS_PER_MILLION"])
        if self.search_cents<=0 or self.lane_reserved<=self.search_cents: raise ValueError("Positive provider cost reservations required")
    def _usage_cost(self,msg,include_search=False):
        searches=getattr(getattr(msg.usage,"server_tool_use",None),"web_search_requests",0) or 0
        tool_cost=searches if include_search else 0  # Anthropic web search: 1 cent/use at approved 2026-09-28 price.
        return (msg.usage.input_tokens*self.input_price+msg.usage.output_tokens*self.output_price)/1_000_000+tool_cost
    def search(self,query):
        if time.monotonic()>self.deadline: return []
        self.meter.reserve(self.search_cents)
        from anthropic import Anthropic
        client=Anthropic(api_key=self.model_key,timeout=min(35,max(1,int(self.deadline-time.monotonic()))),max_retries=0)
        msg=client.messages.create(model=self.model,max_tokens=800,system=(
            "Use web search. Return a concise answer grounded only in current official pages on the allowed university domain. "
            "Find up to three pages most likely to contain exact entering-term first-year dates, requirements, fees, or process details. "
            "Never search for or reproduce essays, personal statements, login-only pages, or applicant personal data."),
            messages=[{"role":"user","content":query}],tools=[{"type":"web_search_20260318","name":"web_search","max_uses":2,
            "allowed_domains":[self.domain],"allowed_callers":["direct"]}])
        self.meter.settle(self.search_cents,self._usage_cost(msg,include_search=True))
        return official_search_urls(msg,self.domain)
    def propose(self,term,domain,checkpoints,pages):
        if time.monotonic()>self.deadline: return []
        prompt={"term":term,"domain":domain,"checkpoints":checkpoints,"official_pages":[{"url":p["url"],"text":p["text"][:4500]} for p in pages]}
        prompt_json=json.dumps(prompt,ensure_ascii=True)
        if len(prompt_json.encode("utf-8"))>MAX_MODEL_INPUT_BYTES: return []
        reserved=self.lane_reserved-self.search_cents
        self.meter.reserve(reserved)
        from anthropic import Anthropic
        client=Anthropic(api_key=self.model_key,timeout=min(55,max(1,int(self.deadline-time.monotonic()))),max_retries=0)
        msg=client.messages.create(model=self.model,max_tokens=MAX_MODEL_OUTPUT_TOKENS,system=(
            "Return only a JSON array, one object per checkpoint with code,state,sourceUrl,quote,secondSourceUrl,secondQuote,publicationDate. "
            "Use exact quoted substrings from supplied official pages. The exact requested term is mandatory for dates, deadlines, "
            "fees, costs, aid, scholarships, deposits, payment amounts, release timing, and any quote that names an academic cycle. "
            "A non-date/non-financial policy or process may use an evergreen quote only when that quote names no other cycle, date, cost, or percentage. "
            "Never invent evidence or dates. If the required scope is absent, choose not_found_official, publication_date_unknown, "
            "not_publicly_available or under_review. No admission essays or personal content. "
            "For high-risk deadlines/costs/requirements, find independently corroborating text on a second supplied page or mark under_review."),
            messages=[{"role":"user","content":prompt_json}])
        self.meter.settle(reserved,self._usage_cost(msg))
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
    if not pages: return [{"code":c["code"],"state":"not_found_official" if getattr(provider,"paid",True) and time.monotonic()<deadline else "under_review"} for c in checkpoints]
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
        done,pending=cf.wait(futures,timeout=max(0,deadline-time.monotonic()))
        provider.unfinished=bool(pending)
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
    # No environment proxy, cookies, redirect, or blind retry of ambiguous claims.
    with requests.Session() as session:
        session.trust_env=False
        for attempt in range(2 if path!="/api/agent/requests/claim" else 1):
            try:
                r=session.request(method,base+path,json=body,headers=headers,timeout=(3,15),allow_redirects=False)
                if r.status_code in (502,503,504) and attempt==0 and path!="/api/agent/requests/claim": continue
                r.raise_for_status()
                if r.status_code>=300: raise RuntimeError("Queue API redirected; refusing response")
                return r.json()
            except requests.RequestException:
                if attempt==0 and path!="/api/agent/requests/claim": continue
                raise
    raise RuntimeError("Queue API unavailable")

def validate_budget_config(paid=False):
    """Fail before a claim if local ceilings cannot fit the server reservation."""
    try:
        ceiling=int(os.environ["REQUEST_ATTEMPT_CEILING_CENTS"])
        job=int(os.environ["REQUEST_JOB_ESTIMATE_CENTS"])
        if not (0<ceiling<=job<=1_000_000): raise ValueError()
        if paid:
            search=float(os.environ["REQUEST_SEARCH_COST_CENTS"])
            lane=float(os.environ["REQUEST_LANE_RESERVATION_CENTS"])
            input_price=float(os.environ["REQUEST_INPUT_CENTS_PER_MILLION"])
            output_price=float(os.environ["REQUEST_OUTPUT_CENTS_PER_MILLION"])
            if (not all(math.isfinite(x) and x>0 for x in (search,lane,input_price,output_price))
                    or not (0<search<lane) or math.ceil(12*lane)>ceiling
                    or lane-search < math.ceil(((MAX_MODEL_INPUT_BYTES+2000)*input_price
                                                    +MAX_MODEL_OUTPUT_TOKENS*output_price)/1_000_000)):
                raise ValueError()
    except (KeyError, ValueError) as exc:
        raise ValueError("Explicit numeric request budgets required; paid twelve-lane reservations must fit attempt and server job ceilings") from exc


def preflight():
    """An explicit staging-only allowlist is checked before even reading the queue."""
    if os.environ.get("REQUEST_WORKER_STAGE")!="staging":
        raise ValueError("Worker stage must explicitly be staging")
    base=os.environ.get("APP_BASE_URL","").rstrip("/")
    stage=os.environ.get("REQUEST_STAGING_APP_ORIGIN","").rstrip("/")
    production=os.environ.get("REQUEST_PRODUCTION_APP_ORIGIN","").rstrip("/")
    parsed=urlparse(base)
    prod_parsed=urlparse(production)
    if (not stage or not production or stage==production or base!=stage or parsed.scheme!="https"
            or not parsed.hostname or parsed.username or parsed.password or parsed.port
            or parsed.path or parsed.query or parsed.fragment
            or prod_parsed.scheme!="https" or not prod_parsed.hostname or prod_parsed.username
            or prod_parsed.password or prod_parsed.port or prod_parsed.path or prod_parsed.query
            or prod_parsed.fragment or prod_parsed.hostname.lower()==parsed.hostname.lower()
            or not os.environ.get("QUEUE_AGENT_API_KEY")):
        raise ValueError("Explicit HTTPS staging origin and distinct production origin required before queue access")
    flag=os.environ.get("REQUEST_PAID_PROVIDERS_ENABLED","0")
    if flag not in ("0","1"): raise ValueError("Paid-provider gate must be 0 or 1")
    paid=flag=="1"
    if paid:
        for name in ("ANTHROPIC_API_KEY","REQUEST_RESEARCH_MODEL"):
            if not os.environ.get(name): raise ValueError(f"Paid provider configuration missing: {name}")
    validate_budget_config(paid)
    return paid


def main():
    if os.environ.get("REQUEST_PIPELINE_ENABLED")!="1":
        print("Request pipeline disabled; no claim or provider call."); return
    paid=preflight()
    claim=queue_api("POST","/api/agent/requests/claim",{})
    if not claim.get("claimed"): print("No eligible funded job"); return
    job,school=claim["job"],claim["school"]
    meter=Meter(int(os.environ["REQUEST_ATTEMPT_CEILING_CENTS"]))
    outcome="failed"
    provider=None
    try:
        term,domain=job["term"],school["domain"]
        if not re.fullmatch(r"\d+",str(school["unitid"])) or not re.fullmatch(r"(?:Fall|Spring|Summer|Winter) 20\d\d",term):
            raise ValueError("Invalid claimed school or term")
        sources=PublicSources(domain)
        if not sources.domain or sources.domain in ("localhost","127.0.0.1"):
            raise ValueError("No approved public institutional domain")
        cps=queue_api("GET","/api/agent/requests/evidence")["checkpoints"]
        deadline=time.monotonic()+105
        provider=Providers(meter,deadline,domain) if paid else OfficialPublicProvider(sources,deadline)
        candidates=run_lanes(cps,domain,term,provider,sources=sources,budget_seconds=105)
        response=queue_api("POST","/api/agent/requests/evidence",{"unitid":school["unitid"],"term":term,"attemptId":job["attemptId"],"candidates":candidates})
        outcome="review"
        print(json.dumps({"changed":response["changed"],"counts":response["counts"],"term":term}))
    except Exception as exc:
        # Never fabricate a complete view after a provider, lease, or persistence error.
        print(f"Research exception: {type(exc).__name__}; details withheld from public workflow logs")
    finally:
        # A timed-out provider call can still settle after the lane deadline.
        # Reconcile the FULL local ceiling rather than under-reporting that race.
        cost=meter.limit if paid and provider is not None and getattr(provider,"unfinished",False) else meter.charged
        queue_api("POST","/api/agent/requests/report",{"unitid":school["unitid"],"term":job["term"],"attempt":job["attempts"],"attemptId":job["attemptId"],"outcome":outcome,"costCents":cost,"note":"Partial public evidence view; no automated certification" if outcome=="review" else "Provider or evidence submission exception"})

if __name__=="__main__": main()
