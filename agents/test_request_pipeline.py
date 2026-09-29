import os
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import patch
sys.path.insert(0,os.path.dirname(__file__))
from request_pipeline import Meter, CostCeiling, PublicSources, OfficialPublicProvider, official_search_urls, research_lane, run_lanes, validate_budget_config, main, preflight, _approved_public_url

class PipelineTest(unittest.TestCase):
    def setUp(self):
        self.checkpoints=[{"code":f"{i:02d}-{j:02d}","domain":f"Lane {i}","title":"Subject"} for i in range(12) for j in range(12)]
    def test_twelve_mocked_lanes_return_before_budget_and_resolve_missing(self):
        class Slow:
            def search(self,_): time.sleep(.15); return []
        start=time.monotonic()
        result=run_lanes(self.checkpoints,"example.edu","Fall 2027",Slow(),budget_seconds=.04)
        self.assertLess(time.monotonic()-start,.13)
        self.assertEqual(len(result),144)
        self.assertTrue(all(p["state"]=="under_review" for p in result))
    def test_completed_public_search_without_pages_is_not_found(self):
        class Empty:
            def search(self,_): return []
        result=run_lanes(self.checkpoints,"example.edu","Fall 2027",Empty(),budget_seconds=1)
        self.assertEqual(len(result),144)
        self.assertTrue(all(p["state"]=="not_found_official" for p in result))
    def test_cost_ceiling_and_actual_reconciliation(self):
        m=Meter(10); m.reserve(8);m.settle(8,3)
        self.assertEqual(m.charged,3)
        m.reserve(7)
        with self.assertRaises(CostCeiling): m.reserve(1)
        self.assertEqual(m.charged,10)
    def test_official_only_no_private_dns_or_credentials(self):
        s=PublicSources("example.edu")
        for url in ("http://example.edu/a","https://example.edu:444/a","https://name:secret@example.edu/a","https://example.edu.evil.org/a"):
            self.assertFalse(s.allowed(url))
        with patch("socket.getaddrinfo",return_value=[(None,None,None,None,("127.0.0.1",443))]):
            self.assertFalse(s.allowed("https://example.edu/a"))
    def test_missing_robots_file_means_no_published_restriction_but_denials_fail_closed(self):
        from contextlib import contextmanager
        class Response:
            def __init__(self,status,body=b"",content_type="text/plain"):
                self.status=status; self.body=body; self.headers={"Content-Type":content_type}
            def stream(self,_): return iter([self.body])
            def close(self): pass
        @contextmanager
        def missing_robots(url,*_args,**_kwargs):
            yield Response(404) if url.endswith("/robots.txt") else Response(200)
        source=PublicSources("example.edu")
        html="<main>For Fall 2027 first-year applicants, apply using the Common App.</main>"
        with patch.object(source,"allowed",return_value=True), patch.object(source,"_open",side_effect=missing_robots), \
             patch.object(source,"_get",return_value=("https://example.edu/admissions",html)):
            self.assertIsNotNone(source.fetch("https://example.edu/admissions"))
        @contextmanager
        def denied_robots(*_args,**_kwargs): yield Response(403)
        source2=PublicSources("example.edu")
        with patch.object(source2,"allowed",return_value=True), patch.object(source2,"_open",side_effect=denied_robots), \
             patch.object(source2,"_get",side_effect=AssertionError("page must not be fetched")):
            self.assertIsNone(source2.fetch("https://example.edu/admissions"))

    def test_public_policy_page_is_not_discarded_for_personal_statement_requirement(self):
        from contextlib import contextmanager
        class Response:
            status=200
            headers={"Content-Type":"text/plain"}
            def stream(self,_): return iter([b"User-agent: *\nAllow: /\n"])
            def close(self): pass
        @contextmanager
        def opened(*_args,**_kwargs):
            yield Response()
        source=PublicSources("example.edu")
        html=b"<html><body><main><p>A personal statement may be requested during individual review.</p></main></body></html>"
        with patch.object(source,"allowed",return_value=True), patch.object(source,"_open",side_effect=opened), \
             patch.object(source,"_get",return_value=("https://example.edu/admission",html.decode())):
            page=source.fetch("https://example.edu/admission")
        self.assertIsNotNone(page)
        self.assertIn("personal statement may be requested",page["text"])

    def test_public_transport_pins_checked_ip_and_tls_host(self):
        source=PublicSources("example.edu")
        with patch("socket.getaddrinfo",return_value=[(None,None,None,None,("93.184.215.14",443))]), \
             patch("request_pipeline.urllib3.HTTPSConnectionPool") as pool:
            with source._open("https://example.edu/admission",2) as response:
                self.assertIs(response,pool.return_value.urlopen.return_value)
            args,kwargs=pool.call_args
            self.assertEqual(args[:2],("93.184.215.14",443))
            self.assertEqual(kwargs["server_hostname"],"example.edu")
            self.assertEqual(kwargs["assert_hostname"],"example.edu")
            self.assertEqual(pool.return_value.urlopen.call_args.kwargs["headers"]["Host"],"example.edu")
            self.assertFalse(pool.return_value.urlopen.call_args.kwargs["redirect"])
        with patch("socket.getaddrinfo",return_value=[(None,None,None,None,("127.0.0.1",443))]), \
             patch("request_pipeline.urllib3.HTTPSConnectionPool") as pool:
            with self.assertRaises(ValueError):
                with source._open("https://example.edu/admission",2): pass
            pool.assert_not_called()
    def test_career_is_not_vehicle(self):
        from research_agent import normalize_result
        payload, *_ = normalize_result({"population":"bringing_car","status":"unverified"},"CAR-01",{"title":"Career center onboarding"},["example.edu"],{},term="Fall 2027")
        self.assertEqual(payload["population"],"all")
    def test_schedule_retains_manual_dispatch_and_default_off_gate(self):
        workflow=(Path(__file__).resolve().parents[1]/".github/workflows/school-requests.yml").read_text()
        self.assertIn("cron: '*/5 * * * *'",workflow)
        self.assertIn("github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch'",workflow)
        self.assertIn("vars.REQUEST_PIPELINE_ENABLED || '0'",workflow)
        self.assertIn("vars.REQUEST_JOB_ESTIMATE_CENTS",workflow)
        self.assertIn("timeout --signal=TERM --kill-after=5s 225s python -u process_requests.py",workflow)
        self.assertIn("group: research-school",workflow)
        self.assertIn("environment: staging-research",workflow)
        self.assertIn("secrets.STAGING_APP_BASE_URL",workflow)
        self.assertIn("secrets.STAGING_QUEUE_AGENT_API_KEY",workflow)
        self.assertIn("secrets.STAGING_ANTHROPIC_API_KEY || secrets.ANTHROPIC_API_KEY",workflow)
        self.assertNotIn("STAGING_BRAVE_SEARCH_API_KEY",workflow)
        self.assertIn("vars.REQUEST_PAID_PROVIDERS_ENABLED || '0'",workflow)
    def staging_env(self):
        return {"REQUEST_PIPELINE_ENABLED":"1","REQUEST_WORKER_STAGE":"staging",
                "APP_BASE_URL":"https://staging.example.edu","REQUEST_STAGING_APP_ORIGIN":"https://staging.example.edu",
                "REQUEST_PRODUCTION_APP_ORIGIN":"https://www.example.edu","QUEUE_AGENT_API_KEY":"test",
                "REQUEST_ATTEMPT_CEILING_CENTS":"800","REQUEST_JOB_ESTIMATE_CENTS":"800"}
    def test_stage_origin_and_paid_gate_fail_before_claim(self):
        env=self.staging_env()
        with patch.dict(os.environ,env,clear=True), patch("request_pipeline.queue_api",side_effect=AssertionError("claim before preflight")):
            for key,value in (("REQUEST_WORKER_STAGE","production"),("APP_BASE_URL","https://www.example.edu"),
                              ("REQUEST_PRODUCTION_APP_ORIGIN",env["APP_BASE_URL"]),
                              ("APP_BASE_URL","http://staging.example.edu")):
                previous=os.environ[key];os.environ[key]=value
                with self.assertRaises(ValueError): main()
                os.environ[key]=previous
            self.assertFalse(preflight())
            os.environ["REQUEST_PAID_PROVIDERS_ENABLED"]="1"
            with self.assertRaises(ValueError): main()
    def test_budget_rejects_unfunded_paid_lanes_before_claim(self):
        env={**self.staging_env(),"REQUEST_PAID_PROVIDERS_ENABLED":"1",
             "ANTHROPIC_API_KEY":"test","REQUEST_RESEARCH_MODEL":"test",
             "REQUEST_SEARCH_COST_CENTS":"1","REQUEST_LANE_RESERVATION_CENTS":"40",
             "REQUEST_INPUT_CENTS_PER_MILLION":"300","REQUEST_OUTPUT_CENTS_PER_MILLION":"1500",
             "REQUEST_ATTEMPT_CEILING_CENTS":"479"}
        with patch.dict(os.environ,env,clear=True), patch("request_pipeline.queue_api",side_effect=AssertionError("claim before preflight")):
            with self.assertRaisesRegex(ValueError,"twelve-lane reservations"): main()
            os.environ["REQUEST_ATTEMPT_CEILING_CENTS"]="800"
            os.environ["REQUEST_JOB_ESTIMATE_CENTS"]="700"
            with self.assertRaisesRegex(ValueError,"twelve-lane reservations"): main()
            os.environ["REQUEST_JOB_ESTIMATE_CENTS"]="800"
            validate_budget_config(paid=True)
            os.environ["REQUEST_SEARCH_COST_CENTS"]="nan"
            with self.assertRaisesRegex(ValueError,"twelve-lane reservations"): main()
    def test_first_year_discovery_excludes_graduate_school_paths(self):
        self.assertFalse(_approved_public_url("https://example.edu/gradschool/admissions/checklist", "example.edu"))
        self.assertFalse(_approved_public_url("https://graduate.example.edu/admissions", "example.edu"))
        self.assertTrue(_approved_public_url("https://example.edu/admissions/first-year", "example.edu"))

    def test_search_result_urls_are_restricted_to_approved_official_domain(self):
        class Item:
            def __init__(self,**kwargs): self.__dict__.update(kwargs)
        message=Item(content=[
            Item(type="web_search_tool_result",content=[Item(url="https://www.example.edu/fall-2027"),Item(url="https://evil.example.net/no")]),
            Item(type="text",citations=[Item(url="https://admissions.example.edu/apply#dates"),Item(url="http://example.edu/insecure")])])
        self.assertEqual(official_search_urls(message,"example.edu"),[
            "https://www.example.edu/fall-2027","https://admissions.example.edu/apply"])
        dict_message=Item(content=[
            Item(type="web_search_tool_result",content=[{"url":"https://example.edu/dates"},{"url":"https://evil.example/no"}]),
            Item(type="text",citations=[{"url":"https://admissions.example.edu/requirements"}])])
        self.assertEqual(official_search_urls(dict_message,"example.edu"),[
            "https://example.edu/dates","https://admissions.example.edu/requirements"])
    def test_default_free_path_claims_and_submits_first_states_without_paid_calls(self):
        env=self.staging_env()
        calls=[]
        def fake_api(method,path,body=None):
            calls.append((method,path,body))
            if path.endswith("claim"):
                return {"claimed":True,"job":{"term":"Fall 2027","attemptId":"attempt-1","attempts":1},
                        "school":{"unitid":"12345","domain":"example.edu"}}
            if method=="GET":return {"checkpoints":self.checkpoints}
            if path.endswith("evidence"):return {"changed":True,"counts":{"under_review":144}}
            return {"job":{"status":"review"}}
        with patch.dict(os.environ,env,clear=True), patch("request_pipeline.queue_api",side_effect=fake_api), \
                patch("request_pipeline.Providers",side_effect=AssertionError("paid provider instantiated")), \
                patch.object(PublicSources,"fetch",return_value=None):
            main()
        self.assertEqual([x[1] for x in calls],["/api/agent/requests/claim","/api/agent/requests/evidence",
                                              "/api/agent/requests/evidence","/api/agent/requests/report"])
        submitted=calls[2][2]
        self.assertEqual(len(submitted["candidates"]),144)
        self.assertTrue(all(x["state"]=="under_review" for x in submitted["candidates"]))
        self.assertEqual(calls[3][2]["outcome"],"review")
        self.assertEqual(calls[3][2]["costCents"],0)
    def test_extracts_only_explicit_term_first_year_platform(self):
        sources=PublicSources("example.edu")
        text="For Fall 2027 first-year applicants, apply using the Common App online."
        provider=OfficialPublicProvider(sources,time.monotonic()+5)
        admissions=[{"code":"ADM-01","domain":"Admissions","title":"Application platform"}]
        matching=provider.propose("Fall 2027","example.edu",admissions,[{"url":"https://example.edu/admission","text":text}])
        self.assertEqual(matching[0]["code"],"ADM-01")
        self.assertIn("Fall 2027",matching[0]["quote"])
        self.assertEqual(provider.propose("Fall 2028","example.edu",admissions,[{"url":"https://example.edu/admission","text":text}]),[])
        self.assertEqual(provider.propose("Fall 2027","example.edu",[{"code":"ENR-01","domain":"Admission to Enrollment"}],[{"url":"https://example.edu/admission","text":text}]),[])
    def test_official_home_link_proposes_exact_excerpt_without_provider(self):
        source=PublicSources("example.edu")
        home="https://example.edu/"
        application="https://example.edu/admission"
        text="For Fall 2027 first-year applicants, apply using the Common App online."
        pages={home:{"url":home,"text":"Welcome","links":[application,"https://offsite.example.net/no"]},
               application:{"url":application,"text":text,"links":[]}}
        provider=OfficialPublicProvider(source,time.monotonic()+2)
        with patch.object(source,"fetch",side_effect=lambda url,timeout:pages.get(url)):
            found=research_lane("example.edu","Fall 2027",[{"code":"ADM-01","domain":"Admissions"}],
                                source,provider,time.monotonic()+2)
        self.assertEqual(found[0]["state"],"verified")
        self.assertIn(found[0]["quote"],found[0]["pageText"])
        self.assertEqual(found[0]["pageText"],found[0]["quote"])
        self.assertEqual(found[0]["sourceUrl"],application)
    def test_unpaid_extractors_return_multiple_exact_term_facts(self):
        source=PublicSources("example.edu")
        provider=OfficialPublicProvider(source,time.monotonic()+5)
        page={"url":"https://example.edu/admissions","text":(
            "For Fall 2027 first-year applicants, apply using the Common App. "
            "For Fall 2027 applicants, official high school transcripts must be submitted."),"links":[]}
        checkpoints=[
            {"code":"ADM-01","domain":"Admissions","title":"Application platform(s) and applicant type path identified"},
            {"code":"ADM-05","domain":"Admissions","title":"Transcript submission rules verified"},
        ]
        results=provider.propose("Fall 2027","example.edu",checkpoints,[page])
        self.assertEqual({r["code"] for r in results},{"ADM-01","ADM-05"})
        self.assertTrue(all(r["state"]=="verified" for r in results))
        self.assertTrue(all("Fall 2027" in r["quote"] for r in results))
        self.assertTrue(all(r["quote"] in page["text"] for r in results))

    def test_date_evidence_needs_distinct_exact_term_corroboration(self):
        provider=OfficialPublicProvider(PublicSources("example.edu"),time.monotonic()+5)
        cp={"code":"ADM-03","domain":"Admissions","title":"Priority / early / regular application deadlines verified"}
        first={"url":"https://example.edu/admissions","text":"For Fall 2027 applicants, the priority application deadline is 2026-10-15."}
        second={"url":"https://admissions.example.edu/deadlines","text":"The priority application deadline for Fall 2027 applicants is 2026-10-15."}
        found=provider.propose("Fall 2027","example.edu",[cp],[first,second])
        self.assertEqual(found[0]["state"],"verified")
        self.assertEqual(found[0]["secondSourceUrl"],second["url"])
        self.assertIn("2026-10-15",found[0]["secondQuote"])
        unresolved=provider.propose("Fall 2027","example.edu",[cp],[first])
        self.assertEqual(unresolved[0]["state"],"under_review")
        conflict={**second,"text":"The priority application deadline for Fall 2027 applicants is 2026-11-01."}
        disputed=provider.propose("Fall 2027","example.edu",[cp],[first,conflict])
        self.assertEqual(disputed[0]["state"],"conflicting")

    def test_unpaid_search_uses_official_anchor_text_to_find_topic_pages(self):
        source=PublicSources("example.edu")
        home={"url":"https://example.edu/","text":"Home","links":["https://example.edu/finaid"],
              "linkLabels":{"https://example.edu/finaid":"Financial Aid and FAFSA"}}
        provider=OfficialPublicProvider(source,time.monotonic()+5)
        with patch.object(source,"fetch",return_value=home):
            urls=provider.search("site:example.edu Fall 2027 Financial Aid first-year official dates fees process")
        self.assertEqual(urls,[home["url"],"https://example.edu/finaid"])

    def test_shared_two_hop_discovery_finds_distinct_lifecycle_pages_safely(self):
        class Catalog:
            domain="example.edu"
            def __init__(self): self.calls=[]
            @staticmethod
            def page(url,text,links=(),labels=None):
                return {"url":url,"text":text,"links":list(links),"linkLabels":labels or {}}
            def fetch(self,url,timeout=6):
                self.calls.append(url)
                root="https://example.edu/"
                hub="https://example.edu/students"
                targets={
                    "https://example.edu/admissions/apply":"First-year Admissions",
                    "https://example.edu/admitted/next-steps":"Admitted Student Enrollment Checklist",
                    "https://example.edu/financial-aid":"Financial Aid and FAFSA",
                    "https://example.edu/student-accounts/billing":"Tuition Billing and 529 Payments",
                    "https://example.edu/housing":"Housing and Dining",
                    "https://example.edu/orientation":"New Student Orientation",
                    "https://example.edu/student-health/immunization":"Student Health and Immunization",
                    "https://example.edu/families":"Parents and Family Weekend",
                    "https://example.edu/student-life/greek":"Greek Life Recruitment and Student Clubs",
                }
                if url==root:
                    return self.page(root,"University home",[hub],{hub:"Student Resources"})
                if url==hub:
                    links=list(targets)+["https://evil.example.net/financial-aid",
                         "https://example.edu/personal-statement","http://example.edu/aid"]
                    labels={link:label for link,label in targets.items()}
                    labels.update({"https://evil.example.net/financial-aid":"Financial Aid",
                                   "https://example.edu/personal-statement":"Application essays"})
                    return self.page(hub,"Student resources",links,labels)
                if url in targets:
                    deep="https://example.edu/deep/private-student-record"
                    links=[deep] if url.endswith("financial-aid") else []
                    return self.page(url,targets[url]+" official information",links,{deep:"Student record"})
                return None
        source=Catalog()
        provider=OfficialPublicProvider(source,time.monotonic()+10)
        lanes={
            "Admissions":"/admissions/apply",
            "Admission to Enrollment":"/admitted/next-steps",
            "Financial Aid":"/financial-aid",
            "Tuition Billing 529":"/student-accounts/billing",
            "Housing and Dining":"/housing",
            "Orientation and Academics":"/orientation",
            "Health Compliance Access":"/student-health/immunization",
            "Family and Campus Experience":"/families",
            "Greek and Student Life":"/student-life/greek",
        }
        for lane,path in lanes.items():
            urls=provider.search_lane("Fall 2027",lane)
            self.assertIn("https://example.edu"+path,urls,lane)
            self.assertLessEqual(len(urls),5)
        self.assertEqual(source.calls.count("https://example.edu/"),1)
        self.assertNotIn("https://evil.example.net/financial-aid",source.calls)
        self.assertNotIn("https://example.edu/personal-statement",source.calls)
        self.assertNotIn("http://example.edu/aid",source.calls)
        self.assertNotIn("https://example.edu/deep/private-student-record",source.calls)
        self.assertLessEqual(len(source.calls),32)

    def test_discovery_page_budget_is_hard_capped(self):
        class Catalog:
            domain="example.edu"
            def __init__(self): self.calls=[]
            def fetch(self,url,timeout=6):
                self.calls.append(url)
                root="https://example.edu/"
                if url==root:
                    links=[f"https://example.edu/financial-aid/{i}" for i in range(20)]
                    return {"url":root,"text":"University home","links":links,
                            "linkLabels":{link:"Financial Aid" for link in links}}
                return {"url":url,"text":"Financial Aid information","links":[],"linkLabels":{}}
        source=Catalog()
        provider=OfficialPublicProvider(source,time.monotonic()+5)
        with patch("request_pipeline.MAX_DISCOVERY_PAGES",5):
            provider.search_lane("Fall 2027","Financial Aid")
        self.assertLessEqual(len(source.calls),5)

    def test_evergreen_and_volatile_extractors_keep_exact_term_gate(self):
        provider=OfficialPublicProvider(PublicSources("example.edu"),time.monotonic()+5)
        evergreen={"code":"ADM-05","domain":"Admissions","title":"Transcript submission rules verified"}
        generic={"url":"https://example.edu/admissions","text":"Official transcripts must be submitted by the high school."}
        generic_result=provider.propose("Fall 2027","example.edu",[evergreen],[generic])
        self.assertEqual(generic_result[0]["state"],"verified")
        self.assertNotIn("Fall 2027",generic_result[0]["quote"])
        evergreen_term={"url":"https://example.edu/admissions","text":"For Fall 2027 applicants, official transcripts must be submitted by the high school."}
        self.assertEqual(provider.propose("Fall 2027","example.edu",[evergreen],[evergreen_term])[0]["state"],"verified")
        volatile={"code":"ADM-03","domain":"Admissions","title":"Priority application deadline verified"}
        old_cycle={"url":"https://example.edu/deadlines","text":"For Fall 2028 applicants, the priority application deadline is October 15, 2027."}
        self.assertEqual(provider.propose("Fall 2027","example.edu",[volatile],[old_cycle]),[])

    def test_extracts_distinct_exact_term_facts_across_lifecycle_lanes(self):
        provider=OfficialPublicProvider(PublicSources("example.edu"),time.monotonic()+5)
        checkpoints=[
            {"code":"ADM-05","domain":"Admissions","title":"Transcript submission rules verified"},
            {"code":"ENR-06","domain":"Admission to Enrollment","title":"Student account / NetID activation path mapped"},
            {"code":"HLT-01","domain":"Health Compliance Access","title":"Immunization requirements identified"},
        ]
        transcript={"url":"https://example.edu/admissions","text":"For Fall 2027 applicants, official transcripts must be submitted by the high school."}
        account={"url":"https://example.edu/enrollment","text":"For Fall 2027 admitted students, create a NetID and student account."}
        health_quote="For Fall 2027 students, immunization is required before course registration."
        health_a={"url":"https://example.edu/health/immunization","text":health_quote}
        health_b={"url":"https://health.example.edu/required-immunizations","text":health_quote+" View the public compliance checklist."}
        found=provider.propose("Fall 2027","example.edu",checkpoints,[transcript,account,health_a,health_b])
        self.assertEqual({p["code"] for p in found},{"ADM-05","ENR-06","HLT-01"})
        self.assertTrue(all(p["state"]=="verified" for p in found))
        self.assertTrue(all("Fall 2027" in p["quote"] for p in found))
        health=next(p for p in found if p["code"]=="HLT-01")
        self.assertNotEqual(health["sourceUrl"],health["secondSourceUrl"])

    def test_pipeline_off_by_default(self):
        from request_pipeline import main
        with patch.dict(os.environ,{"REQUEST_PIPELINE_ENABLED":"0"}), patch("requests.get",side_effect=AssertionError("network")):
            main()

if __name__=="__main__": unittest.main()
