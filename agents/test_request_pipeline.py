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
        self.assertEqual(found[0]["sourceUrl"],application)
    def test_pipeline_off_by_default(self):
        from request_pipeline import main
        with patch.dict(os.environ,{"REQUEST_PIPELINE_ENABLED":"0"}), patch("requests.get",side_effect=AssertionError("network")):
            main()

if __name__=="__main__": unittest.main()
