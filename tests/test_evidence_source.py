import tempfile
import unittest
from pathlib import Path

from app.enviz.evidence import _mineru_markdown_blocks


class MineruMarkdownSourceTest(unittest.TestCase):
    def test_preserves_heading_image_caption_order_without_duplicate_image(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "full.md"
            path.write_text("# Title\n\nParagraph\n\n![](images/figure.jpg)  \nFig. 1. Caption\n\n## Methods\n", encoding="utf-8")
            blocks = _mineru_markdown_blocks(path, [{"block_id": "b1", "text": "Paragraph"}, {"block_id": "b2", "text": "Fig. 1. Caption"}])

        self.assertEqual([block["kind"] for block in blocks], ["title", "text", "image", "text", "heading"])
        self.assertEqual(blocks[1]["block_id"], "b1")
        self.assertEqual(blocks[3]["block_id"], "b2")
        self.assertEqual(blocks[2]["image_src"], "images/figure.jpg")


if __name__ == "__main__":
    unittest.main()
