"""FastAPI application and routes.

Thin orchestration layer: each route delegates to a focused module
(slots / annotations / metrics / export / assistant / manual).
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import assistant, evidence, manual
from .annotations import load_annotation, progress_of, save_annotation
from .config import EXTRACTED_DIR, STATIC_DIR
from .export import build_export
from .metrics import compute_metrics
from .slots import PaperModel


# ---- discovery / validation ---------------------------------------------- #
def discover_papers() -> list[str]:
    if not EXTRACTED_DIR.is_dir():
        return []
    return [d.name for d in sorted(EXTRACTED_DIR.iterdir())
            if d.is_dir() and (d / "extraction_postprocess" / "field_evidence.json").exists()]


def paper_dir(paper_id: str) -> Path:
    d = (EXTRACTED_DIR / paper_id).resolve()
    if EXTRACTED_DIR.resolve() not in d.parents or not d.is_dir():
        raise HTTPException(status_code=404, detail=f"Unknown paper: {paper_id}")
    return d


# ---- request bodies -------------------------------------------------------- #
class SaveBody(BaseModel):
    annotation: dict


class AssistantBody(BaseModel):
    messages: list[dict]
    paper_id: str | None = None
    context: str | None = None


app = FastAPI(title="Evidence Note Annotator")


@app.get("/api/papers")
def list_papers():
    out = []
    for pid in discover_papers():
        model = PaperModel(paper_dir(pid))
        annot = load_annotation(pid)
        out.append({
            "paper_id": pid, **model.paper_meta(),
            "progress": progress_of(model.slots, annot),
            "bucket_count": len(model.buckets_payload()),
        })
    return {"papers": out}


@app.get("/api/papers/{paper_id}")
def get_paper(paper_id: str):
    pdir = paper_dir(paper_id)
    model = PaperModel(pdir)
    annot = load_annotation(paper_id)
    has_pdf = bool(evidence.find_pdf(pdir))
    return {
        "paper_id": paper_id,
        "meta": model.paper_meta(),
        "blocks": evidence.load_blocks(pdir),
        "fields": model.slots,
        "buckets": model.buckets_payload(),
        "annotation": annot,
        "progress": progress_of(model.slots, annot),
        "has_pdf": has_pdf,
        "pdf_url": f"/api/papers/{paper_id}/pdf" if has_pdf else None,
        "asset_base": f"/api/papers/{paper_id}/asset/",
    }


@app.put("/api/papers/{paper_id}/annotation")
def put_annotation(paper_id: str, body: SaveBody):
    paper_dir(paper_id)
    saved = save_annotation(paper_id, body.annotation)
    model = PaperModel(paper_dir(paper_id))
    return {"ok": True, "updated_at": saved["updated_at"],
            "progress": progress_of(model.slots, saved)}


@app.get("/api/papers/{paper_id}/metrics")
def get_metrics(paper_id: str):
    pdir = paper_dir(paper_id)
    model = PaperModel(pdir)
    return compute_metrics(paper_id, model.slots, load_annotation(paper_id))


@app.get("/api/papers/{paper_id}/pdf")
def get_pdf(paper_id: str):
    pdf = evidence.find_pdf(paper_dir(paper_id))
    if not pdf:
        raise HTTPException(status_code=404, detail="No PDF for this paper")
    return FileResponse(pdf, media_type="application/pdf",
                        headers={"Content-Disposition": f'inline; filename="{paper_id}.pdf"'})


@app.get("/api/papers/{paper_id}/asset/{asset_path:path}")
def get_asset(paper_id: str, asset_path: str):
    pdir = paper_dir(paper_id)
    name = Path(asset_path).name
    for c in (pdir / "source" / "mineru" / "images" / name,
              pdir / "source" / "mineru" / asset_path, pdir / asset_path):
        c = c.resolve()
        if c.is_file() and pdir.resolve() in c.parents:
            return FileResponse(c)
    raise HTTPException(status_code=404, detail="Asset not found")


@app.get("/api/papers/{paper_id}/export")
def export_paper(paper_id: str):
    data = build_export(paper_dir(paper_id), paper_id)
    import io
    return StreamingResponse(
        io.BytesIO(data), media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{paper_id}_annotation_export.zip"'})


@app.post("/api/assistant")
def assistant_reply(body: AssistantBody):
    return assistant.ask(body.messages, context=body.context or "")


@app.get("/api/manual")
def get_manual():
    return {"markdown": manual.manual_markdown()}


@app.get("/api/health")
def health():
    return {"ok": True, "assistant": assistant.available()}


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
