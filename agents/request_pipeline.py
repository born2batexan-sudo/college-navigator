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
                if r.status == 200:
                    if not any(t in r.headers.get("Content-Type","").lower() for t in ("text/plain","text/html")): return None
                    chunks=[]; size=0
                    for chunk in r.stream(16384):
                        size+=len(chunk)
                        if size>250000: return None
                        chunks.append(chunk)
                    rp=RobotFileParser(); rp.parse(b"".join(chunks).decode("utf-8",errors="replace").splitlines())
                    if not rp.can_fetch(UA,url): return None
                elif r.status not in (404,410):
                    # A missing/removed robots file publishes no restrictions. Auth
                    # denials, redirects, throttles and server failures still fail closed.
                    return None
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

# Narrow, deterministic extractors: a pattern identifies a directly stated
# fact, not a likely answer. The exact entering term must occur in the quote.
# Higher-risk claims additionally need distinct, corroborating official pages.
EXPLICIT_CLAIMS={
    "ADM-01": (r"(?:apply|submit|application).{0,80}(?:Common App(?:lication)?|ApplyTexas|Coalition App(?:lication)?)|(?:Common App(?:lication)?|ApplyTexas|Coalition App(?:lication)?).{0,80}(?:apply|submit|application)", "platform"),
    "ADM-02": (r"(?:applications?|application portal).{0,100}(?:open|opens|opening|begin|begins|available)|(?:open|opening) date.{0,100}applications?", "date"),
    "ADM-03": (r"(?:application|admission|applicant).{0,100}(?:priority |early |regular )?(?:deadline|due date)|(?:priority|early|regular) application deadline", "date"),
    "ADM-04": (r"(?:application fee|fee to apply|fee waiver|application waiver)", "money"),
    "ADM-05": (r"transcripts?.{0,100}(?:submit|send|upload|received|official|unofficial)|(?:submit|send|upload).{0,100}transcripts?", "process"),
    "ADM-06": (r"(?:test[- ]optional|SAT.{0,70}ACT|ACT.{0,70}SAT).{0,100}(?:required|optional|submit|policy)|(?:SAT|ACT).{0,100}(?:not required|optional|must be submitted)", "process"),
    "ADM-07": (r"(?:recommendation|letter of recommendation).{0,100}(?:required|submit|optional)|(?:required|optional).{0,100}recommendation", "process"),
    "ADM-11": (r"(?:application status|applicant) portal.{0,100}(?:check|view|monitor|status)|(?:check|view|monitor).{0,100}(?:application status|applicant) portal", "process"),
    "ENR-01": (r"(?:accept|confirm).{0,100}(?:admission|offer|intent to enroll)|(?:intent to enroll).{0,100}(?:accept|confirm|submit)", "process"),
    "ENR-02": (r"(?:enrollment|admission) deposit|deposit.{0,80}(?:enrollment|admission)", "money"),
    "ENR-03": (r"deposit.{0,100}(?:deadline|due date)|(?:deadline|due date).{0,100}deposit", "date"),
    "ENR-04": (r"deposit.{0,100}(?:waiv|exempt)|(?:waiv|exempt).{0,100}deposit", "eligibility"),
    "ENR-05": (r"deposit.{0,100}(?:refund|refundable|nonrefundable)|(?:refund|refundable|nonrefundable).{0,100}deposit", "money"),
    "ENR-06": (r"(?:NetID|student account).{0,100}(?:activat|set up|create)|(?:activat|set up|create).{0,100}(?:NetID|student account)", "process"),
    "ENR-07": (r"admitted[- ]student.{0,80}(?:portal|checklist)|(?:portal|checklist).{0,80}admitted[- ]student", "process"),
    "ENR-08": (r"final transcript.{0,100}(?:submit|send|received|required)|(?:submit|send).{0,80}final transcript", "process"),
    "AID-01": (r"(?:FAFSA|TASFA).{0,100}(?:complete|submit|file)", "aid"),
    "AID-02": (r"(?:FAFSA|TASFA).{0,100}(?:school code|institution code)|(?:school code|institution code).{0,100}(?:FAFSA|TASFA)", "aid"),
    "AID-03": (r"(?:financial aid|FAFSA|TASFA).{0,100}(?:priority )?(?:deadline|due date)|(?:priority )?(?:deadline|due date).{0,100}(?:financial aid|FAFSA|TASFA)", "date"),
    "AID-04": (r"(?:verification|missing documents?).{0,100}(?:submit|upload|portal|checklist|financial aid)|financial aid.{0,100}(?:verification|missing documents?)", "aid"),
    "AID-05": (r"(?:financial aid|student aid).{0,80}portal|portal.{0,80}(?:financial aid|student aid)", "aid"),
    "AID-06": (r"(?:financial aid )?award.{0,100}(?:notification|available|released|received)|(?:notification|available|released).{0,80}award", "aid"),
    "AID-07": (r"(?:accept|decline).{0,100}(?:financial aid )?award|award.{0,100}(?:accept|decline)", "aid"),
    "SCH-01": (r"(?:automatic|automatically).{0,100}(?:merit )?scholarship|(?:merit )?scholarship.{0,100}automatic", "eligibility"),
    "SCH-02": (r"(?:separate|additional).{0,100}scholarship application|scholarship application.{0,100}(?:separate|additional)", "scholarship"),
    "SCH-03": (r"scholarship.{0,100}(?:priority )?(?:deadline|due date)|(?:priority )?(?:deadline|due date).{0,100}scholarship", "date"),
    "SCH-04": (r"(?:department|college)[- ](?:specific )?scholarship|scholarship.{0,100}(?:department|college)", "scholarship"),
    "BIL-01": (r"(?:tuition|mandatory fees?).{0,100}(?:schedule|rates|cost of attendance)|(?:schedule|rates).{0,100}(?:tuition|mandatory fees?)", "money"),
    "BIL-03": (r"(?:bill|payment).{0,100}(?:due date|deadline)|(?:due date|deadline).{0,100}(?:bill|payment)", "date"),
    "HOU-01": (r"(?:first[- ]year|freshman).{0,100}(?:residency|live on campus|housing requirement)|(?:residency|live on campus).{0,100}(?:first[- ]year|freshman)", "eligibility"),
    "HOU-02": (r"housing application.{0,100}(?:open|opens|opening|available)|(?:open|opening) date.{0,100}housing application", "date"),
    "HOU-03": (r"housing application fee|housing prepayment|housing deposit", "money"),
    "HOU-04": (r"housing.{0,100}(?:priority|room selection).{0,100}(?:deadline|cutoff)|(?:deadline|cutoff).{0,100}(?:housing|room selection)", "date"),
    "HLT-01": (r"(?:immunization|vaccination).{0,100}(?:required|requirement|must submit)|(?:required|requirement).{0,80}(?:immunization|vaccination)", "eligibility"),
    "HLT-03": (r"(?:health|immunization|compliance).{0,100}(?:deadline|due date)|(?:deadline|due date).{0,100}(?:health|immunization|compliance)", "date"),
    "ACA-01": (r"orientation.{0,100}(?:required|requirement|must attend)|(?:required|requirement).{0,80}orientation", "eligibility"),
    "ACA-02": (r"orientation registration.{0,100}(?:open|opens|opening|available)|(?:open|opening) date.{0,100}orientation registration", "date"),
    "ACA-03": (r"orientation.{0,100}(?:sessions?|dates?|format|in person|virtual)", "date"),
    "GRK-02": (r"(?:recruitment|registration).{0,100}(?:open|opens|opening)|(?:open|opening) date.{0,100}(?:recruitment|registration)", "date"),
    "GRK-03": (r"(?:recruitment|registration).{0,100}(?:deadline|due date)|(?:deadline|due date).{0,100}(?:recruitment|registration)", "date"),
    "GRK-05": (r"(?:eligib|minimum GPA|GPA requirement).{0,100}(?:GPA|grade point|requirement)|(?:GPA|grade point).{0,100}(?:eligib|minimum|requirement)", "eligibility"),
    "FAM-06": (r"(?:parent|family) weekend.{0,100}(?:date|Fall|Spring|Summer|Winter)|(?:date|Fall|Spring|Summer|Winter).{0,100}(?:parent|family) weekend", "date"),
}
CALENDAR_DATE=re.compile(r"\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d\d)?\b|\b\d{1,2}/\d{1,2}(?:/20\d\d)?\b|\b20\d\d-\d{2}-\d{2}\b",re.I)
MONEY_VALUE=re.compile(r"(?:\$\s?\d[\d,]*(?:\.\d{2})?|\bfree\b|\bno (?:application )?fee\b)",re.I)
CLAIM_TOKENS=re.compile(r"\$\s?\d+(?:,\d{3})*(?:\.\d{2})?|\b20\d\d-\d\d-\d\d\b|\b\d{1,2}/\d{1,2}(?:/20\d\d)?\b|\b\d+(?:\.\d+)?%",re.I)
CORROBORATION_TITLE=re.compile(r"(?:deadline|fee|deposit|refund|waiver|insurance|residency|immunization|requirement|aid|tuition|payment|scholarship|eligib)",re.I)
TERM_SENSITIVE_TITLE=re.compile(r"(?:deadline|date|fee|cost|tuition|deposit|refund|waiver|aid|scholarship|payment|amount|rate|award|opening|closing|release|decision|notification|timing|calendar|window)",re.I)
EXPLICIT_CYCLE=re.compile(r"\b(?:Fall|Spring|Summer|Winter)\s+20\d\d\b|\b20\d\d\s*[-–/]\s*20\d\d\b",re.I)
VOLATILE_VALUE=re.compile(r"\$\s?\d|\b20\d\d-\d\d-\d\d\b|\b\d{1,2}/\d{1,2}(?:/20\d\d)?\b|\b\d+(?:\.\d+)?%")

