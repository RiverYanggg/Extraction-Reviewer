"""Field-path DSL  <->  JSON-pointer resolution.

The extraction pipeline addresses fields with a custom DSL, e.g.::

    papers.<paper_id>.authors[0]
    samples.<sample_id>__idx_0.alloy_id
    properties.<sample_id>__property_set_id_<pid>.mechanical.tensile_properties.yield_strength[compression].direction
    characterization_methods.idx_2.characterization_id

The element locator embeds the element's id (which may itself contain dots)
plus synthetic disambiguators. This module resolves such a path to a concrete
sequence of JSON tokens (keys / list indices) inside the structured document,
so we can (a) attach evidence to the matching slot and (b) write reviewed
values back exactly. Pointers are the stable, canonical slot identity.
"""
from __future__ import annotations

import re
from typing import Any, Optional

# --- element locator regeneration ----------------------------------------- #
def element_locators(section: str, elem: Any, index: int) -> list[str]:
    """Candidate locators the pipeline may have emitted for a list element.

    Some sections use more than one scheme (e.g. characterization_methods can be
    `idx_N` for paper-level entries or a `<sample_id>__characterization_id_<cid>`
    compound for sample-scoped ones). We return all plausible candidates and the
    resolver keeps the longest that matches the path prefix.
    """
    cands = [f"idx_{index}"]  # universal positional fallback
    if not isinstance(elem, dict):
        return cands
    sid = elem.get("sample_id")
    specific = {
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
        "characterization_methods": lambda: f"{sid}__characterization_id_{elem.get('characterization_id')}",
    }
    fn = specific.get(section)
    if fn:
        v = fn()
        if v and "None" not in v:
            cands.append(v)
    return cands


_CHAIN_RE = re.compile(r"\.([^.\[\]]+)|\[([^\]]+)\]")
_ID_LIKE_FIELDS = ("phase_name", "name", "phase", "element", "id", "region",
                   "label", "key", "direction", "technique", "type")


def _match_list_by_id(lst: list, key: str) -> Optional[int]:
    """Index of a list element identified by an embedded id `key` (case-insensitive)."""
    kl = key.lower()
    for i, e in enumerate(lst):
        if isinstance(e, dict):
            for fld in _ID_LIKE_FIELDS:
                if e.get(fld) is not None and str(e[fld]).lower() == kl:
                    return i
            for k, v in e.items():
                if (k.endswith("_id") or k.endswith("_name")) and v is not None and str(v).lower() == kl:
                    return i
    return None


def _match_list_by_seq(lst: list, step: str) -> Optional[int]:
    """Some lists are addressed by a numeric *sequence* id, not array index
    (e.g. microstructure_list[2] means related_sequence == 2)."""
    for i, e in enumerate(lst):
        if isinstance(e, dict):
            for fld in ("related_sequence", "sequence"):
                if e.get(fld) is not None and str(e[fld]) == step:
                    return i
    return None


def _chain_tokens(node: Any, chain: str) -> Optional[list]:
    """Resolve a `.key` / `[int]` / `[key]` chain to a token list, or None."""
    steps = []
    for m in _CHAIN_RE.finditer(chain):
        steps.append(m.group(1) if m.group(1) is not None else m.group(2))
    tokens: list = []
    cur = node
    for step in steps:
        if isinstance(cur, list):
            if step.lstrip("-").isdigit():
                # prefer a sequence-id match; fall back to array index
                idx = _match_list_by_seq(cur, step)
                if idx is None:
                    n = int(step)
                    idx = n if 0 <= n < len(cur) else None
            else:
                idx = _match_list_by_id(cur, step)
            if idx is None or idx >= len(cur):
                return None
            tokens.append(idx)
            cur = cur[idx]
        elif isinstance(cur, dict):
            if step not in cur:
                return None
            tokens.append(step)
            cur = cur[step]
        else:
            return None
    return tokens


def resolve_to_pointer(root: dict, path: str) -> Optional[list]:
    """Resolve a DSL path to a list of JSON tokens ([section, idx, key, ...])."""
    dot = path.find(".")
    if dot < 0:
        return None
    section, rest = path[:dot], path[dot + 1:]
    container = root.get(section)
    if container is None:
        return None
    if isinstance(container, list):
        best = None
        for i, elem in enumerate(container):
            for loc in element_locators(section, elem, i):
                if rest == loc or rest.startswith(loc + ".") or rest.startswith(loc + "["):
                    if best is None or len(loc) > len(best[0]):
                        best = (loc, i, elem)
        if not best:
            return None
        loc, idx, elem = best
        chain = rest[len(loc):]
        if chain == "":
            return [section, idx]
        # scalar element addressed as `.value`
        if not isinstance(elem, (dict, list)) and chain == ".value":
            return [section, idx]
        sub = _chain_tokens(elem, chain)
        return None if sub is None else [section, idx] + sub
    elif isinstance(container, dict):
        sub = _chain_tokens(container, "." + rest)
        return None if sub is None else [section] + sub
    return None


# --- pointer helpers ------------------------------------------------------- #
def pointer_str(tokens: list) -> str:
    return "/".join(str(t) for t in tokens)


def get_by_pointer(root: Any, tokens: list) -> Any:
    cur = root
    for t in tokens:
        cur = cur[t]
    return cur


def set_by_pointer(root: Any, tokens: list, value: Any) -> bool:
    """Set a leaf by token path. Returns True on success (path fully resolves)."""
    if not tokens:
        return False
    cur = root
    try:
        for t in tokens[:-1]:
            cur = cur[t]
        cur[tokens[-1]] = value
        return True
    except (KeyError, IndexError, TypeError):
        return False
