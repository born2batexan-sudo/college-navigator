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
        links=[]; link_labels={}
        for a in soup.find_all("a",href=True):
            link=urljoin(final,a["href"]).split("#",1)[0]
            parsed=urlparse(link)
            host=(parsed.hostname or "").lower()
            if (link not in links and parsed.scheme=="https" and not parsed.username and not parsed.password
                    and not parsed.port and (host==self.domain or host.endswith("."+self.domain))
                    and not re.search(r"essay|personal.statement|supplement|upload|login|sign.in",link,re.I)):
                links.append(link)
                link_labels[link]=" ".join(a.stripped_strings)[:160]
            if len(links)>=80: break
        for tag in soup(["nav"]): tag.decompose()
        text=" ".join(soup.stripped_strings)[:200000]
        # Forms, inputs, textareas, and essay/personal-statement links are excluded above.
        # A public policy page is not discarded merely because it states that a personal
        # statement may be required; the provider is separately forbidden to reproduce
        # applicant-authored content.
        result={"url":final,"text":text,"links":links,"linkLabels":link_labels}
        with self.lock: self.cache[url]=result
        return result

# This is intentionally a small explicit subset, not an attempt to fill 144 answers.
# A pattern identifies a directly stated fact; topical keyword matches alone do not.
# Each quote is sent through the deployed server's independent evidence gate.
EXPLICIT_CLAIMS={
    "ADM-03": (r"\b(?:application|admission|applicant)[^.!?]{0,100}\b(?:priority |early |regular )?(?:deadline|due date)\b|\b(?:priority|early|regular) application deadline\b", "date"),
    "ADM-04": (r"\b(?:application fee|fee to apply)\b", "money"),
    "ADM-05": (r"\btranscripts?\b[^.!?]{0,100}\b(?:submit|submitted|send|sent|upload|received|required)\b|\b(?:submit|submitted|send|sent|upload)\b[^.!?]{0,100}\btranscripts?\b", "process"),
    "ADM-06": (r"\b(?:SAT|ACT|test[- ]optional)\b[^.!?]{0,100}\b(?:required|optional|submit|submitted|not required)\b|\b(?:required|optional|not required)\b[^.!?]{0,100}\b(?:SAT|ACT)\b", "process"),
    "ADM-07": (r"\b(?:recommendations?|letters? of recommendation)\b[^.!?]{0,100}\b(?:required|optional|submit|submitted)\b|\b(?:required|optional|submit|submitted)\b[^.!?]{0,100}\b(?:recommendations?|letters? of recommendation)\b", "process"),
    "ADM-11": (r"\b(?:application status|applicant) portal\b[^.!?]{0,100}\b(?:check|view|monitor)\b|\b(?:check|view|monitor)\b[^.!?]{0,100}\b(?:application status|applicant) portal\b", "process"),
    "ENR-01": (r"\b(?:accept|confirm)\b[^.!?]{0,100}\b(?:admission|offer|intent to enroll)\b|\bintent to enroll\b[^.!?]{0,100}\b(?:accept|confirm|submit)\b", "process"),
    "ENR-02": (r"\b(?:enrollment|admission) deposit\b|\bdeposit\b[^.!?]{0,80}\b(?:enrollment|admission)\b", "money"),
    "ENR-03": (r"\bdeposit\b[^.!?]{0,100}\b(?:deadline|due date)\b|\b(?:deadline|due date)\b[^.!?]{0,100}\bdeposit\b", "date"),
    "ENR-06": (r"\b(?:NetID|student account)\b[^.!?]{0,100}\b(?:activate|activation|set up|create)\b|\b(?:activate|activation|set up|create)\b[^.!?]{0,100}\b(?:NetID|student account)\b", "process"),
    "ENR-08": (r"\bfinal transcript\b[^.!?]{0,100}\b(?:submit|submitted|send|sent|received|required)\b|\b(?:submit|submitted|send|sent)\b[^.!?]{0,80}\bfinal transcript\b", "process"),
    "AID-01": (r"\b(?:FAFSA|TASFA)\b[^.!?]{0,100}\b(?:required|complete|submit|submitted|file)\b|\b(?:required|submit|submitted|file)\b[^.!?]{0,100}\b(?:FAFSA|TASFA)\b", "aid"),
    "AID-03": (r"\b(?:financial aid|FAFSA|TASFA)\b[^.!?]{0,100}\b(?:priority )?(?:deadline|due date)\b|\b(?:priority )?(?:deadline|due date)\b[^.!?]{0,100}\b(?:financial aid|FAFSA|TASFA)\b", "date"),
    "HOU-01": (r"\b(?:first[- ]year|freshman)\b[^.!?]{0,100}\b(?:residency|live on campus|housing requirement)\b|\b(?:residency|live on campus)\b[^.!?]{0,100}\b(?:first[- ]year|freshman)\b", "eligibility"),
    "ACA-01": (r"\borientation\b[^.!?]{0,100}\b(?:required|requirement|must attend)\b|\b(?:required|requirement)\b[^.!?]{0,80}\borientation\b", "eligibility"),
}
CALENDAR_DATE=re.compile(r"\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d\d)?\b|\b\d{1,2}/\d{1,2}(?:/20\d\d)?\b|\b20\d\d-\d{2}-\d{2}\b",re.I)
MONEY_VALUE=re.compile(r"\$\s?\d[\d,]*(?:\.\d{2})?",re.I)
CLAIM_TOKENS=re.compile(r"\$\s?\d+(?:,\d{3})*(?:\.\d{2})?|\b20\d\d-\d\d-\d\d\b|\b\d{1,2}/\d{1,2}(?:/20\d\d)?\b|\b\d+(?:\.\d+)?%",re.I)
HIGH_RISK=re.compile(r"(?:deadline|fee|deposit|refund|waiver|insurance|residency|immunization|requirement|aid|tuition|payment|scholarship)",re.I)
TERM_SENSITIVE=re.compile(r"(?:deadline|date|fee|cost|tuition|deposit|refund|waiver|aid|scholarship|payment|amount|rate|award|opening|closing|release|decision|notification|timing|calendar|window)",re.I)
EXPLICIT_CYCLE=re.compile(r"\b(?:Fall|Spring|Summer|Winter)\s+20\d\d\b|\b20\d\d\s*[-–/]\s*20\d\d\b",re.I)
VOLATILE_VALUE=re.compile(r"\$\s?\d|\b20\d\d-\d\d-\d\d\b|\b\d{1,2}/\d{1,2}(?:/20\d\d)?\b|\b\d+(?:\.\d+)?%")
QUOTE_TERM_SENSITIVE=re.compile(r"\b(?:deadline|due date|opening|opens|fees?|costs?|tuition|deposit|refund|waiver|financial aid|FAFSA|TASFA|scholarship|payments?|releas(?:e|ed)|notification|award|calendar|timing)\b|\b\d[\d,]*(?:\.\d{2})?\s*(?:dollars|USD)\b",re.I)
# General first-year checkpoints must not inherit rules stated only for a
# distinct applicant population. Those branches remain unresolved until the
# family's intake and a population-specific checkpoint establish applicability.
RESTRICTED_APPLICABILITY=re.compile(r"\b(?:home\s*school(?:ed|er|ers|ing)?|early admission|international|transfer|graduate|readmission|re-admission|dual[- ](?:credit|enrollment)|non[- ]degree|visiting student|exchange student|military|veteran)\b",re.I)

