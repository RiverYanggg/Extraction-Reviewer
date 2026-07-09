import json
import os
import unittest
from unittest.mock import patch

from app.enviz import assistant


class _FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return json.dumps({
            "choices": [
                {"message": {"content": "DeepSeek answer"}}
            ]
        }).encode("utf-8")


class AssistantDeepSeekTest(unittest.TestCase):
    def setUp(self):
        self._old_env = os.environ.copy()
        for key in list(os.environ):
            if key.startswith("ENVIZ_ASSISTANT_") or key.startswith("DEEPSEEK_") or key.startswith("ANTHROPIC_"):
                os.environ.pop(key, None)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._old_env)

    def test_uses_deepseek_chat_completions_with_conversation_history(self):
        os.environ["DEEPSEEK_API_KEY"] = "test-token"
        captured = {}

        def fake_urlopen(req, timeout):
            captured["url"] = req.full_url
            captured["headers"] = dict(req.header_items())
            captured["body"] = json.loads(req.data.decode("utf-8"))
            captured["timeout"] = timeout
            return _FakeResponse()

        messages = [
            {"role": "user", "content": "第一轮问题"},
            {"role": "assistant", "content": "第一轮回答"},
            {"role": "user", "content": "第二轮问题"},
        ]

        with patch("urllib.request.urlopen", fake_urlopen):
            result = assistant.ask(messages, context="当前字段：yield_strength")

        self.assertEqual(result, {"ok": True, "reply": "DeepSeek answer", "source": "ai"})
        self.assertEqual(captured["url"], "https://api.deepseek.com/chat/completions")
        self.assertEqual(captured["body"]["model"], "deepseek-v4-flash")
        self.assertEqual(captured["body"]["messages"][0]["role"], "system")
        self.assertIn("当前字段：yield_strength", captured["body"]["messages"][0]["content"])
        self.assertEqual(captured["body"]["messages"][1:], messages)
        self.assertEqual(captured["headers"]["Authorization"], "Bearer test-token")
        self.assertEqual(captured["timeout"], 60)


if __name__ == "__main__":
    unittest.main()
