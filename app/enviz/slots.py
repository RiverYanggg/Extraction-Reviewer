"""The annotation-unit ("slot") model.

A *slot* is a single leaf of the (schema-completed) structured document —
every scalar, every explicit ``null`` predefined field. Slots are identified
by their JSON pointer, which is stable and lets us attach evidence and write
reviewed values back exactly.

This module produces, per paper:
  * ``slots``   – flat list the UI indexes by ``field_id`` (= pointer)
  * ``buckets`` – paper_level + per-sample, each carrying a nested JSON ``tree``
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Optional
from copy import deepcopy

from . import dsl
from .config import SECTION_LABELS_ZH
from .schema import complete_grouped_sample_records, complete_with_schema, load_schema
from .utils import try_read_json

# canonical display order of sections within a bucket
SECTION_ORDER = [
    "papers", "samples", "alloys", "processes", "processing_steps",
    "structures", "interfaces", "properties", "performance",
    "characterization_methods", "computational_details", "unmapped_findings",
]
PAPER_LEVEL_SECTIONS = {
    "papers", "characterization_methods", "computational_details", "unmapped_findings",
}


def _is_leaf(v: Any) -> bool:
    if isinstance(v, dict):
        return len(v) == 0
    if isinstance(v, list):
        return len(v) == 0
    return True


def structured_root(pdir: Path) -> dict:
    root = try_read_json(_viewer_dir(pdir) / "verify" / "text_extraction_fixed.json")
    if root is None:
        root = try_read_json(_viewer_dir(pdir) / "final" / "text_extraction.json") or {}
    return root


def grouped_root(pdir: Path) -> dict | None:
    """Return the agentic reading view when it is available.

    The adapter directory can be present beside the published final artifacts,
    so inspect both locations.  The grouped view is intentionally preferred
    for review because its root mirrors the paper/sample bucket layout.
    """
    candidates = [pdir / "final" / "sample_grouped_extraction.json",
                  _viewer_dir(pdir) / "final" / "sample_grouped_extraction.json"]
    for path in candidates:
        value = try_read_json(path)
        if isinstance(value, dict) and isinstance(value.get("paper"), dict) and isinstance(value.get("samples"), list):
            return value
    return None


def load_field_evidence(pdir: Path) -> dict:
    return try_read_json(_viewer_dir(pdir) / "extraction_postprocess" / "field_evidence.json") or {}


def load_bucket_defs(pdir: Path) -> list[dict]:
    sb = try_read_json(_viewer_dir(pdir) / "extraction_postprocess" / "sample_buckets.json") or {}
    return sb.get("buckets", [])


def _viewer_dir(pdir: Path) -> Path:
    return pdir / "viewer" if (pdir / "viewer").is_dir() else pdir


def _element_label(section: str, elem: Any, index: int) -> str:
    if isinstance(elem, dict):
        specific = {
            "processing_steps": lambda: f"步骤 {elem.get('sequence', index + 1)} · {elem.get('type') or elem.get('method') or ''}".strip(" ·"),
            "structures": lambda: f"结构 {elem.get('structure_id', index)}",
            "characterization_methods": lambda: elem.get("technique") or elem.get("characterization_id") or f"方法 {index}",
            "interfaces": lambda: f"界面 {elem.get('interface_set_id', index)}",
            "properties": lambda: f"性能集 {elem.get('property_set_id', index)}",
            "performance": lambda: f"服役 {elem.get('performance_id', index)}",
            "computational_details": lambda: f"计算 {elem.get('computation_id', index)}",
        }
        if section in specific:
            return specific[section]()
        for k in ("sample_id", "alloy_id", "process_id", "paper_id"):
            if elem.get(k):
                return str(elem[k])
    if isinstance(elem, str):
        return elem[:40]
    return f"#{index}"


def _list_item_label(item: Any, index: int) -> str:
    if isinstance(item, dict):
        for k in dsl._ID_LIKE_FIELDS:
            if item.get(k):
                return f"{k}={item[k]}"
        for k, v in item.items():
            if (k.endswith("_id") or k.endswith("_name")) and v:
                return f"{v}"
    return f"[{index}]"


class PaperModel:
    """Builds slots + bucketed trees for one paper."""

    def __init__(self, pdir: Path):
        self.pdir = pdir
        self.grouped = grouped_root(pdir)
        self.root = self.grouped if self.grouped is not None else complete_with_schema(structured_root(pdir), load_schema())
        self.review_root = self._review_root()
        self.source_root = structured_root(pdir)
        self.fe = load_field_evidence(pdir)
        self.bucket_defs = load_bucket_defs(pdir)

        self.evidence_by_ptr: dict[str, dict] = {}
        self.element_bucket: dict[str, str] = {}   # "section/idx" -> bucket_id
        self.slots: list[dict] = []
        self.slot_index: dict[str, dict] = {}

        self._index_evidence()
        if self.grouped is not None:
            self._enumerate_grouped()
        else:
            self._enumerate_and_bucket()

    # -- evidence + element->bucket from tracked fields ------------------- #
    def _index_evidence(self):
        fid_bucket = {}
        for b in self.bucket_defs:
            for fid in b.get("field_ids", []):
                fid_bucket[fid] = b["bucket_id"]

        for f in self.fe.get("fields", []):
            path = f.get("path", "")
            # Evidence paths always address the normalized extraction artifact,
            # even when the review surface is the derived grouped view.
            tokens = dsl.resolve_to_pointer(self.source_root, path)
            support = f.get("support", {}) or {}
            refs = support.get("evidence_refs", []) or []
            label = support.get("support_label", "unknown")
            info = {
                "evidence_field_id": f.get("field_id"),
                "dsl_path": path,
                "evidence_refs": refs,
                "support_label": label,
                "confidence": support.get("confidence"),
                "contradiction": bool(support.get("contradiction")),
                "reason": support.get("reason"),
                "method": support.get("method"),
                "no_evidence": len(refs) == 0 or label == "unsupported",
            }
            if tokens:
                ptr = dsl.pointer_str(tokens)
                self.evidence_by_ptr[ptr] = info
                elem_ptr = dsl.pointer_str(tokens[:2])
                bucket = fid_bucket.get(f.get("field_id"))
                if bucket:
                    self.element_bucket.setdefault(elem_ptr, bucket)

    def _paper_level_id(self) -> str:
        for b in self.bucket_defs:
            if b.get("bucket_type") == "paper_level":
                return b["bucket_id"]
        return self.bucket_defs[0]["bucket_id"] if self.bucket_defs else "paper_level"

    def _sample_bucket_ids(self) -> set:
        return {b["bucket_id"] for b in self.bucket_defs if b.get("bucket_type") == "sample"}

    def _bucket_for_element(self, section: str, idx: int, elem: Any) -> str:
        ep = dsl.pointer_str([section, idx])
        if ep in self.element_bucket:
            return self.element_bucket[ep]
        # fallback for fully-null elements
        if section in PAPER_LEVEL_SECTIONS:
            return self._paper_level_id()
        sid = elem.get("sample_id") if isinstance(elem, dict) else None
        if sid and sid in self._sample_bucket_ids():
            return sid
        return self._paper_level_id()

    # -- enumerate slots + assign elements to buckets --------------------- #
    def _enumerate_and_bucket(self):
        self._bucket_elements: dict[str, dict[str, list[int]]] = {}
        for section in self.root:
            container = self.root.get(section)
            if not isinstance(container, list):
                continue
            for idx, elem in enumerate(container):
                bucket = self._bucket_for_element(section, idx, elem)
                self._bucket_elements.setdefault(bucket, {}).setdefault(section, []).append(idx)
                self._walk_slots(elem, [section, idx], section)

    def _walk_slots(self, node: Any, tokens: list, section: str):
        if _is_leaf(node):
            self._add_slot(node, tokens, section)
            return
        if isinstance(node, dict):
            for k, v in node.items():
                self._walk_slots(v, tokens + [k], section)
        elif isinstance(node, list):
            for i, v in enumerate(node):
                self._walk_slots(v, tokens + [i], section)

    def _add_slot(self, value: Any, tokens: list, section: str):
        ptr = dsl.pointer_str(tokens)
        ev = self.evidence_by_ptr.get(ptr, self._grouped_evidence(tokens, value))
        bucket_id = "paper_level"
        if self.grouped is not None and len(tokens) >= 2 and tokens[0] == "samples":
            bucket_id = next((bid for bid, root in self._bucket_roots.items() if root == tokens[:2]), "paper_level")
        slot = {
            "field_id": ptr,
            "pointer": list(tokens),
            "section": section,
            "label": str(tokens[-1]),
            "path": ev.get("dsl_path") or ptr.replace("/", "."),
            "value": value,
            "evidence_refs": ev.get("evidence_refs", []),
            "support_label": ev.get("support_label", "untracked"),
            "confidence": ev.get("confidence"),
            "contradiction": ev.get("contradiction", False),
            "reason": ev.get("reason"),
            "method": ev.get("method"),
            "no_evidence": ev.get("no_evidence", not ev),
            "tracked": bool(ev),
            "evidence_field_id": ev.get("evidence_field_id"),
            "bucket_id": bucket_id,
        }
        self.slots.append(slot)
        self.slot_index[ptr] = slot

    def _grouped_evidence(self, tokens: list, value: Any) -> dict:
        """Best-effort evidence transfer from normalized source to grouped view.

        The Agentic grouped view omits repeated identifiers and changes array
        positions.  Matching a uniquely tracked leaf by key/value preserves
        evidence navigation without inventing provenance for ambiguous values.
        """
        if self.grouped is None or not tokens:
            return {}
        key = str(tokens[-1])
        matches = []
        for pointer, info in self.evidence_by_ptr.items():
            source_tokens = pointer.split("/")
            if source_tokens and source_tokens[-1] == key:
                try:
                    if dsl.get_by_pointer(self.source_root, [int(t) if t.isdigit() else t for t in source_tokens]) == value:
                        matches.append(info)
                except (KeyError, IndexError, TypeError):
                    continue
        return matches[0] if len(matches) == 1 else {}

    def _enumerate_grouped(self):
        self._bucket_roots: dict[str, list] = {"paper_level": ["paper"]}
        self._bucket_types: dict[str, str] = {"paper_level": "paper_level"}
        self._walk_slots(self.review_root.get("paper", {}), ["paper"], "paper")
        for idx, sample in enumerate(self.review_root.get("samples", [])):
            sid = sample.get("sample", {}).get("sample_id") if isinstance(sample, dict) else None
            bucket = sid or f"sample_{idx + 1}"
            self._bucket_roots[bucket] = ["samples", idx]
            self._bucket_types[bucket] = "sample"
            self._walk_slots(sample, ["samples", idx], "sample")
        if self.review_root.get("unassigned_sample_records") or self.review_root.get("unclassified_sections"):
            for key in ("unassigned_sample_records", "unclassified_sections"):
                if key in self.review_root:
                    self._walk_slots(self.review_root[key], [key], "paper")

    def _review_root(self) -> dict:
        if self.grouped is None:
            return self.root
        view = deepcopy(self.root)
        for sample in view.get("samples", []):
            if isinstance(sample, dict):
                sample.pop("linked_paper_records", None)
        return complete_grouped_sample_records(view, load_schema())

    def export_root(self) -> dict:
        """Return a reviewed grouped artifact without dropping linkage context."""
        if self.grouped is None:
            return deepcopy(self.root)
        return complete_grouped_sample_records(deepcopy(self.root), load_schema())

    # -- trees ------------------------------------------------------------ #
    def _subtree(self, node: Any, tokens: list) -> list[dict]:
        """Children nodes for a container `node` at `tokens`."""
        out = []
        items = node.items() if isinstance(node, dict) else enumerate(node)
        for k, v in items:
            child_tokens = tokens + [k]
            if _is_leaf(v):
                out.append({
                    "id": dsl.pointer_str(child_tokens),
                    "key": str(k), "label": str(k),
                    "kind": "leaf", "field_id": dsl.pointer_str(child_tokens),
                })
            else:
                label = str(k) if isinstance(node, dict) else _list_item_label(v, k)
                out.append({
                    "id": dsl.pointer_str(child_tokens),
                    "key": str(k), "label": label,
                    "kind": "branch", "children": self._subtree(v, child_tokens),
                })
        return out

    def build_tree(self, bucket_id: str) -> list[dict]:
        elems = self._bucket_elements.get(bucket_id, {})
        ordered = [s for s in SECTION_ORDER if s in elems] + \
                  [s for s in elems if s not in SECTION_ORDER]
        sections = []
        for section in ordered:
            indices = sorted(elems[section])
            sec_node = {"id": f"sec:{section}", "key": section,
                        "label": SECTION_LABELS_ZH.get(section, section),
                        "kind": "section", "children": []}
            multi = len(indices) > 1
            for idx in indices:
                elem = self.root[section][idx]
                base = [section, idx]
                if _is_leaf(elem):  # e.g. unmapped_findings scalar
                    sec_node["children"].append({
                        "id": dsl.pointer_str(base), "key": str(idx),
                        "label": _element_label(section, elem, idx),
                        "kind": "leaf", "field_id": dsl.pointer_str(base)})
                    continue
                if multi:
                    el_node = {"id": dsl.pointer_str(base), "key": str(idx),
                               "label": _element_label(section, elem, idx),
                               "kind": "element", "children": self._subtree(elem, base)}
                    sec_node["children"].append(el_node)
                else:
                    sec_node["children"].extend(self._subtree(elem, base))
            sections.append(sec_node)
        return sections

    def buckets_payload(self) -> list[dict]:
        if self.grouped is not None:
            out = []
            for bucket, tokens in self._bucket_roots.items():
                node = dsl.get_by_pointer(self.review_root, tokens)
                tree = self._subtree(node, tokens) if not _is_leaf(node) else [{"id": dsl.pointer_str(tokens), "key": str(tokens[-1]), "label": str(tokens[-1]), "kind": "leaf", "field_id": dsl.pointer_str(tokens)}]
                count = sum(1 for slot in self.slots if slot["field_id"].startswith(dsl.pointer_str(tokens)))
                out.append({"bucket_id": bucket, "bucket_type": self._bucket_types[bucket], "field_count": count, "tree": tree})
            return out
        out = []
        # keep declared order; ensure every assigned bucket appears
        declared = [(b["bucket_id"], b.get("bucket_type")) for b in self.bucket_defs]
        seen = {bid for bid, _ in declared}
        for bid in self._bucket_elements:
            if bid not in seen:
                declared.append((bid, "sample"))
                seen.add(bid)
        for bid, btype in declared:
            if bid not in self._bucket_elements:
                continue
            tree = self.build_tree(bid)
            n = sum(1 for _ in self._iter_leaf_ids(tree))
            out.append({"bucket_id": bid, "bucket_type": btype,
                        "field_count": n, "tree": tree})
        return out

    @staticmethod
    def _iter_leaf_ids(tree):
        for node in tree:
            if node["kind"] == "leaf":
                yield node["field_id"]
            else:
                yield from PaperModel._iter_leaf_ids(node.get("children", []))

    def paper_meta(self) -> dict:
        base = self.root.get("paper", {}) if self.grouped is not None else self.root
        papers = base.get("papers") or []
        p = papers[0] if papers else {}
        return {
            "title": p.get("title") or self.pdir.name,
            "doi": p.get("doi"), "journal": p.get("journal"),
            "year": p.get("publication_year"), "authors": p.get("authors", []),
            "field_count": len(self.slots),
        }
