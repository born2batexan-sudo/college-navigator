import hashlib
import os
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, os.path.dirname(__file__))
from monitoring_agent import check_source, fetch_text


def fp(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class MonitoringAgentTest(unittest.TestCase):
    def source(self, text=None):
        return {
            "url": "https://www.example.edu/admissions",
            "fingerprint": fp(text) if text is not None else None,
            "lastContent": text,
        }

    @patch("monitoring_agent.api_patch")
    def test_first_check_records_baseline(self, write):
        self.assertEqual(check_source(self.source(), "example", fetcher=lambda _: "first"), "baseline")
        body = write.call_args.args[1]
        self.assertEqual(body["fingerprint"], fp("first"))
        self.assertEqual(body["content"], "first")

    @patch("monitoring_agent.api_patch")
    @patch("monitoring_agent.api_post")
    def test_unchanged_advances_freshness_without_event_or_content_rewrite(self, event, write):
        self.assertEqual(check_source(self.source("same"), "example", fetcher=lambda _: "same"), "unchanged")
        body = write.call_args.args[1]
        self.assertEqual(body["fingerprint"], fp("same"))
        self.assertNotIn("content", body)
        event.assert_not_called()

    @patch("monitoring_agent.api_patch")
    @patch("monitoring_agent.api_post")
    def test_changed_source_creates_pending_review_event_without_rewriting_rules(self, event, write):
        classifier = Mock(return_value={"materiality": "material", "summary": "Deadline changed."})
        self.assertEqual(check_source(self.source("old"), "example", fetcher=lambda _: "new", classifier=classifier), "changed")
        classifier.assert_called_once_with("old", "new")
        payload = event.call_args.args[1]
        self.assertEqual(payload["oldFingerprint"], fp("old"))
        self.assertEqual(payload["newFingerprint"], fp("new"))
        self.assertEqual(payload["materiality"], "material")
        write.assert_not_called()

    @patch("monitoring_agent.api_patch")
    @patch("monitoring_agent.api_post")
    def test_dry_run_makes_no_writes_and_no_classifier_call(self, event, write):
        classifier = Mock(side_effect=AssertionError("model must not run"))
        self.assertEqual(check_source(self.source("old"), "example", dry_run=True, fetcher=lambda _: "new", classifier=classifier), "changed")
        classifier.assert_not_called()
        event.assert_not_called()
        write.assert_not_called()

    @patch("monitoring_agent.requests.get")
    def test_fetch_refuses_cross_host_redirect(self, get):
        response = Mock(status_code=302, headers={"location": "https://evil.example/admissions"}, url="https://www.example.edu/admissions")
        get.return_value = response
        self.assertIsNone(fetch_text("https://www.example.edu/admissions"))


if __name__ == "__main__":
    unittest.main()
