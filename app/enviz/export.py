"""Downstream-ready export bundle.

Because slots are JSON pointers, reviewed values are written back into the
structured document exactly (no best-effort path guessing).
"""
from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

from . import dsl
from .annotations import load_annotation, progress_of
from .metrics import compute_metrics
from .slots import PaperModel
from .utils import deep_copy, now_iso


def build_export(pdir: Path, paper_id: str) -> bytes:
    model = PaperModel(pdir)
    slots = model.slots
    annot = load_annotation(paper_id)
    fa = annot.get("fields", {})

    field_review, diffs = [], []
    reviewed = deep_copy(model.root)
    unapplied = []

    for s in slots:
        a = fa.get(s["field_id"], {})
        status = a.get("review_status", "unprocessed")
        rv = a.get("current_value", s["value"])
        refs = a.get("evidence_refs_override") or s["evidence_refs"]
        field_review.append({
            "slot_id": s["field_id"], "pointer": s["pointer"], "section": s["section"],
            "path": s["path"], "original_value": s["value"], "reviewed_value": rv,
            "review_status": status, "evidence_refs": refs,
            "support_label": s["support_label"], "confidence": s["confidence"],
            "evidence_field_id": s.get("evidence_field_id"), "note": a.get("note", ""),
        })
        if "current_value" in a and a["current_value"] != s["value"]:
            diffs.append({"slot_id": s["field_id"], "path": s["path"],
                          "from": s["value"], "to": rv, "status": status})
            if not dsl.set_by_pointer(reviewed, s["pointer"], rv):
                unapplied.append({"slot_id": s["field_id"], "path": s["path"]})

    prog = progress_of(slots, annot)
    metrics = compute_metrics(paper_id, slots, annot)
    meta = model.paper_meta()

    manifest = {
        "paper_id": paper_id, "exported_at": now_iso(),
        "schema": "evidence-annotation-export-v2",
        "task_status": annot.get("task_status"), "progress": prog,
        "metrics_overall": metrics["overall"], "coverage": metrics["coverage"],
        "files": {
            "machine": ["annotation_state.json", "text_extraction.reviewed.json",
                        "field_review.json", "diff.json", "evaluation_metrics.json",
                        "audit_log.jsonl"],
            "human": ["review_summary.md", "MANIFEST.json"],
        },
        "authoritative_machine_file": "field_review.json",
        "added_field_count": len(annot.get("added_fields", [])),
        "changed_field_count": len(diffs),
        "unapplied_edits": unapplied,
    }
    summary_md = _summary_md(paper_id, meta, prog, diffs, annot, metrics)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        b = paper_id
        z.writestr(f"{b}/MANIFEST.json", _j(manifest))
        z.writestr(f"{b}/review_summary.md", summary_md)
        z.writestr(f"{b}/annotation_state.json", _j(annot))
        z.writestr(f"{b}/text_extraction.reviewed.json", _j(reviewed))
        z.writestr(f"{b}/field_review.json", _j({"paper_id": paper_id, "fields": field_review,
                                                 "added_fields": annot.get("added_fields", [])}))
        z.writestr(f"{b}/diff.json", _j({"paper_id": paper_id, "changes": diffs}))
        z.writestr(f"{b}/evaluation_metrics.json", _j(metrics))
        z.writestr(f"{b}/audit_log.jsonl",
                   "\n".join(json.dumps(e, ensure_ascii=False) for e in annot.get("audit_log", [])))
    return buf.getvalue()


def _j(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2)


def _summary_md(paper_id, meta, prog, diffs, annot, metrics) -> str:
    ov, cov = metrics["overall"], metrics["coverage"]
    lines = [
        f"# Review Summary — {meta.get('title', paper_id)}", "",
        f"- Paper ID: `{paper_id}`  ·  DOI: {meta.get('doi', 'n/a')}",
        f"- Task status: **{annot.get('task_status')}**",
        f"- Slots: {prog['total']} · reviewed {prog['done']} ({prog['pct']}%) · added {prog['added']}",
        f"- Breakdown: {prog['counts']}", "",
        "## Evaluation (golden = reviewer, pred = original extraction)", "",
        f"- **Precision {ov['precision']} · Recall {ov['recall']} · F1 {ov['f1']}**",
        f"- TP={ov['tp']} FP={ov['fp']} FN={ov['fn']} · TN={cov['true_negatives']} · "
        f"reviewed {cov['reviewed_slots']}/{cov['total_slots']} ({cov['reviewed_pct']}%), pending {cov['pending_slots']}",
        "", "| section | P | R | F1 | TP | FP | FN |", "|---|---|---|---|---|---|---|",
    ]
    for s, m in metrics["per_section"].items():
        lines.append(f"| {s} | {m['precision']} | {m['recall']} | {m['f1']} | {m['tp']} | {m['fp']} | {m['fn']} |")
    lines += ["", "## Changed fields", ""]
    if diffs:
        for d in diffs:
            lines += [f"- `{d['path']}` [{d['status']}]", f"  - from: {d['from']!r}", f"  - to:   {d['to']!r}"]
    else:
        lines.append("_No value changes._")
    lines += ["", "## Reviewer-added fields", ""]
    added = annot.get("added_fields", [])
    lines += [f"- `{a.get('path', '(new)')}` = {a.get('value')!r} (bucket: {a.get('bucket_id')})" for a in added] or ["_None._"]
    return "\n".join(lines) + "\n"
