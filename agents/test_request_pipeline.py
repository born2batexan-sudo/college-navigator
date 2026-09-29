import os
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import patch
sys.path.insert(0,os.path.dirname(__file__))
from request_pipeline import Meter, CostCeiling, PublicSources, OfficialPublicProvider, official_search_urls, research_lane, run_lanes, validate_budget_config, main, preflight

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
    def test_extracts_exact_term_or_evergreen_first_year_platform(self):
        sources=PublicSources("example.edu")
        text="For Fall 2027 first-year applicants, apply using the Common App online."
        provider=OfficialPublicProvider(sources,time.monotonic()+5)
        admissions=[{"code":"ADM-01","domain":"Admissions","title":"Application platform"}]
        matching=provider.propose("Fall 2027","example.edu",admissions,[{"url":"https://example.edu/admission","text":text}])
        self.assertEqual(matching[0]["code"],"ADM-01")
        self.assertIn("Fall 2027",matching[0]["quote"])
        prior=provider.propose("Fall 2028","example.edu",admissions,[{"url":"https://example.edu/admission","text":text}])
        self.assertIn("Fall 2027",prior[0]["quote"],"server must see and withhold the competing cycle")
        evergreen="We recommend using the Common App to apply, but you can also apply using the Apply Texas application."
        evergreen_result=provider.propose("Fall 2027","example.edu",admissions,[{"url":"https://example.edu/admission","text":evergreen}])
        self.assertEqual(evergreen_result[0]["quote"],evergreen)
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
        self.assertEqual(found[0]["sourceUrl"],application)
    def test_free_discovery_uses_www_fallback_and_one_bounded_admissions_hop(self):
        source=PublicSources("example.edu")
        bare="https://example.edu/"; home="https://www.example.edu/"
        apply="https://www.example.edu/admissions/apply"; visit="https://www.example.edu/admissions/visit"
        first="https://www.example.edu/admissions/apply/freshmen"
        pages={home:{"url":home,"text":"Welcome","links":[visit,apply]},
               apply:{"url":apply,"text":"Choose an applicant type","links":[first]},
               first:{"url":first,"text":"We recommend using the Common App to apply.","links":[]},
               visit:{"url":visit,"text":"Visit campus","links":[]}}
        provider=OfficialPublicProvider(source,time.monotonic()+2)
        with patch.object(source,"fetch",side_effect=lambda url,timeout:pages.get(url)):
            urls=provider.search("site:example.edu Fall 2027 Admissions first-year official dates fees process")
        self.assertEqual(urls[0],first)
        self.assertIn(apply,urls)
        self.assertNotEqual(urls[0],visit)
        self.assertNotIn(bare,urls)
    def test_pipeline_off_by_default(self):
        from request_pipeline import main
        with patch.dict(os.environ,{"REQUEST_PIPELINE_ENABLED":"0"}), patch("requests.get",side_effect=AssertionError("network")):
            main()


    def test_public_reader_captures_safe_official_anchor_labels(self):
        from contextlib import contextmanager
        class Response:
            status=200
            headers={"Content-Type":"text/plain"}
            def stream(self,_): return iter([b"User-agent: *\nAllow: /\n"])
            def close(self): pass
        @contextmanager
        def opened(*_args,**_kwargs): yield Response()
        source=PublicSources("example.edu")
        html='<main><a href="/node/120">Financial Aid and FAFSA</a><a href="https://other.edu/aid">Outside</a></main>'
        with patch.object(source,"allowed",return_value=True), patch.object(source,"_open",side_effect=opened), \
             patch.object(source,"_get",return_value=("https://example.edu/",html)):
            home=source.fetch("https://example.edu/")
        self.assertEqual(home["linkLabels"],{"https://example.edu/node/120":"Financial Aid and FAFSA"})
        self.assertEqual(home["links"],["https://example.edu/node/120"])

    def test_anchor_labels_admit_opaque_official_path_and_preserve_admissions_deep_priority(self):
        source=PublicSources("example.edu")
        root="https://example.edu/"; landing="https://example.edu/node/120"
        first="https://example.edu/admissions/apply/first-year"
        home={"url":root,"text":"Home","links":[landing],"linkLabels":{landing:"Admissions and Apply"}}
        pages={root:home,landing:{"url":landing,"text":"Applicant types","links":[first]},
               first:{"url":first,"text":"First-year","links":[]}}
        provider=OfficialPublicProvider(source,time.monotonic()+5)
        with patch.object(source,"fetch",side_effect=lambda url,timeout:pages.get(url)):
            found=provider.search("site:example.edu Fall 2027 Admissions first-year official dates fees process")
        self.assertEqual(found[0],first)
        self.assertIn(landing,found)

    def test_unpaid_multiple_explicit_process_facts_and_safe_evergreen(self):
        provider=OfficialPublicProvider(PublicSources("example.edu"),time.monotonic()+5)
        page={"url":"https://example.edu/admission","text":(
            "For Fall 2027 first-year applicants, apply using the Common App online. "
            "Official high school transcripts must be submitted by applicants. "
            "Applicants can check the application status portal to view their status. "
            "All applicants must submit a letter of recommendation.")}
        cps=[{"code":"ADM-01","title":"Application platform(s) and applicant type path identified"},
             {"code":"ADM-05","title":"Transcript submission rules verified"},
             {"code":"ADM-11","title":"Application status portal and post-submit monitoring path identified"},
             {"code":"ADM-07","title":"Recommendation requirements verified"}]
        found={p["code"]:p for p in provider.propose("Fall 2027","example.edu",cps,[page])}
        self.assertEqual(set(found),{c["code"] for c in cps})
        for code in ("ADM-01","ADM-05","ADM-11"): self.assertEqual(found[code]["state"],"verified")
        self.assertEqual(found["ADM-07"]["state"],"under_review")
        dated_platform={"url":"https://example.edu/apply","text":"Apply using the Common App before October 15."}
        platform=[c for c in cps if c["code"]=="ADM-01"]
        self.assertEqual(provider.propose("Fall 2027","example.edu",platform,[dated_platform])[0]["state"],"under_review")
        policy={"code":"ADM-06","title":"Test score policy and submission method verified"}
        policy_only={"url":"https://example.edu/tests","text":"SAT and ACT scores are optional for first-year students."}
        self.assertEqual(provider.propose("Fall 2027","example.edu",[policy],[policy_only]),[])
        policy_with_path={**policy_only,"text":"SAT and ACT scores are optional; students can submit scores through the application."}
        self.assertEqual(provider.propose("Fall 2027","example.edu",[policy],[policy_with_path])[0]["state"],"verified")

    def test_special_population_rules_do_not_become_general_first_year_findings(self):
        provider=OfficialPublicProvider(PublicSources("example.edu"),time.monotonic()+5)
        checkpoints=[
            {"code":"ADM-05","title":"Transcript submission rules verified"},
            {"code":"ADM-06","title":"Test score policy and submission method verified"},
        ]
        page={"url":"https://example.edu/admissions","text":(
            "Homeschooled applicants must submit an official homeschool transcript. "
            "Applicants seeking early admission need an ACT composite of 26 and must submit letters from a counselor and parents.")}
        self.assertEqual(provider.propose("Fall 2027","example.edu",checkpoints,[page]),[])
        general={"url":"https://example.edu/first-year","text":(
            "Official high school transcripts must be submitted by first-year applicants. "
            "SAT and ACT scores are optional; first-year students may submit scores through the application.")}
        found={p["code"] for p in provider.propose("Fall 2027","example.edu",checkpoints,[general])}
        self.assertEqual(found,{"ADM-05","ADM-06"})

    def test_term_sensitive_exact_term_and_independent_corroboration(self):
        provider=OfficialPublicProvider(PublicSources("example.edu"),time.monotonic()+5)
        cp={"code":"ADM-03","title":"Priority / early / regular application deadlines verified"}
        a={"url":"https://example.edu/admission","text":"For Fall 2027 applicants, the priority application deadline is 2026-10-15."}
        b={"url":"https://admissions.example.edu/deadlines","text":"The priority application deadline for Fall 2027 applicants is 2026-10-15."}
        self.assertEqual(provider.propose("Fall 2027","example.edu",[cp],[a])[0]["state"],"under_review")
        self.assertEqual(provider.propose("Fall 2027","example.edu",[cp],[a,b])[0]["state"],"verified")
        conflict={**b,"text":"The priority application deadline for Fall 2027 applicants is 2026-11-01."}
        self.assertEqual(provider.propose("Fall 2027","example.edu",[cp],[a,conflict])[0]["state"],"conflicting")
        self.assertEqual(provider.propose("Fall 2028","example.edu",[cp],[a,b]),[])
        notice={**a,"text":"The Fall 2027 application deadline is not yet published; please check October 15."}
        self.assertEqual(provider.propose("Fall 2027","example.edu",[cp],[notice]),[])
        mixed={**a,"text":"For Fall 2027 and Fall 2028 applicants, the application deadline is 2026-10-15."}
        mixed_result=provider.propose("Fall 2027","example.edu",[cp],[mixed,b])
        self.assertTrue(all(p["state"]!="verified" for p in mixed_result))

    def test_fee_and_aid_require_exact_term_and_distinct_pages(self):
        provider=OfficialPublicProvider(PublicSources("example.edu"),time.monotonic()+5)
        fee={"code":"ADM-04","title":"Application fee and waiver process verified"}
        fee_only={"url":"https://example.edu/apply","text":"For Fall 2027 first-year applicants, the application fee is $75."}
        self.assertEqual(provider.propose("Fall 2027","example.edu",[fee],[fee_only]),[])
        a={"url":"https://example.edu/apply","text":"For Fall 2027 first-year applicants, the application fee is $75; eligible students can request a fee waiver through the application."}
        b={"url":"https://admissions.example.edu/fees","text":"The Fall 2027 application fee is $75; eligible applicants can request a fee waiver through the application."}
        self.assertEqual(provider.propose("Fall 2027","example.edu",[fee],[a])[0]["state"],"under_review")
        self.assertEqual(provider.propose("Fall 2027","example.edu",[fee],[a,b])[0]["state"],"verified")
        self.assertEqual(provider.propose("Fall 2028","example.edu",[fee],[a,b]),[])
        aid={"code":"AID-01","title":"FAFSA / TASFA applicability identified"}
        generic={"url":"https://example.edu/aid","text":"All incoming students must submit the FAFSA."}
        self.assertEqual(provider.propose("Fall 2027","example.edu",[aid],[generic]),[])
        aid_a={"url":"https://example.edu/aid","text":"All Fall 2027 incoming students must submit the FAFSA."}
        aid_b={"url":"https://example.edu/first-year-aid","text":"All Fall 2027 incoming students must submit the FAFSA. Learn more."}
        self.assertEqual(provider.propose("Fall 2027","example.edu",[aid],[aid_a,aid_b])[0]["state"],"verified")
        self.assertEqual(provider.propose("Fall 2027","example.edu",[{"code":"SCH-10","title":"Scholarship acceptance requirements"}],[aid_a,aid_b]),[])

    def test_nonvolatile_evergreen_requirement_requires_two_official_pages(self):
        provider=OfficialPublicProvider(PublicSources("example.edu"),time.monotonic()+5)
        cp={"code":"ACA-01","title":"Orientation requirement / eligibility mapped"}
        a={"url":"https://example.edu/orientation","text":"All new students are required to attend orientation."}
        b={"url":"https://example.edu/new-students","text":"All new students are required to attend orientation. Read our guide."}
        self.assertEqual(provider.propose("Fall 2027","example.edu",[cp],[a])[0]["state"],"under_review")
        self.assertEqual(provider.propose("Fall 2027","example.edu",[cp],[a,b])[0]["state"],"verified")
        a_date={**a,"text":"For Fall 2026, all new students are required to attend orientation."}
        self.assertEqual(provider.propose("Fall 2027","example.edu",[cp],[a_date,b])[0]["state"],"under_review")

    def test_quote_only_payload_is_verified_against_fetched_text(self):
        source=PublicSources("example.edu")
        page={"url":"https://example.edu/admission","text":"Welcome! "*1000+
              "Official high school transcripts must be submitted by applicants.","links":[]}
        class Stub:
            paid=False
            def search(self,_): return [page["url"]]
            def propose(self,term,domain,checkpoints,pages):
                return [{"code":"ADM-05","state":"verified","sourceUrl":pages[0]["url"],
                         "quote":"Official high school transcripts must be submitted by applicants."}]
        with patch.object(source,"fetch",return_value=page):
            found=research_lane("example.edu","Fall 2027",[{"code":"ADM-05","domain":"Admissions"}],
                                source,Stub(),time.monotonic()+3)
        self.assertEqual(found[0]["pageText"],found[0]["quote"])
        self.assertNotIn("Welcome!",found[0]["pageText"])

if __name__=="__main__": unittest.main()
