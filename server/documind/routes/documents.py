from __future__ import annotations

import json

import psycopg
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from ..config import get_settings
from ..db import get_db
from ..ingest.parsers import ParseError, parse_html, parse_text
from ..ingest.pipeline import blocks_from_bytes, ingest
from ..ingest.parsers import fetch_url
from ..security import Access, access_dep, visible_params, visible_sql

router = APIRouter(prefix="/api/workspaces/{workspace_id}/documents", tags=["documents"])


class UrlIn(BaseModel):
    url: str = Field(max_length=2000)
    access: str = Field(default="workspace", pattern="^(workspace|groups)$")
    group_ids: list[str] = []


class TextIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=20, max_length=400_000)
    access: str = Field(default="workspace", pattern="^(workspace|groups)$")
    group_ids: list[str] = []


class AccessIn(BaseModel):
    access: str = Field(pattern="^(workspace|groups)$")
    group_ids: list[str] = []


def _check_access(access: str, group_ids: list[str]) -> None:
    if access == "groups" and not group_ids:
        raise HTTPException(422, "Choose at least one group, or make the document visible to the whole workspace")


@router.get("")
def list_documents(a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    # Visible = ready documents the user may retrieve; uploaders also see their own processing/failed ones.
    rows = db.execute(
        f"""SELECT d.id, d.title, d.source_type, d.source_url, d.status, d.error, d.access, d.pages, d.chunk_count,
                   d.token_count, d.summary, d.created_at, u.name AS created_by_name,
                   COALESCE((SELECT array_agg(g.name ORDER BY g.name) FROM document_groups dg JOIN groups g ON g.id = dg.group_id
                             WHERE dg.document_id = d.id), '{{}}') AS groups,
                   COALESCE((SELECT array_agg(dg.group_id) FROM document_groups dg WHERE dg.document_id = d.id), '{{}}') AS group_ids
            FROM documents d LEFT JOIN users u ON u.id = d.created_by
            WHERE {visible_sql(ready_only=False)}
              AND (d.status = 'ready' OR d.created_by = %(me)s OR %(all)s)
            ORDER BY d.created_at DESC""",
        {**visible_params(a), "me": a.user.id}).fetchall()
    return [{**r, "id": str(r["id"]), "group_ids": [str(g) for g in r["group_ids"]]} for r in rows]


@router.post("/upload", status_code=201)
async def upload(file: UploadFile = File(...), access: str = Form("workspace"), group_ids: str = Form("[]"), title: str = Form(""),
                 a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    a.require("member")
    s = get_settings()
    gids = json.loads(group_ids or "[]")
    _check_access(access, gids)
    data = await file.read(s.max_upload_mb * 1024 * 1024 + 1)
    if len(data) > s.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"Files up to {s.max_upload_mb} MB are supported")
    try:
        kind, blocks, html_title = blocks_from_bytes(file.filename or "upload", file.content_type, data)
    except ParseError as e:
        raise HTTPException(422, str(e))
    name = title.strip() or html_title or (file.filename or "Untitled").rsplit(".", 1)[0].replace("_", " ").replace("-", " ").strip()
    return ingest(db, s, workspace_id=a.workspace_id, user_id=a.user.id, title=name, source_type=kind, blocks=blocks,
                  access=access, group_ids=gids)


@router.post("/url", status_code=201)
def add_url(body: UrlIn, a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    a.require("member")
    _check_access(body.access, body.group_ids)
    s = get_settings()
    try:
        final_url, ctype, data = fetch_url(body.url.strip(), s.max_upload_mb * 1024 * 1024)
        if ctype == "application/pdf" or final_url.lower().endswith(".pdf"):
            kind, blocks, title = blocks_from_bytes("page.pdf", "application/pdf", data)
        elif ctype.startswith("text/html") or not ctype:
            title, blocks = parse_html(data.decode("utf-8", errors="replace"))
            kind = "url"
        elif ctype.startswith("text/"):
            title, blocks, kind = None, parse_text(data.decode("utf-8", errors="replace")), "url"
        else:
            raise ParseError(f"Unsupported content type: {ctype}")
        if not blocks:
            raise ParseError("No readable text on that page.")
    except ParseError as e:
        raise HTTPException(422, str(e))
    return ingest(db, s, workspace_id=a.workspace_id, user_id=a.user.id, title=title or final_url, source_type=kind,
                  blocks=blocks, source_url=final_url, access=body.access, group_ids=body.group_ids)


@router.post("/text", status_code=201)
def add_text(body: TextIn, a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    a.require("member")
    _check_access(body.access, body.group_ids)
    from ..ingest.parsers import parse_markdown
    return ingest(db, get_settings(), workspace_id=a.workspace_id, user_id=a.user.id, title=body.title.strip(), source_type="text",
                  blocks=parse_markdown(body.text), access=body.access, group_ids=body.group_ids)


def _visible_doc(db, a: Access, doc_id: str) -> dict:
    row = db.execute(f"SELECT d.* FROM documents d WHERE d.id = %(id)s AND {visible_sql(ready_only=False)}",
                     {**visible_params(a), "id": doc_id}).fetchone()
    if not row:
        raise HTTPException(404, "Document not found")
    return row


@router.get("/{document_id}")
def get_document(document_id: str, a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    d = _visible_doc(db, a, document_id)
    chunks = db.execute("SELECT ord, page, heading, content, token_count FROM chunks WHERE document_id = %s ORDER BY ord LIMIT 200",
                        (document_id,)).fetchall()
    return {"id": str(d["id"]), "title": d["title"], "source_type": d["source_type"], "source_url": d["source_url"],
            "status": d["status"], "access": d["access"], "pages": d["pages"], "summary": d["summary"],
            "chunk_count": d["chunk_count"], "token_count": d["token_count"], "chunks": chunks}


@router.patch("/{document_id}")
def set_access(document_id: str, body: AccessIn, a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    a.require("admin")
    _check_access(body.access, body.group_ids)
    _visible_doc(db, a, document_id)
    db.execute("UPDATE documents SET access = %s WHERE id = %s", (body.access, document_id))
    db.execute("DELETE FROM document_groups WHERE document_id = %s", (document_id,))
    for g in body.group_ids:
        db.execute("INSERT INTO document_groups (document_id, group_id) SELECT %s, id FROM groups WHERE id = %s AND workspace_id = %s",
                   (document_id, g, a.workspace_id))
    return {"ok": True}


@router.delete("/{document_id}")
def delete_document(document_id: str, a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    d = _visible_doc(db, a, document_id)
    if str(d["created_by"]) != a.user.id:
        a.require("admin")
    else:
        a.require("member")
    db.execute("DELETE FROM documents WHERE id = %s", (document_id,))
    return {"ok": True}
