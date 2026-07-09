"""User-manual provider (served to the floating window)."""
from __future__ import annotations

from .config import MANUAL_PATH

_FALLBACK = "# 用户手册\n\n手册文件缺失（docs/user_manual.md）。"


def manual_markdown() -> str:
    try:
        return MANUAL_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        return _FALLBACK
