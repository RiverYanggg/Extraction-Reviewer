"""Source evidence blocks for the left panel.

The source is rendered as the ordered list of evidence blocks that the
extractor references (block-level highlight granularity, exact by construction).
"""
from __future__ import annotations

import re
from pathlib import Path

from .utils import try_read_json

_HEADING_RE = re.compile(r"^\s{0,3}(#{1,6})\s+(.*)$")
_IMAGE_RE = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")


def classify_block(text: str) -> dict:
    stripped = text.strip()
    m = _HEADING_RE.match(stripped)
    if m:
        return {"kind": "heading", "level": len(m.group(1)), "heading_text": m.group(2)}
    img = _IMAGE_RE.search(stripped)
    if img and stripped.startswith("!["):
        return {"kind": "image", "image_src": img.group(1)}
    if stripped.startswith("|") or stripped.startswith("<table"):
        return {"kind": "table"}
    return {"kind": "text"}


def load_blocks(pdir: Path) -> list[dict]:
    raw = try_read_json(pdir / "verify" / "evidence_blocks.json")
    if isinstance(raw, list) and raw:
        blocks = raw
    else:
        alt = try_read_json(pdir / "extraction_postprocess" / "evidence_blocks_without_char.json")
        blocks = (alt or {}).get("records", []) if isinstance(alt, dict) else []

    out = []
    for b in blocks:
        text = b.get("text", "")
        out.append({
            "block_id": b.get("block_id"), "text": text,
            "char_start": b.get("char_start"), "char_end": b.get("char_end"),
            **classify_block(text),
        })
    if out and all(b["char_start"] is not None for b in out):
        out.sort(key=lambda b: b["char_start"])
    return out


def find_pdf(pdir: Path):
    mineru = pdir / "source" / "mineru"
    if mineru.is_dir():
        pdfs = sorted(mineru.glob("*_origin.pdf")) or sorted(mineru.glob("*.pdf"))
        if pdfs:
            return pdfs[0]
    return None
