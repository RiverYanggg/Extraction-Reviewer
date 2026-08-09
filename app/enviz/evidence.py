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
    view = pdir / "viewer" if (pdir / "viewer").is_dir() else pdir
    raw = try_read_json(view / "verify" / "evidence_blocks.json")
    if isinstance(raw, list) and raw:
        blocks = raw
    elif isinstance(raw, dict) and isinstance(raw.get("records"), list):
        blocks = raw["records"]
    else:
        alt = try_read_json(view / "extraction_postprocess" / "evidence_blocks_without_char.json")
        blocks = (alt or {}).get("records", []) if isinstance(alt, dict) else []

    out = []
    for b in blocks:
        text = b.get("text", "")
        classified = classify_block(text)
        viewer_kind = b.get("viewer_kind")
        out.append({
            "block_id": b.get("block_id"), "text": text,
            "char_start": b.get("char_start"), "char_end": b.get("char_end"),
            "page_idx": b.get("page_idx"),
            "kind": viewer_kind or classified["kind"],
            "level": b.get("display_level") or classified.get("level"),
            "heading_text": classified.get("heading_text"),
            "image_src": classified.get("image_src"),
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
