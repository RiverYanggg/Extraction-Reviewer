import os
import tempfile
import unittest
from pathlib import Path

from app.enviz.config import load_env_file


class EnvFileTest(unittest.TestCase):
    def setUp(self):
        self._old_env = os.environ.copy()
        os.environ.pop("DEEPSEEK_API_KEY", None)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._old_env)

    def test_load_env_file_reads_key_value_pairs(self):
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            env_path.write_text(
                "DEEPSEEK_API_KEY='file-key'\n"
                "ENVIZ_ASSISTANT_MODEL=deepseek-v4-flash\n",
                encoding="utf-8",
            )

            load_env_file(env_path)

        self.assertEqual(os.environ["DEEPSEEK_API_KEY"], "file-key")
        self.assertEqual(os.environ["ENVIZ_ASSISTANT_MODEL"], "deepseek-v4-flash")

    def test_load_env_file_does_not_override_existing_environment(self):
        os.environ["DEEPSEEK_API_KEY"] = "shell-key"
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            env_path.write_text("DEEPSEEK_API_KEY=file-key\n", encoding="utf-8")

            load_env_file(env_path)

        self.assertEqual(os.environ["DEEPSEEK_API_KEY"], "shell-key")


if __name__ == "__main__":
    unittest.main()
