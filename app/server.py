"""
Evidence Note Annotator — backend

A small FastAPI service that turns the read-only extraction pipeline output
(under ``extracted/``) into an interactive, writable annotation workspace.

Responsibilities
----------------
* Discover papers in the extraction workspace.
* Assemble, per paper, the three things the UI needs together:
    - the source as an ordered list of *evidence blocks* (block-level highlight
      granularity, which is exactly the granularity the extractor references),
    - the flat list of *fields* (the atomic annotation unit),
    - the *buckets* (paper_level + one per sample) that group fields for review.
* Persist annotation state to ``annotations/<paper_id>.json`` (never mutates the
  original extraction output).
* Serve figure images referenced by the source markdown.
* Produce a downstream-ready export bundle (zip) on demand.

The service is intentionally stateless in memory: every request reads from disk
and writes to disk, so restarting the server never loses work and multiple tabs
stay consistent.
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# --------------------------------------------------------------------------- #
# Paths
# --------------------------------------------------------------------------- #
APP_DIR = Path(__file__).resolve().parent
ROOT = APP_DIR.parent                       # evidence_note_viewer/
EXTRACTED_DIR = ROOT / "extracted"          # read-only pipeline output
ANNOT_DIR = ROOT / "annotations"            # our writable state
STATIC_DIR = APP_DIR / "static"

ANNOT_DIR.mkdir(exist_ok=True)

ANNOT_SCHEMA_VERSION = "annot-v1"


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def try_read_json(path: Path) -> Optional[Any]:
    try:
        return read_json(path)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def paper_dir(paper_id: str) -> Path:
    # Guard against path traversal — paper_id must be a single existing dir name.
    d = (EXTRACTED_DIR / paper_id).resolve()
    if EXTRACTED_DIR.resolve() not in d.parents or not d.is_dir():
        raise HTTPException(status_code=404, detail=f"Unknown paper: {paper_id}")
    return d


def annot_path(paper_id: str) -> Path:
    safe = paper_id.replace("/", "_")
    return ANNOT_DIR / f"{safe}.json"


# --------------------------------------------------------------------------- #
# Evidence blocks (left panel source)
# --------------------------------------------------------------------------- #
_HEADING_RE = re.compile(r"^\s{0,3}(#{1,6})\s+(.*)$")
_IMAGE_RE = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")


def classify_block(text: str) -> dict:
    """Infer a light-weight display kind for a raw markdown block."""
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
    """Ordered evidence blocks. Prefer the char-anchored version from verify/."""
    raw = try_read_json(pdir / "verify" / "evidence_blocks.json")
    if isinstance(raw, list) and raw:
        blocks = raw
    else:
        alt = try_read_json(
            pdir / "extraction_postprocess" / "evidence_blocks_without_char.json"
        )
        blocks = (alt or {}).get("records", []) if isinstance(alt, dict) else []

    out: list[dict] = []
    for b in blocks:
        text = b.get("text", "")
        out.append(
            {
                "block_id": b.get("block_id"),
                "text": text,
                "char_start": b.get("char_start"),
                "char_end": b.get("char_end"),
                **classify_block(text),
            }
        )
    # Stable order by char_start when available, otherwise input order.
    if all(b["char_start"] is not None for b in out):
        out.sort(key=lambda b: b["char_start"])
    return out


# --------------------------------------------------------------------------- #
# Fields + buckets (right panel)
# --------------------------------------------------------------------------- #
def humanize_path(path: str, section: str) -> str:
    """Turn ``samples.sample_3cu__idx_0.properties[2].value`` into something
    readable for a reviewer without losing meaning."""
    tail = path.split(".", 2)[-1] if path.count(".") >= 2 else path
    return tail


def load_fields(pdir: Path) -> tuple[list[dict], dict]:
    fe = try_read_json(pdir / "extraction_postprocess" / "field_evidence.json") or {}
    fields = []
    for f in fe.get("fields", []):
        support = f.get("support", {}) or {}
        refs = support.get("evidence_refs", []) or []
        label = support.get("support_label", "unknown")
        fields.append(
            {
                "field_id": f.get("field_id"),
                "section": f.get("section"),
                "path": f.get("path"),
                "label": humanize_path(f.get("path", ""), f.get("section", "")),
                "value": f.get("value"),
                "evidence_refs": refs,
                "support_label": label,
                "confidence": support.get("confidence"),
                "contradiction": bool(support.get("contradiction")),
                "reason": support.get("reason"),
                "method": support.get("method"),
                # derived data-quality flag (independent of reviewer action)
                "no_evidence": len(refs) == 0 or label == "unsupported",
            }
        )
    meta = {
        "field_count": fe.get("field_count", len(fields)),
        "support_summary": fe.get("support_summary", {}),
        "source_text_extraction_path": fe.get("source_text_extraction_path"),
        "schema_version": fe.get("schema_version"),
    }
    return fields, meta


def load_buckets(pdir: Path) -> list[dict]:
    sb = try_read_json(pdir / "extraction_postprocess" / "sample_buckets.json") or {}
    out = []
    for b in sb.get("buckets", []):
        records = b.get("records", {}) or {}
        out.append(
            {
                "bucket_id": b.get("bucket_id"),
                "bucket_type": b.get("bucket_type"),
                "field_ids": b.get("field_ids", []),
                "field_count": b.get("field_count", len(b.get("field_ids", []))),
                # section order as authored in the record; drives right-panel grouping
                "section_order": list(records.keys()),
                "records": records,
            }
        )
    return out


def paper_title(buckets: list[dict], paper_id: str) -> dict:
    for b in buckets:
        if b["bucket_type"] == "paper_level":
            paper = (b.get("records", {}) or {}).get("paper", {}) or {}
            return {
                "title": paper.get("title") or paper_id,
                "doi": paper.get("doi"),
                "journal": paper.get("journal"),
                "year": paper.get("publication_year"),
                "authors": paper.get("authors", []),
            }
    return {"title": paper_id}


# --------------------------------------------------------------------------- #
# Annotation state
# --------------------------------------------------------------------------- #
def default_annotation(paper_id: str) -> dict:
    return {
        "paper_id": paper_id,
        "schema_version": ANNOT_SCHEMA_VERSION,
        "task_status": "not_started",   # not_started | in_progress | submitted
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "fields": {},          # field_id -> {review_status, current_value, note, evidence_refs_override, updated_at}
        "added_fields": [],    # reviewer-supplied fields
        "buckets": {},         # bucket_id -> {status, note}
        "audit_log": [],       # append-only event stream
    }


def load_annotation(paper_id: str) -> dict:
    data = try_read_json(annot_path(paper_id))
    if not isinstance(data, dict):
        return default_annotation(paper_id)
    # forward-compatible defaults
    base = default_annotation(paper_id)
    base.update(data)
    return base


def save_annotation(paper_id: str, data: dict) -> dict:
    data["paper_id"] = paper_id
    data["schema_version"] = ANNOT_SCHEMA_VERSION
    data["updated_at"] = now_iso()
    tmp = annot_path(paper_id).with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    tmp.replace(annot_path(paper_id))
    return data


def progress_of(fields: list[dict], annot: dict) -> dict:
    """Completeness snapshot used for the paper list + header progress bar."""
    total = len(fields)
    fa = annot.get("fields", {})
    counts = {
        "confirmed": 0,
        "modified": 0,
        "conflict": 0,
        "needs_review": 0,
        "unprocessed": 0,
    }
    for f in fields:
        st = fa.get(f["field_id"], {}).get("review_status", "unprocessed")
        counts[st] = counts.get(st, 0) + 1
    done = counts["confirmed"] + counts["modified"]
    return {
        "total": total,
        "counts": counts,
        "added": len(annot.get("added_fields", [])),
        "done": done,
        "pct": round(100 * done / total) if total else 0,
        "task_status": annot.get("task_status", "not_started"),
    }


# --------------------------------------------------------------------------- #
# Discovery
# --------------------------------------------------------------------------- #
def discover_papers() -> list[str]:
    if not EXTRACTED_DIR.is_dir():
        return []
    ids = []
    for d in sorted(EXTRACTED_DIR.iterdir()):
        if d.is_dir() and (d / "extraction_postprocess" / "field_evidence.json").exists():
            ids.append(d.name)
    return ids


# --------------------------------------------------------------------------- #
# App
# --------------------------------------------------------------------------- #
app = FastAPI(title="Evidence Note Annotator")


class SaveBody(BaseModel):
    annotation: dict


@app.get("/api/papers")
def list_papers():
    out = []
    for pid in discover_papers():
        pdir = paper_dir(pid)
        fields, _ = load_fields(pdir)
        buckets = load_buckets(pdir)
        annot = load_annotation(pid)
        out.append(
            {
                "paper_id": pid,
                **paper_title(buckets, pid),
                "progress": progress_of(fields, annot),
                "bucket_count": len(buckets),
            }
        )
    return {"papers": out}


@app.get("/api/papers/{paper_id}")
def get_paper(paper_id: str):
    pdir = paper_dir(paper_id)
    blocks = load_blocks(pdir)
    fields, field_meta = load_fields(pdir)
    buckets = load_buckets(pdir)
    annot = load_annotation(paper_id)

    knowledge = ""
    kpath = pdir / "final" / "text_knowledge.md"
    if kpath.exists():
        knowledge = kpath.read_text(encoding="utf-8")

    return {
        "paper_id": paper_id,
        "meta": {**paper_title(buckets, paper_id), **field_meta},
        "blocks": blocks,
        "fields": fields,
        "buckets": buckets,
        "annotation": annot,
        "progress": progress_of(fields, annot),
        "knowledge_md": knowledge,
        "asset_base": f"/api/papers/{paper_id}/asset/",
    }


@app.put("/api/papers/{paper_id}/annotation")
def put_annotation(paper_id: str, body: SaveBody):
    paper_dir(paper_id)  # validate
    saved = save_annotation(paper_id, body.annotation)
    pdir = paper_dir(paper_id)
    fields, _ = load_fields(pdir)
    return {"ok": True, "updated_at": saved["updated_at"], "progress": progress_of(fields, saved)}


@app.get("/api/papers/{paper_id}/asset/{asset_path:path}")
def get_asset(paper_id: str, asset_path: str):
    pdir = paper_dir(paper_id)
    # Source markdown references images as images/<hash>.jpg
    name = Path(asset_path).name
    candidates = [
        pdir / "source" / "mineru" / "images" / name,
        pdir / "source" / "mineru" / asset_path,
        pdir / asset_path,
    ]
    for c in candidates:
        c = c.resolve()
        if c.is_file() and pdir.resolve() in c.parents:
            return FileResponse(c)
    raise HTTPException(status_code=404, detail="Asset not found")


@app.get("/api/papers/{paper_id}/export")
def export_paper(paper_id: str):
    """Build a downstream-ready bundle on the fly.

    Directory layout inside the zip::

        <paper_id>/
          MANIFEST.json                     (machine) what's inside + status
          review_summary.md                 (human)   readable review report
          annotation_state.json             (machine) raw reviewer state
          text_extraction.reviewed.json     (machine) values after review, downstream-ready
          field_review.json                 (machine) per-field decision + evidence
          diff.json                         (machine) original -> reviewed changes
          audit_log.jsonl                   (machine/human) event stream
    """
    pdir = paper_dir(paper_id)
    fields, field_meta = load_fields(pdir)
    buckets = load_buckets(pdir)
    annot = load_annotation(paper_id)
    fa = annot.get("fields", {})

    # ---- per-field review + diff --------------------------------------- #
    field_review = []
    diffs = []
    for f in fields:
        st = fa.get(f["field_id"], {})
        status = st.get("review_status", "unprocessed")
        cur = st.get("current_value", f["value"])
        refs = st.get("evidence_refs_override") or f["evidence_refs"]
        field_review.append(
            {
                "field_id": f["field_id"],
                "section": f["section"],
                "path": f["path"],
                "original_value": f["value"],
                "reviewed_value": cur,
                "review_status": status,
                "evidence_refs": refs,
                "support_label": f["support_label"],
                "confidence": f["confidence"],
                "note": st.get("note", ""),
            }
        )
        if cur != f["value"]:
            diffs.append(
                {
                    "field_id": f["field_id"],
                    "path": f["path"],
                    "from": f["value"],
                    "to": cur,
                    "status": status,
                }
            )

    # ---- reviewed structured JSON (values patched into the original) ---- #
    # field_review.json (above) is the *authoritative* machine artifact; this
    # structured copy is a best-effort merge using the pipeline's path DSL.
    # Any edit whose path cannot be resolved is recorded in unapplied_edits so
    # the merge is never silently wrong.
    reviewed = try_read_json(pdir / "verify" / "text_extraction_fixed.json")
    if reviewed is None:
        reviewed = try_read_json(pdir / "final" / "text_extraction.json") or {}
    reviewed = json.loads(json.dumps(reviewed))  # deep copy
    unapplied_edits = []
    for f in fields:
        st = fa.get(f["field_id"], {})
        if "current_value" in st and st["current_value"] != f["value"]:
            ok = apply_reviewed_edit(reviewed, f["path"], st["current_value"])
            if not ok:
                unapplied_edits.append({"field_id": f["field_id"], "path": f["path"],
                                        "reviewed_value": st["current_value"]})

    prog = progress_of(fields, annot)

    manifest = {
        "paper_id": paper_id,
        "exported_at": now_iso(),
        "schema": "evidence-annotation-export-v1",
        "task_status": annot.get("task_status"),
        "progress": prog,
        "files": {
            "machine": [
                "annotation_state.json",
                "text_extraction.reviewed.json",
                "field_review.json",
                "diff.json",
                "audit_log.jsonl",
            ],
            "human": ["review_summary.md", "MANIFEST.json"],
        },
        "added_field_count": len(annot.get("added_fields", [])),
        "changed_field_count": len(diffs),
        "authoritative_machine_file": "field_review.json",
        "reviewed_json_is_best_effort": True,
        "unapplied_edits": unapplied_edits,
    }

    summary_md = _render_summary_md(paper_id, field_meta, prog, diffs, annot, buckets)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        base = paper_id
        z.writestr(f"{base}/MANIFEST.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        z.writestr(f"{base}/review_summary.md", summary_md)
        z.writestr(f"{base}/annotation_state.json", json.dumps(annot, ensure_ascii=False, indent=2))
        z.writestr(f"{base}/text_extraction.reviewed.json", json.dumps(reviewed, ensure_ascii=False, indent=2))
        z.writestr(f"{base}/field_review.json", json.dumps({"paper_id": paper_id, "fields": field_review, "added_fields": annot.get("added_fields", [])}, ensure_ascii=False, indent=2))
        z.writestr(f"{base}/diff.json", json.dumps({"paper_id": paper_id, "changes": diffs}, ensure_ascii=False, indent=2))
        z.writestr(f"{base}/audit_log.jsonl", "\n".join(json.dumps(e, ensure_ascii=False) for e in annot.get("audit_log", [])))

    buf.seek(0)
    fname = f"{paper_id}_annotation_export.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


def _render_summary_md(paper_id, field_meta, prog, diffs, annot, buckets) -> str:
    title = paper_title(buckets, paper_id)
    lines = [
        f"# Review Summary — {title.get('title', paper_id)}",
        "",
        f"- Paper ID: `{paper_id}`",
        f"- DOI: {title.get('doi', 'n/a')}",
        f"- Task status: **{annot.get('task_status')}**",
        f"- Fields: {prog['total']} | reviewed (confirmed+modified): {prog['done']} ({prog['pct']}%)",
        f"- Breakdown: {prog['counts']}",
        f"- Reviewer-added fields: {prog['added']}",
        f"- Changed values: {len(diffs)}",
        "",
        "## Changed fields",
        "",
    ]
    if diffs:
        for d in diffs:
            lines.append(f"- `{d['path']}` [{d['status']}]")
            lines.append(f"  - from: {d['from']!r}")
            lines.append(f"  - to:   {d['to']!r}")
    else:
        lines.append("_No value changes._")
    lines += ["", "## Reviewer-added fields", ""]
    added = annot.get("added_fields", [])
    if added:
        for a in added:
            lines.append(f"- `{a.get('path','(new)')}` = {a.get('value')!r} (bucket: {a.get('bucket_id')})")
    else:
        lines.append("_None._")
    return "\n".join(lines) + "\n"


# --- pipeline path DSL resolver ------------------------------------------- #
# Paths look like:
#   papers.<paper_id>.authors[0]
#   samples.<sample_id>__idx_0.alloy_id
#   structures.<sample_id>__structure_id_<sid>.microstructure_list[1].phases_present[austenitic_matrix].crystal_structure
#   characterization_methods.idx_2.characterization_id
# i.e. <section>.<element-locator>.<chain>, where element-locator embeds the
# element's id (which may itself contain dots) plus synthetic disambiguators.
def _element_locator(section: str, elem: dict, index: int) -> Optional[str]:
    """Regenerate the exact locator the pipeline emitted for this element."""
    # idx-based sections address elements positionally, even scalar elements.
    if section in ("characterization_methods", "unmapped_findings"):
        return f"idx_{index}"
    if not isinstance(elem, dict):
        return None
    sid = elem.get("sample_id")
    rules = {
        "papers": lambda: elem.get("paper_id"),
        "alloys": lambda: elem.get("alloy_id"),
        "processes": lambda: elem.get("process_id"),
        "samples": lambda: f"{sid}__idx_{index}",
        "processing_steps": lambda: f"{sid}__sequence_{elem.get('sequence')}",
        "structures": lambda: f"{sid}__structure_id_{elem.get('structure_id')}",
        "interfaces": lambda: f"{sid}__interface_set_id_{elem.get('interface_set_id')}",
        "properties": lambda: f"{sid}__property_set_id_{elem.get('property_set_id')}",
        "performance": lambda: f"{sid}__performance_id_{elem.get('performance_id')}",
        "computational_details": lambda: f"{sid}__computation_id_{elem.get('computation_id')}",
        "characterization_methods": lambda: f"idx_{index}",
        "unmapped_findings": lambda: f"idx_{index}",
    }
    fn = rules.get(section)
    return fn() if fn else None


_ID_LIKE_FIELDS = ("phase_name", "name", "phase", "id", "region", "label", "key")


def _match_list_by_id(lst: list, key: str) -> Optional[int]:
    """Find the index of a list element identified by an embedded id `key`."""
    for i, e in enumerate(lst):
        if isinstance(e, dict):
            for fld in _ID_LIKE_FIELDS:
                if str(e.get(fld)) == key:
                    return i
            # any *_id / *_name field matching
            for k, v in e.items():
                if (k.endswith("_id") or k.endswith("_name")) and str(v) == key:
                    return i
    return None


_CHAIN_RE = re.compile(r"\.([^.\[\]]+)|\[([^\]]+)\]")


def _walk_chain_set(node: Any, chain: str, value: Any) -> bool:
    """Walk a ``.key`` / ``[int]`` / ``[key]`` chain and set the leaf."""
    steps = []
    for m in _CHAIN_RE.finditer(chain):
        steps.append(m.group(1) if m.group(1) is not None else m.group(2))
    if not steps:
        return False
    cur = node
    for i, step in enumerate(steps):
        last = i == len(steps) - 1
        if isinstance(cur, list):
            if step.lstrip("-").isdigit():
                idx = int(step)
            else:
                # list addressed by an embedded id key, e.g. phases_present[austenitic_matrix]
                idx = _match_list_by_id(cur, step)
                if idx is None:
                    return False
            if idx >= len(cur):
                return False
            if last:
                cur[idx] = value
                return True
            cur = cur[idx]
        elif isinstance(cur, dict):
            if step not in cur:
                return False
            if last:
                cur[step] = value
                return True
            cur = cur[step]
        else:
            return False
    return False


def apply_reviewed_edit(root: dict, path: str, value: Any) -> bool:
    """Apply one reviewed value into the structured JSON. Returns True on success.

    Never raises and never partially corrupts the document on failure: it only
    ever writes the single leaf once the full path has resolved."""
    dot = path.find(".")
    if dot < 0:
        return False
    section, rest = path[:dot], path[dot + 1:]
    container = root.get(section)
    if container is None:
        return False

    # locate the element within the section
    if isinstance(container, list):
        # build candidate locators, match the longest that prefixes `rest`
        cands = []
        for i, elem in enumerate(container):
            loc = _element_locator(section, elem, i)
            if loc and (rest == loc or rest.startswith(loc + ".") or rest.startswith(loc + "[")):
                cands.append((len(loc), loc, i, elem))
        if not cands:
            return False
        cands.sort(reverse=True)
        _, loc, idx, elem = cands[0]
        chain = rest[len(loc):]
        if chain == "":  # editing the element itself is unsupported
            return False
        # scalar list element addressed as `.value` -> replace the element itself
        if not isinstance(elem, (dict, list)) and chain == ".value":
            container[idx] = value
            return True
        return _walk_chain_set(elem, chain, value)
    elif isinstance(container, dict):
        return _walk_chain_set(container, "." + rest, value)
    return False


# Static SPA (mounted last so /api/* wins)
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
