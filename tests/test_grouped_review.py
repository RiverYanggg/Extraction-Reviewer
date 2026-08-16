import unittest

from app.enviz.export import _apply_added_fields, _grouped_diff
from app.enviz.metrics import compute_metrics


class GroupedReviewTest(unittest.TestCase):
    def test_nested_added_object_is_materialized_and_bucketed(self):
        root = {"paper": {"papers": []}, "samples": []}
        added = [
            {"temp_id": "A0001", "parent_id": "paper", "key": "reviewed_process", "path": "paper.reviewed_process", "node_type": "object", "bucket_id": "paper_level"},
            {"temp_id": "A0002", "parent_id": "added:A0001", "key": "temperature", "path": "paper.reviewed_process.temperature", "value": "900 C", "node_type": "field", "bucket_id": "paper_level"},
        ]
        changes, unapplied = _apply_added_fields(root, added)
        self.assertEqual(unapplied, [])
        self.assertEqual(root["paper"]["reviewed_process"]["temperature"], "900 C")
        diff = _grouped_diff("paper-x", changes)
        self.assertEqual(len(diff["paper_level"]), 2)
        self.assertEqual(diff["samples"], {})

    def test_metrics_include_sample_bucket(self):
        slots = [{"field_id": "samples/0/value", "section": "sample", "bucket_id": "sample-a", "value": "ok"}]
        metrics = compute_metrics("paper-x", slots, {"fields": {"samples/0/value": {"review_status": "confirmed"}}, "added_fields": []})
        self.assertEqual(metrics["per_bucket"]["sample-a"]["tp"], 1)


if __name__ == "__main__":
    unittest.main()
