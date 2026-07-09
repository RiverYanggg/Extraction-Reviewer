"""Small IO / time helpers."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


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


def deep_copy(obj: Any) -> Any:
    return json.loads(json.dumps(obj))
