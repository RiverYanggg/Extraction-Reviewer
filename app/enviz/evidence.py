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


def _normalise(text: str) -> str:
    text = re.sub(r"^\s{0,3}#{1,6}\s+", "", text.strip())
    return re.sub(r"\s+", " ", text).lower()


def _mineru_markdown_blocks(markdown: Path, evidence_blocks: list[dict]) -> list[dict]:
    """Render the source Markdown in document order without adapter inserts.

    Existing evidence IDs are assigned only when a Markdown block matches a
    source evidence block.  Images are emitted from their original Markdown
    line, so an image and its caption cannot be independently inserted twice.
    """
    unused: dict[str, list[dict]] = {}
    for block in evidence_blocks:
        text = str(block.get("text", ""))
        if text.strip():
            unused.setdefault(_normalise(text), []).append(block)

    def take_id(text: str) -> str | None:
        normalised = _normalise(text)
        candidates = unused.get(normalised, [])
        if candidates:
            return str(candidates.pop(0).get("block_id"))
        # MinerU occasionally places an image between two fragments that the
        # evidence builder retained as one caption block. Bind that evidence to
        # its first substantial source fragment, immediately before the image.
        if len(normalised) < 40:
            return None
        matches = [(key, values) for key, values in unused.items()
                   if len(values) == 1 and normalised in key]
        if len(matches) == 1:
            _, values = matches[0]
            return str(values.pop(0).get("block_id"))
        return None

    out: list[dict] = []
    pending: list[str] = []

    def emit_text() -> None:
        text = "\n".join(pending).strip()
        pending.clear()
        if not text:
            return
        classified = classify_block(text)
        out.append({"block_id": take_id(text) or f"source__{len(out):05d}", "text": text,
                    "kind": classified["kind"], "level": classified.get("level"),
                    "heading_text": classified.get("heading_text")})

    for line in markdown.read_text(encoding="utf-8").splitlines():
        image = _IMAGE_RE.fullmatch(line.strip().rstrip("  "))
        heading = _HEADING_RE.match(line)
        if image:
            emit_text()
            out.append({"block_id": f"source__image_{len(out):05d}", "text": line,
                        "kind": "image", "image_src": image.group(1)})
        elif heading:
            emit_text()
            text = line.strip()
            level = len(heading.group(1))
            out.append({"block_id": take_id(text) or f"source__{len(out):05d}", "text": text,
                        "kind": "title" if level == 1 else "heading", "level": level, "heading_text": heading.group(2)})
        elif not line.strip():
            emit_text()
        else:
            pending.append(line)
    emit_text()
    return out


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

    mineru_markdown = pdir / "source" / "mineru" / "full.md"
    if mineru_markdown.is_file():
        return _mineru_markdown_blocks(mineru_markdown, blocks)

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
