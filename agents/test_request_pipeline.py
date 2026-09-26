import os
import sys
import time
import unittest
from unittest.mock import patch
sys.path.insert(0,os.path.dirname(__file__))
from request_pipeline import Meter, CostCeiling, PublicSources, run_lanes

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
    def test_career_is_not_vehicle(self):
        from research_agent import normalize_result
        payload, *_ = normalize_result({"population":"bringing_car","status":"unverified"},"CAR-01",{"title":"Career center onboarding"},["example.edu"],{},term="Fall 2027")
        self.assertEqual(payload["population"],"all")
    def test_pipeline_off_by_default(self):
        from request_pipeline import main
        with patch.dict(os.environ,{"REQUEST_PIPELINE_ENABLED":"0"}), patch("requests.get",side_effect=AssertionError("network")):
            main()

if __name__=="__main__":unittest.main()
