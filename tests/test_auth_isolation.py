import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.enviz import auth
from app.enviz.annotations import load_annotation, save_annotation
from app.enviz.assignments import is_assigned, load_assigned_papers


class AuthIsolationTest(unittest.TestCase):
    def setUp(self):
        self._old_env = os.environ.copy()
        os.environ.pop("ENVIZ_USERS_JSON", None)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._old_env)

    def test_default_fourth_account_authenticates(self):
        user = auth.verify_credentials("annotator4", "Annotator4@2026")

        self.assertIsNotNone(user)
        self.assertEqual(user.username, "annotator4")

    def test_env_users_json_overrides_default_accounts(self):
        os.environ["ENVIZ_USERS_JSON"] = (
            '{"reviewer":{"display_name":"Reviewer",'
            '"password_sha256":"2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b"}}'
        )

        self.assertIsNotNone(auth.verify_credentials("reviewer", "secret"))
        self.assertIsNone(auth.verify_credentials("annotator1", "Annotator1@2026"))

    def test_workspace_can_be_configured_per_account(self):
        os.environ["ENVIZ_USERS_JSON"] = (
            '{"reviewer":{"display_name":"Reviewer","workspace":"xuben",'
            '"password_sha256":"2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b"}}'
        )
        with tempfile.TemporaryDirectory() as tmp:
            with patch("app.enviz.auth.USERS_DIR", Path(tmp)):
                user = auth.verify_credentials("reviewer", "secret")

                self.assertEqual(user.username, "reviewer")
                self.assertEqual(user.workspace, "xuben")
                self.assertEqual(user.user_dir, Path(tmp) / "xuben")

    def test_annotations_are_isolated_by_user(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch("app.enviz.auth.USERS_DIR", Path(tmp)):
                user_a = auth.User("user_a", "User A")
                user_b = auth.User("user_b", "User B")
                doc = load_annotation("paper/one", user_a)
                doc["fields"]["/title"] = {"review_status": "confirmed"}

                save_annotation("paper/one", doc, user_a)

                self.assertEqual(
                    load_annotation("paper/one", user_a)["fields"]["/title"]["review_status"],
                    "confirmed",
                )
                self.assertEqual(load_annotation("paper/one", user_b)["fields"], {})

    def test_assignments_are_loaded_per_user(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch("app.enviz.auth.USERS_DIR", Path(tmp)):
                user_a = auth.User("user_a", "User A")
                user_b = auth.User("user_b", "User B")
                user_a.user_dir.mkdir(parents=True, exist_ok=True)
                user_a.assignments_path.write_text(
                    '{"papers":["paper-a","paper-b"]}',
                    encoding="utf-8",
                )

                self.assertEqual(load_assigned_papers(user_a), ["paper-a", "paper-b"])
                self.assertTrue(is_assigned(user_a, "paper-a"))
                self.assertFalse(is_assigned(user_a, "paper-c"))
                self.assertEqual(load_assigned_papers(user_b), [])


if __name__ == "__main__":
    unittest.main()
