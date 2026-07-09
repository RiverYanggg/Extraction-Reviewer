"""FastAPI application and routes.

Thin orchestration layer: each route delegates to a focused module
(slots / annotations / metrics / export / assistant / manual).
"""
from __future__ import annotations

import io
import json
from pathlib import Path
import zipfile

from fastapi import Cookie, Depends, FastAPI, HTTPException, Response, status
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import assistant, evidence, manual
from .annotations import load_annotation, progress_of, save_annotation
from .assignments import is_assigned, load_assigned_papers
from .auth import COOKIE_NAME, User, clear_session_cookie, public_user, set_session_cookie, user_from_session, verify_credentials
from .config import EXTRACTED_DIR, STATIC_DIR
from .export import build_export, build_export_files
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


def assigned_paper_dir(paper_id: str, user: User) -> Path:
    if not is_assigned(user, paper_id):
        raise HTTPException(status_code=404, detail=f"Unknown paper: {paper_id}")
    return paper_dir(paper_id)


# ---- request bodies -------------------------------------------------------- #
class SaveBody(BaseModel):
    annotation: dict


class AssistantBody(BaseModel):
    messages: list[dict]
    paper_id: str | None = None
    context: str | None = None


class LoginBody(BaseModel):
    username: str
    password: str


app = FastAPI(title="Evidence Note Annotator")


def current_user(enviz_session: str | None = Cookie(default=None, alias=COOKIE_NAME)) -> User:
    user = user_from_session(enviz_session)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Login required")
    return user


@app.get("/api/papers")
def list_papers(user: User = Depends(current_user)):
    out = []
    available = set(discover_papers())
    for pid in load_assigned_papers(user):
        if pid not in available:
            continue
        model = PaperModel(paper_dir(pid))
        annot = load_annotation(pid, user)
        out.append({
            "paper_id": pid, **model.paper_meta(),
            "progress": progress_of(model.slots, annot),
            "bucket_count": len(model.buckets_payload()),
        })
    return {"papers": out}


@app.get("/api/papers/{paper_id}")
def get_paper(paper_id: str, user: User = Depends(current_user)):
    pdir = assigned_paper_dir(paper_id, user)
    model = PaperModel(pdir)
    annot = load_annotation(paper_id, user)
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
def put_annotation(paper_id: str, body: SaveBody, user: User = Depends(current_user)):
    assigned_paper_dir(paper_id, user)
    saved = save_annotation(paper_id, body.annotation, user)
    model = PaperModel(paper_dir(paper_id))
    return {"ok": True, "updated_at": saved["updated_at"],
            "progress": progress_of(model.slots, saved)}


@app.get("/api/papers/{paper_id}/metrics")
def get_metrics(paper_id: str, user: User = Depends(current_user)):
    pdir = assigned_paper_dir(paper_id, user)
    model = PaperModel(pdir)
    return compute_metrics(paper_id, model.slots, load_annotation(paper_id, user))


@app.get("/api/papers/{paper_id}/pdf")
def get_pdf(paper_id: str, user: User = Depends(current_user)):
    pdf = evidence.find_pdf(assigned_paper_dir(paper_id, user))
    if not pdf:
        raise HTTPException(status_code=404, detail="No PDF for this paper")
    return FileResponse(pdf, media_type="application/pdf",
                        headers={"Content-Disposition": f'inline; filename="{paper_id}.pdf"'})


@app.get("/api/papers/{paper_id}/asset/{asset_path:path}")
def get_asset(paper_id: str, asset_path: str, user: User = Depends(current_user)):
    pdir = assigned_paper_dir(paper_id, user)
    name = Path(asset_path).name
    for c in (pdir / "source" / "mineru" / "images" / name,
              pdir / "source" / "mineru" / asset_path, pdir / asset_path):
        c = c.resolve()
        if c.is_file() and pdir.resolve() in c.parents:
            return FileResponse(c)
    raise HTTPException(status_code=404, detail="Asset not found")


@app.get("/api/papers/{paper_id}/export")
def export_paper(paper_id: str, user: User = Depends(current_user)):
    data = build_export(assigned_paper_dir(paper_id, user), paper_id, user)
    return StreamingResponse(
        io.BytesIO(data), media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{paper_id}_annotation_export.zip"'})


@app.get("/api/export/all")
def export_all_papers(user: User = Depends(current_user)):
    available = set(discover_papers())
    paper_ids = [pid for pid in load_assigned_papers(user) if pid in available]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        manifest = {
            "schema": "evidence-annotation-export-all-v1",
            "reviewer": user.username,
            "paper_count": len(paper_ids),
            "papers": paper_ids,
        }
        z.writestr("ALL_MANIFEST.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        for pid in paper_ids:
            for name, content in build_export_files(paper_dir(pid), pid, user).items():
                z.writestr(name, content)
    return StreamingResponse(
        io.BytesIO(buf.getvalue()), media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{user.username}_all_annotation_export.zip"'})


@app.post("/api/assistant")
def assistant_reply(body: AssistantBody, user: User = Depends(current_user)):
    return assistant.ask(body.messages, context=body.context or "")


@app.get("/api/manual")
def get_manual(user: User = Depends(current_user)):
    return {"markdown": manual.manual_markdown()}


@app.get("/api/health")
def health():
    return {"ok": True, "assistant": assistant.available()}


@app.get("/api/auth/me")
def auth_me(user: User = Depends(current_user)):
    return {"ok": True, "user": public_user(user)}


@app.post("/api/auth/login")
def auth_login(body: LoginBody, response: Response):
    user = verify_credentials(body.username, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    set_session_cookie(response, user)
    return {"ok": True, "user": public_user(user)}


@app.post("/api/auth/logout")
def auth_logout(response: Response):
    clear_session_cookie(response)
    return {"ok": True}


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
