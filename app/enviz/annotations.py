"""Reviewer state persistence + progress.

Annotation documents are keyed by slot id (JSON pointer) and stored one file
per paper under ``annotations/``. Writes are atomic.
"""
from __future__ import annotations

import json
from pathlib import Path

from .config import ANNOT_DIR, ANNOT_SCHEMA_VERSION
from .utils import now_iso, try_read_json


def annot_path(paper_id: str) -> Path:
    return ANNOT_DIR / f"{paper_id.replace('/', '_')}.json"


def default_annotation(paper_id: str) -> dict:
    return {
        "paper_id": paper_id,
        "schema_version": ANNOT_SCHEMA_VERSION,
        "task_status": "not_started",     # not_started | in_progress | submitted
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "fields": {},        # slot_id -> {review_status, current_value, note, evidence_refs_override}
        "added_fields": [],  # reviewer-supplied fields not in the schema
        "buckets": {},       # bucket_id -> {status, note}
        "audit_log": [],     # append-only event stream
    }


def load_annotation(paper_id: str) -> dict:
    data = try_read_json(annot_path(paper_id))
    base = default_annotation(paper_id)
    if isinstance(data, dict):
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


def progress_of(slots: list[dict], annot: dict) -> dict:
    total = len(slots)
    fa = annot.get("fields", {})
    counts = {"confirmed": 0, "modified": 0, "conflict": 0, "needs_review": 0, "unprocessed": 0}
    for s in slots:
        st = fa.get(s["field_id"], {}).get("review_status", "unprocessed")
        counts[st] = counts.get(st, 0) + 1
    done = counts["confirmed"] + counts["modified"]
    return {
        "total": total, "counts": counts,
        "added": len(annot.get("added_fields", [])),
        "done": done, "pct": round(100 * done / total) if total else 0,
        "task_status": annot.get("task_status", "not_started"),
    }
