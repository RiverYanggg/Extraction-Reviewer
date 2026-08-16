import os
import unittest
from pathlib import Path
from unittest.mock import patch

from app.enviz.auth import User
from app.enviz import server


class AgenticWorkspaceAccessTest(unittest.TestCase):
    def setUp(self):
        self.user = User(username="annotator1", display_name="Reviewer", workspace="Xuben")
        self.old = os.environ.pop("ENVIZ_ALLOW_ALL_AGENTIC_PAPERS", None)

    def tearDown(self):
        if self.old is not None:
            os.environ["ENVIZ_ALLOW_ALL_AGENTIC_PAPERS"] = self.old

    @patch("app.enviz.server.discover_papers", return_value=["new-paper"])
    @patch("app.enviz.server.load_assigned_papers", return_value=["old-paper"])
    def test_agentic_workspace_keeps_assignments_by_default(self, *_):
        with patch.object(server, "AGENTIC_RUNS_ROOT", Path("/tmp/agentic")):
            self.assertEqual(server.reviewable_paper_ids(self.user), [])

    @patch("app.enviz.server.discover_papers", return_value=["new-paper"])
    @patch("app.enviz.server.load_assigned_papers", return_value=["old-paper"])
    def test_opt_in_lists_all_discovered_agentic_papers(self, *_):
        os.environ["ENVIZ_ALLOW_ALL_AGENTIC_PAPERS"] = "1"
        with patch.object(server, "AGENTIC_RUNS_ROOT", Path("/tmp/agentic")):
            self.assertEqual(server.reviewable_paper_ids(self.user), ["new-paper"])


if __name__ == "__main__":
    unittest.main()