# Free discovery is shared across the 12 parallel lifecycle lanes. It only follows
# public HTTPS links found on official pages; PublicSources applies robots, DNS/IP,
# redirect, TLS, content-type, and size checks on every fetch.
LANE_KEYWORDS={
    "admissions":("admissions","admission","apply","application","undergraduate","first-year","freshman","deadline"),
    "admission to enrollment":("admitted","enroll","enrollment","accept","deposit","new student","next steps"),
    "financial aid":("financial aid","student aid","fafsa","tasfa","grants","aid","verification"),
    "scholarships and funding":("scholarship","funding","merit","financial awards"),
    "tuition billing 529":("tuition","bursar","billing","student accounts","payment","fees","cost of attendance","529"),
    "housing and dining":("housing","residence","residential","dining","meal plan","room selection"),
    "health compliance access":("health","immunization","vaccination","insurance","compliance","student health"),
    "orientation and academics":("orientation","academic","advising","registration","course","new student program"),
    "campus logistics":("parking","transport","transit","technology","student id","campus map","transportation"),
    "greek and student life":("greek","fraternity","sorority","recruitment","student life","involvement","clubs"),
    "family and campus experience":("family","parent","visitor","weekend","parents and families"),
    "career and progression":("career","internship","research","graduation","career center"),
}
DISCOVERY_HUB_WORDS=("student","students","academics","campus life","resources","offices","families","parents","admitted","services","life")
MAX_DISCOVERY_PAGES=32
MAX_DISCOVERY_DEPTH=2
MAX_DISCOVERY_WORKERS=4
MAX_DISCOVERY_SECONDS=28
DISCOVERY_FETCH_TIMEOUT=1.8
MAX_LANE_PAGES=5
UNSAFE_PUBLIC_PATH=re.compile(r"essay|personal[.-]?statement|supplement|upload|login|sign[.-]?in|(?:^|[/_.-])grad(?:uate|school)(?:[/_.-]|$)",re.I)

