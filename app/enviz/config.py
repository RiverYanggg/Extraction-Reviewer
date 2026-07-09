"""Paths and shared constants."""
from __future__ import annotations

import os
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent      # app/
ROOT = APP_DIR.parent                                 # evidence_note_viewer/
EXTRACTED_DIR = ROOT / "extracted"                    # read-only pipeline output
ANNOT_DIR = ROOT / "annotations"                      # writable reviewer state
STATIC_DIR = APP_DIR / "static"
DOCS_DIR = ROOT / "docs"
SCHEMA_PATH = DOCS_DIR / "extraction_schema.json"
MANUAL_PATH = DOCS_DIR / "user_manual.md"


def load_env_file(path: Path = ROOT / ".env") -> None:
    """Load simple KEY=VALUE pairs without overriding existing environment."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_env_file()

ANNOT_DIR.mkdir(exist_ok=True)

ANNOT_SCHEMA_VERSION = "annot-v2"     # v2: slot-id (json-pointer) keyed

# Chinese section labels used across tree, metrics, preview.
SECTION_LABELS_ZH = {
    "papers": "论文元数据", "alloys": "合金成分", "processes": "工艺",
    "processing_steps": "工艺步骤", "samples": "样品", "structures": "微观结构",
    "interfaces": "界面", "properties": "性能", "performance": "服役性能",
    "characterization_methods": "表征方法", "computational_details": "计算细节",
    "unmapped_findings": "未映射发现",
}
