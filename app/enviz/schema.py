"""Schema-driven completion of the structured document.

`docs/extraction_schema.json` defines the full predefined field set (each
top-level section is a list holding one template object showing every field).
We complete each real element with this template so that predefined-but-absent
fields materialise as explicit `null` slots — these must participate in the
annotation and in precision / recall, per the review spec.

Completion only ADDS missing keys (as nulls) and never overwrites existing
data or reorders anything, so JSON pointers of existing fields stay stable.
"""
from __future__ import annotations

from typing import Any

from .config import SCHEMA_PATH
from .utils import try_read_json


def load_schema() -> dict:
    s = try_read_json(SCHEMA_PATH)
    return s if isinstance(s, dict) else {}


def _nullify(tmpl: Any) -> Any:
    """A copy of `tmpl` with every scalar replaced by None."""
    if isinstance(tmpl, dict):
        return {k: _nullify(v) for k, v in tmpl.items()}
    if isinstance(tmpl, list):
        return [_nullify(tmpl[0])] if tmpl else []
    return None


def _merge(data: Any, tmpl: Any) -> Any:
    """Add keys present in `tmpl` but missing in `data` (as nulls). Recurse."""
    if isinstance(tmpl, dict) and isinstance(data, dict):
        for k, tv in tmpl.items():
            if k not in data:
                data[k] = _nullify(tv)
            else:
                data[k] = _merge(data[k], tv)
        return data
    if isinstance(tmpl, list) and isinstance(data, list):
        item_tmpl = tmpl[0] if tmpl else None
        if not data and item_tmpl is not None:
            return [_nullify(item_tmpl)]
        if isinstance(item_tmpl, (dict, list)):
            for i, item in enumerate(data):
                data[i] = _merge(item, item_tmpl)
        return data
    return data


def complete_with_schema(root: dict, schema: dict) -> dict:
    """Complete every element of every section in-place using the schema."""
    for section, tmpl_list in schema.items():
        if not isinstance(tmpl_list, list) or not tmpl_list:
            continue
        tmpl = tmpl_list[0]
        data_list = root.get(section)
        if not isinstance(data_list, list):
            continue
        for i, elem in enumerate(data_list):
            data_list[i] = _merge(elem, tmpl)
    return root