def _approved_public_url(url,domain):
    """Structural allowlist; PublicSources additionally verifies public DNS on fetch."""
    try:
        parsed=urlparse(url); host=(parsed.hostname or "").lower()
        approved=domain.lower().removeprefix("www.")
        return (parsed.scheme=="https" and not parsed.username and not parsed.password and not parsed.port
                and not parsed.fragment and (host==approved or host.endswith("."+approved))
                and not UNSAFE_PUBLIC_PATH.search(f"{host}{parsed.path}"))
    except ValueError:
        return False

def _term_match(term,text):
    term=re.sub(r"[-_]+"," ",term.lower()).strip()
    text=re.sub(r"[-_]+"," ",text.lower())
    if " " in term: return term in text
    return bool(re.search(r"\b"+re.escape(term)+r"\b",text))

class OfficialPublicProvider:
    """Bounded unpaid official-site discovery plus conservative deterministic extracts.

    One shared two-hop catalog prevents twelve lanes from independently crawling the
    same home page. Evergreen policy/process claims still require explicit entering-term
    language because the independent server resolver requires that term in page and quote;
    volatile dates, amounts, aid, eligibility, and scholarships additionally need a second
    distinct official-page corroboration before they can be proposed as verified.
    """
    paid=False
    def __init__(self,sources,deadline):
        self.sources=sources; self.deadline=deadline
        self._index=None
        self._index_lock=threading.Lock()
    def _discovery_score(self,url,label=""):
        content=f"{url} {label}".lower().replace("_"," ").replace("-"," ")
        score=0
        for terms in LANE_KEYWORDS.values():
            matches=sum(1 for term in terms if _term_match(term,content))
            if matches: score+=4+min(matches,3)
        if not score and any(_term_match(word,content) for word in DISCOVERY_HUB_WORDS): score=1
        return score
    def _discover(self):
        with self._index_lock:
            if self._index is not None: return self._index
            end=min(self.deadline,time.monotonic()+MAX_DISCOVERY_SECONDS)
            domain=self.sources.domain
            roots=[f"https://{domain}/"]
            www=f"https://www.{domain}/"
            if www!=roots[0]: roots.append(www)
            queue=[{"url":u,"label":"","depth":0} for u in roots if _approved_public_url(u,domain)]
            queued={item["url"] for item in queue}; attempted=set(); pages=[]; fetched_count=0
            pool=cf.ThreadPoolExecutor(max_workers=MAX_DISCOVERY_WORKERS)
            try:
                while queue and fetched_count<MAX_DISCOVERY_PAGES and time.monotonic()<end:
                    queue.sort(key=lambda x:(-self._discovery_score(x["url"],x["label"]),x["depth"],x["url"]))
                    batch=[]
                    while queue and len(batch)<MAX_DISCOVERY_WORKERS and fetched_count+len(batch)<MAX_DISCOVERY_PAGES:
                        item=queue.pop(0)
                        if item["url"] not in attempted:
                            attempted.add(item["url"]); batch.append(item)
                    if not batch: break
                    futures={pool.submit(self.sources.fetch,item["url"],
                                timeout=min(DISCOVERY_FETCH_TIMEOUT,max(.2,end-time.monotonic()))):item for item in batch}
                    done,pending=cf.wait(futures,timeout=max(0,end-time.monotonic()))
                    fetched_count+=len(batch)
                    for future in done:
                        item=futures[future]
                        try: page=future.result()
                        except (requests.RequestException,ValueError,KeyError,TimeoutError,OSError): page=None
                        if not page or not isinstance(page,dict): continue
                        page_url=page.get("url",item["url"])
                        if not _approved_public_url(page_url,domain): continue
                        pages.append({"fetchUrl":item["url"],"page":page,"label":item["label"],"depth":item["depth"]})
                        if item["depth"]>=MAX_DISCOVERY_DEPTH or time.monotonic()>=end: continue
                        labels=page.get("linkLabels",{})
                        for link in page.get("links",[]):
                            if (not isinstance(link,str) or not _approved_public_url(link,domain)
                                    or link in queued or link in attempted): continue
                            queued.add(link)
                            queue.append({"url":link,"label":str(labels.get(link,""))[:160],"depth":item["depth"]+1})
                    # A timed-out fetch may continue briefly; do not block the request budget.
                    for future in pending: future.cancel()
            finally:
                pool.shutdown(wait=False,cancel_futures=True)
            self._index=pages
            return self._index
    def search_lane(self,query,lane):
        if time.monotonic()>=self.deadline: return []
        pages=self._discover()
        if not pages: return []
        terms=LANE_KEYWORDS.get(lane.lower(),tuple(w.lower() for w in lane.split() if len(w)>3))
        def score(item):
            page=item["page"]
            url_label=f"{item['fetchUrl']} {item['label']}".lower().replace("_"," ").replace("-"," ")
            page_text=str(page.get("text",""))[:6000].lower()
            link_score=sum(1 for term in terms if _term_match(term,url_label))
            body_score=sum(1 for term in terms if _term_match(term,page_text))
            return link_score*4+min(body_score,4)
        ranked=sorted(pages,key=lambda item:(-score(item),item["depth"],item["fetchUrl"]))
        matching=[item for item in ranked if score(item)>0]
        chosen=matching[:MAX_LANE_PAGES]
        # Keep a root fallback when fewer than five topic pages were found; otherwise
        # spend the per-lane page budget on the more specific official pages.
        root=next((item for item in ranked if item["depth"]==0),None)
        if root and root not in chosen and len(chosen)<MAX_LANE_PAGES: chosen.insert(0,root)
        if not chosen and root: chosen=[root]
        return list(dict.fromkeys(item["fetchUrl"] for item in chosen))[:MAX_LANE_PAGES]
    def search(self,query):
        # Backwards-compatible call shape for tests/callers; production supplies the
        # checkpoint domain explicitly through search_lane to handle multiword lanes.
        suffix=" first-year official dates fees process"
        body=query[:-len(suffix)] if query.endswith(suffix) else query
        lane=next((name for name in sorted(LANE_KEYWORDS,key=len,reverse=True) if body.lower().endswith(name)),None)
        return self.search_lane(query,lane or body.split()[-1])
    @staticmethod
    def _sentences(text):
        for chunk in re.split(r"(?<=[.!?])\s+|\s*\n+",text):
            quote=chunk.strip()
            if 12<=len(quote)<=500:
                yield quote
    @staticmethod
    def _kind_supported(kind,quote):
        if kind=="date": return bool(CALENDAR_DATE.search(quote))
        if kind=="money": return bool(MONEY_VALUE.search(quote) or re.search(r"\b(?:refundable|nonrefundable|refunded|refund)\b",quote,re.I))
        if kind=="aid": return bool(re.search(r"\b(?:FAFSA|TASFA|financial aid|student aid|award)\b",quote,re.I))
        if kind=="scholarship": return bool(re.search(r"scholarship",quote,re.I))
        if kind=="eligibility": return bool(re.search(r"\b(?:eligible|eligibility|requirement|required|must|GPA|waiv(?:ed|er)|exempt|automatic(?:ally)?|consideration)\b",quote,re.I))
        return True
    def _find_quote(self,code,term,page,title=""):
        rule=EXPLICIT_CLAIMS.get(code)
        if not rule: return None
        pattern,kind=rule; pattern=re.compile(pattern,re.I)
        for sentence in self._sentences(page.get("text","")):
            if not pattern.search(sentence) or not self._kind_supported(kind,sentence):
                continue
            exact_term=term in sentence
            evergreen=(not TERM_SENSITIVE_TITLE.search(title)
                       and not VOLATILE_VALUE.search(sentence)
                       and not EXPLICIT_CYCLE.search(sentence))
            if exact_term or evergreen:
                return sentence
        return None
    @staticmethod
    def _corroboration(first,second):
        a=[m.group(0).replace(" ","") for m in CLAIM_TOKENS.finditer(first)]
        b=[m.group(0).replace(" ","") for m in CLAIM_TOKENS.finditer(second)]
        if a and b and a!=b: return "conflicting"
        if first==second or (a and b and a==b): return "verified"
        return "under_review"
    def propose(self,term,domain,checkpoints,pages):
        results=[]
        for checkpoint in checkpoints:
            code=checkpoint["code"]
            title=checkpoint.get("title","")
            primary=next(((page,quote) for page in pages if (quote:=self._find_quote(code,term,page,title))),None)
            if not primary: continue
            page,quote=primary
            kind=EXPLICIT_CLAIMS[code][1]
            claim_needs_second=(CORROBORATION_TITLE.search(checkpoint.get("title","")) is not None
                                or kind in {"date","money","eligibility","aid","scholarship"})
            proposal={"code":code,"state":"verified","sourceUrl":page["url"],"quote":quote}
            if claim_needs_second:
                second=next(((other,other_quote) for other in pages if other["url"]!=page["url"]
                             and other.get("text")!=page.get("text")
                             and (other_quote:=self._find_quote(code,term,other,title))),None)
                if second:
                    other,other_quote=second
                    proposal.update({"state":self._corroboration(quote,other_quote),
                                     "secondSourceUrl":other["url"],"secondQuote":other_quote})
                else:
                    proposal["state"]="under_review"
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
            "Use exact quoted substrings from supplied official pages, including the exact requested term. "
            "Never invent evidence or dates. If no exact-term answer, choose not_found_official, publication_date_unknown, "
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
    query=f"site:{domain} {term} {lane} first-year official dates fees process"
    urls=(provider.search_lane(query,lane) if hasattr(provider,"search_lane") else provider.search(query))
    pages=[]
    for url in urls:
        if time.monotonic()>deadline or len(pages)>=5: break
        page=sources.fetch(url,timeout=min(6,max(1,deadline-time.monotonic())))
        if page: pages.append(page)
    if not pages: return [{"code":c["code"],"state":"not_found_official" if getattr(provider,"paid",True) and time.monotonic()<deadline else "under_review"} for c in checkpoints]
    proposed=provider.propose(term,domain,checkpoints,pages)
    lookup={p["url"]:p["text"] for p in pages}  # validate any located quote; only the quote itself is submitted
    result=[]; codes={c["code"] for c in checkpoints}
    for p in proposed:
        if not isinstance(p,dict) or p.get("code") not in codes or p.get("state") not in STATES: continue
        p={k:p.get(k) for k in ("code","state","sourceUrl","quote","secondSourceUrl","secondQuote","publicationDate")}
        if not isinstance(p.get("sourceUrl"),str) or not isinstance(p.get("quote"),str):
            p["state"]="under_review"; p["sourceUrl"]=None; p["quote"]=None
        if not isinstance(p.get("secondSourceUrl"),str) or not isinstance(p.get("secondQuote"),str):
            p["secondSourceUrl"]=None; p["secondQuote"]=None
        if not isinstance(p.get("publicationDate"),str): p["publicationDate"]=None
        source_text=lookup.get(p.get("sourceUrl"),"")
        p["pageText"]=p["quote"] if p.get("quote") and p["quote"] in source_text else ""
        second_text=lookup.get(p.get("secondSourceUrl"),"")
        p["secondPageText"]=p["secondQuote"] if p.get("secondQuote") and p["secondQuote"] in second_text else ""
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
