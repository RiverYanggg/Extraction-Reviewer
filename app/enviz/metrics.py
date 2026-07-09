"""Null-aware precision / recall / F1.

Golden = reviewer decisions, prediction = original extraction. Unit = field slot.
Predefined ``null`` slots participate: correctly-empty slots are true negatives
(ignored by P/R), while a reviewer filling a null slot is a recall miss (FN).

  confirmed, original non-null           -> TP   (correct extraction)
  confirmed, original null               -> TN   (correct empty; not in P/R)
  modified, null -> value                -> FN   (omission the model missed)
  modified, value -> value'              -> FP + FN (substitution)
  modified, value -> null                -> FP   (hallucination removed)
  conflict, original non-null            -> FP   (wrong extraction)
  needs_review / unprocessed             -> pending (excluded from P/R)
  reviewer-added field                   -> FN   (schema-external omission)
"""
from __future__ import annotations

from .config import SECTION_LABELS_ZH


def _is_null(v) -> bool:
    return v is None or v == "" or v == [] or v == {}


def _prf(tp: int, fp: int, fn: int) -> dict:
    p = tp / (tp + fp) if (tp + fp) else 0.0
    r = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * p * r / (p + r) if (p + r) else 0.0
    return {"tp": tp, "fp": fp, "fn": fn,
            "precision": round(p, 4), "recall": round(r, 4), "f1": round(f1, 4)}


def compute_metrics(paper_id: str, slots: list[dict], annot: dict) -> dict:
    fa = annot.get("fields", {})
    tp, fp, fn = {}, {}, {}
    tn = pending = reviewed = 0

    def bump(d, k):
        d[k] = d.get(k, 0) + 1

    for s in slots:
        sec = s["section"]
        a = fa.get(s["field_id"], {})
        st = a.get("review_status", "unprocessed")
        ov = s["value"]
        rv = a.get("current_value", ov)
        if st == "confirmed":
            reviewed += 1
            if _is_null(ov):
                tn += 1
            else:
                bump(tp, sec)
        elif st == "modified":
            reviewed += 1
            if _is_null(ov) and not _is_null(rv):
                bump(fn, sec)
            elif not _is_null(ov) and not _is_null(rv):
                bump(fp, sec); bump(fn, sec)
            elif not _is_null(ov) and _is_null(rv):
                bump(fp, sec)
            else:
                tn += 1
        elif st == "conflict":
            reviewed += 1
            if not _is_null(ov):
                bump(fp, sec)
        else:
            pending += 1

    for added in annot.get("added_fields", []):
        bump(fn, added.get("section", "added"))

    sections = sorted(set(tp) | set(fp) | set(fn))
    per_section = {s: _prf(tp.get(s, 0), fp.get(s, 0), fn.get(s, 0)) for s in sections}
    per_section_labeled = {
        SECTION_LABELS_ZH.get(s, s): v for s, v in per_section.items()
    }
    overall = _prf(sum(tp.values()), sum(fp.values()), sum(fn.values()))

    total = len(slots)
    return {
        "paper_id": paper_id,
        "schema": "evidence-annotation-metrics-v2",
        "definition": {
            "golden": "reviewer decisions", "prediction": "original extraction",
            "unit": "field slot (incl. predefined null slots)",
            "TP": "confirmed & non-null", "TN": "confirmed & null (excluded from P/R)",
            "FP": "modified(→value) + conflict(non-null)",
            "FN": "modified(null→value / substitution) + added",
            "pending_excluded": "needs_review + unprocessed",
        },
        "overall": overall,
        "per_section": per_section,
        "per_section_labeled": per_section_labeled,
        "coverage": {
            "total_slots": total, "reviewed_slots": reviewed, "pending_slots": pending,
            "true_negatives": tn, "added_fields": len(annot.get("added_fields", [])),
            "reviewed_pct": round(100 * reviewed / total, 1) if total else 0.0,
        },
    }
