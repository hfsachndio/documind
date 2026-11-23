"""DocuMind API: permission-aware RAG over your documents."""
from __future__ import annotations

import logging

import psycopg
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .llm import LLMError
from .routes import auth, chat, documents, evals, usage, workspaces

log = logging.getLogger("documind")

app = FastAPI(
    title="DocuMind API",
    version="1.0.0",
    description="Ask questions over your documents and get cited answers. Hybrid search (pgvector + full-text), "
                "reranking, grounded generation with guardrails, agent mode, evaluation and permission-aware retrieval.",
    docs_url="/api/docs", redoc_url=None, openapi_url="/api/openapi.json",
)
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in get_settings().cors_origins.split(",") if o.strip()],
                   allow_methods=["*"], allow_headers=["*"])

for r in (auth, workspaces, documents, chat, evals, usage):
    app.include_router(r.router)


@app.exception_handler(psycopg.errors.InvalidTextRepresentation)
async def bad_id(_: Request, __: Exception):
    return JSONResponse({"detail": "Not found"}, status_code=404)


@app.exception_handler(LLMError)
async def llm_down(_: Request, exc: LLMError):
    return JSONResponse({"detail": str(exc)}, status_code=503)


@app.exception_handler(psycopg.OperationalError)
async def db_down(_: Request, exc: Exception):
    log.exception("database unavailable")
    return JSONResponse({"detail": "The database is waking up or unavailable. Please try again in a few seconds."}, status_code=503)


@app.get("/api/health")
def health():
    s = get_settings()
    return {"status": "ok", "llm": s.llm_provider, "ai_configured": s.llm_provider == "gemini"}


@app.get("/api/config")
def public_config():
    s = get_settings()
    return {"provider": s.llm_provider, "chat_model": s.chat_model, "fast_model": s.fast_model, "embed_model": s.embed_model,
            "reranker": s.reranker, "top_k": s.top_k, "max_upload_mb": s.max_upload_mb, "ai_configured": s.llm_provider == "gemini"}


# Docker / AWS: serve the built React app from the same container when STATIC_DIR is set (Vercel serves it itself).
import os as _os
import pathlib as _pl

_static = _os.environ.get("STATIC_DIR")
if _static and _pl.Path(_static, "index.html").exists():
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles

    app.mount("/assets", StaticFiles(directory=_pl.Path(_static, "assets")), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = _pl.Path(_static, path)
        if path and f.is_file() and _pl.Path(_static).resolve() in f.resolve().parents:
            return FileResponse(f)
        return FileResponse(_pl.Path(_static, "index.html"))