class OfficialPublicProvider:
    """No paid calls: official links and a small set of explicit extracts only.

    A local 'verified' is merely a proposal. The server independently checks
    URL, quote inclusion, term scope and higher-risk corroboration.
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
                  "scholarships and funding":("scholarship",),
                  "housing and dining":("housing","residence","first-year"),
                  "orientation and academics":("orientation","advising")}
        terms=keywords.get(lane,tuple(w.lower() for w in lane.split() if len(w)>3))
        labels=home.get("linkLabels",{})
        matches=[link for link in home.get("links",[]) if any(w in (link+" "+labels.get(link,"")).lower() for w in terms)]
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
    @staticmethod
    def _sentences(text):
        for chunk in re.split(r"(?<=[.!?])\s+|\s*\n+",text):
            sentence=chunk.strip()
            if 12<=len(sentence)<=500: yield sentence
    @staticmethod
    def _scope(quote,title,term,kind):
        # Follow deployed request-evidence.ts evergreen exclusions; also reject
        # natural-language dates and volatile quote claims the TS regex misses.
        cycles=EXPLICIT_CYCLE.findall(quote)
        if any(c.lower()!=term.lower() for c in cycles): return "out-of-scope"
        if term in quote: return "exact-term"
        if (kind in {"date","money","aid"} or TERM_SENSITIVE.search(title)
                or VOLATILE_VALUE.search(quote) or CALENDAR_DATE.search(quote)
                or QUOTE_TERM_SENSITIVE.search(quote) or cycles):
            return "out-of-scope"
        return "evergreen"
    @staticmethod
    def _supported(kind,quote):
        if kind=="date": return bool(CALENDAR_DATE.search(quote))
        if kind=="money": return bool(MONEY_VALUE.search(quote))
        if kind=="eligibility": return bool(re.search(r"\b(?:required|requirement|must|exempt)\b",quote,re.I))
        return True
    def _find_quote(self,code,term,page,title):
        rule=EXPLICIT_CLAIMS.get(code)
        if not rule: return None
        pattern,kind=rule
        for sentence in self._sentences(page.get("text","")):
            if RESTRICTED_APPLICABILITY.search(sentence):
                continue  # do not project a special-population rule onto all first-year students
            if kind=="date" and re.search(r"\b(?:not yet (?:published|announced|posted)|to be announced|TBD|unknown)\b",sentence,re.I):
                continue  # a calendar date in a publication notice is not a deadline
            if code=="ADM-04" and not (re.search(r"\bwaiv(?:e|er|ers|ed)\b",sentence,re.I)
                                       and re.search(r"\b(?:request|apply|submit|eligible|qualify)\b",sentence,re.I)):
                continue  # a price alone does not verify the waiver process
            if code=="ADM-06" and not re.search(r"\b(?:submit|submitted|send|sent|report|via|through|self-report)\b",sentence,re.I):
                continue  # test policy alone does not establish submission method
            if (re.search(pattern,sentence,re.I) and self._supported(kind,sentence)
                    and self._scope(sentence,title,term,kind)!="out-of-scope"):
                return sentence
        return None
    @staticmethod
    def _corroboration(first,second):
        a=[m.group().replace(" ","") for m in CLAIM_TOKENS.finditer(first)]
        b=[m.group().replace(" ","") for m in CLAIM_TOKENS.finditer(second)]
        if a and b and a!=b: return "conflicting"
        if first==second or (a and b and a==b): return "verified"
        return "under_review"
    def propose(self,term,domain,checkpoints,pages):
        results=[]
        for checkpoint in checkpoints:
            code=checkpoint["code"]; title=checkpoint.get("title","")
            if code=="ADM-01":
                # Preserve the deployed exact-term and narrowly worded evergreen
                # platform rules, including a source quote when the server must
                # withhold an old-cycle candidate.
                exact=re.compile(r"\b"+re.escape(term)+r"\b.{0,120}\bfirst[- ]year\b.{0,120}\b(?:Common App(?:lication)?|Apply\s*Texas|Coalition App(?:lication)?)\b",re.I)
                platform=re.compile(r"\b(?:recommend using the Common App to apply|apply (?:using|through) (?:the )?(?:Common App(?:lication)?|Apply\s*Texas|Coalition App(?:lication)?))\b",re.I)
                candidate=next(((p,m.group()) for p in pages if (m:=exact.search(p["text"])) and len(m.group())>=12),None)
                if not candidate:
                    candidate=next(((p,s) for p in pages for s in self._sentences(p["text"]) if platform.search(s)),None)
                if not candidate: continue
                page,quote=candidate
                state="verified" if self._scope(quote,title,term,"platform")!="out-of-scope" else "under_review"
            else:
                if code not in EXPLICIT_CLAIMS: continue
                candidate=next(((p,q) for p in pages if (q:=self._find_quote(code,term,p,title))),None)
                if not candidate: continue
                page,quote=candidate; kind=EXPLICIT_CLAIMS[code][1]
                state="verified"
                second=None
                if HIGH_RISK.search(title) or kind in {"date","money","aid","eligibility"}:
                    second=next(((other,q) for other in pages if other["url"]!=page["url"]
                                 and other.get("text")!=page.get("text")
                                 and (q:=self._find_quote(code,term,other,title))),None)
                    if not second: state="under_review"
                    else: state=self._corroboration(quote,second[1])
            proposal={"code":code,"state":state,"sourceUrl":page["url"],"quote":quote}
            if code!="ADM-01" and second:
                proposal.update({"secondSourceUrl":second[0]["url"],"secondQuote":second[1]})
            results.append(proposal)
        return results

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
    lookup={p["url"]:p["text"] for p in pages}
    result=[]; codes={c["code"] for c in checkpoints}
    for p in proposed:
        if not isinstance(p,dict) or p.get("code") not in codes or p.get("state") not in STATES: continue
        p={k:p.get(k) for k in ("code","state","sourceUrl","quote","secondSourceUrl","secondQuote","publicationDate")}
        # The deployed evidence contract accepts a quote-only pageText if it is
        # the exact substring of a page we actually fetched. This avoids sending
        # unrelated page content and retains matches past the old 6,000-char cut.
        first_url,first_quote=p.get("sourceUrl"),p.get("quote")
        second_url,second_quote=p.get("secondSourceUrl"),p.get("secondQuote")
        p["pageText"]=(first_quote if isinstance(first_url,str) and isinstance(first_quote,str)
                       and first_quote in lookup.get(first_url,"") else "")
        p["secondPageText"]=(second_quote if isinstance(second_url,str) and isinstance(second_quote,str)
                             and second_quote in lookup.get(second_url,"") else "")
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
