"""Evaluation: test questions per workspace, runs evaluated one case per request (fits serverless time limits)."""
from __future__ import annotations

import json
from dataclasses import asdict

import psycopg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..config import get_settings
from ..db import get_db
from ..evals.metrics import aggregate, evaluate_case
from ..llm import LLMError
from ..security import Access, access_dep

router = APIRouter(prefix="/api/workspaces/{workspace_id}/evals", tags=["evaluation"])


class CaseIn(BaseModel):
    question: str = Field(min_length=3, max_length=1000)
    expected_answer: str | None = Field(default=None, max_length=2000)
    expected_document_id: str | None = None


def _cases(db, a: Access) -> list[dict]:
    rows = db.execute("""SELECT e.id, e.question, e.expected_answer, e.expected_document_id, d.title AS expected_document_title, e.created_at
                         FROM eval_cases e LEFT JOIN documents d ON d.id = e.expected_document_id
                         WHERE e.workspace_id = %s ORDER BY e.created_at""", (a.workspace_id,)).fetchall()
    return [{**r, "id": str(r["id"]), "expected_document_id": str(r["expected_document_id"]) if r["expected_document_id"] else None} for r in rows]


@router.get("/cases")
def list_cases(a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    return _cases(db, a)


@router.post("/cases", status_code=201)
def add_case(body: CaseIn, a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    a.require("member")
    if body.expected_document_id and not db.execute("SELECT 1 FROM documents WHERE id = %s AND workspace_id = %s",
                                                    (body.expected_document_id, a.workspace_id)).fetchone():
        raise HTTPException(422, "Expected document not found in this workspace")
    row = db.execute("INSERT INTO eval_cases (workspace_id, question, expected_answer, expected_document_id) VALUES (%s, %s, %s, %s) RETURNING id",
                     (a.workspace_id, body.question.strip(), (body.expected_answer or "").strip() or None, body.expected_document_id)).fetchone()
    return {"id": str(row["id"])}


@router.delete("/cases/{case_id}")
def delete_case(case_id: str, a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    a.require("member")
    db.execute("DELETE FROM eval_cases WHERE id = %s AND workspace_id = %s", (case_id, a.workspace_id))
    return {"ok": True}


@router.post("/runs", status_code=201)
def start_run(a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    a.require("member")
    cases = _cases(db, a)
    if not cases:
        raise HTTPException(422, "Add some test questions first")
    s = get_settings()
    config = {"provider": s.llm_provider, "chat_model": s.chat_model, "fast_model": s.fast_model, "embed_model": s.embed_model,
              "reranker": s.reranker, "top_k": s.top_k, "chunk_tokens": s.chunk_tokens, "min_relevance": s.min_relevance,
              "pending": [c["id"] for c in cases[:25]]}
    row = db.execute("INSERT INTO eval_runs (workspace_id, config, metrics, results, created_by) VALUES (%s, %s, '{}', '[]', %s) RETURNING id",
                     (a.workspace_id, json.dumps(config), a.user.id)).fetchone()
    return {"id": str(row["id"]), "total": len(config["pending"])}


@router.post("/runs/{run_id}/next")
def run_next(run_id: str, a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    """Evaluate the next pending case; the UI calls this until done=true."""
    run = db.execute("SELECT id, config, results FROM eval_runs WHERE id = %s AND workspace_id = %s FOR UPDATE", (run_id, a.workspace_id)).fetchone()
    if not run:
        raise HTTPException(404, "Run not found")
    config, results = run["config"], run["results"]
    pending = config.get("pending", [])
    if pending:
        case = next((c for c in _cases(db, a) if c["id"] == pending[0]), None)
        if case:
            try:
                results.append(evaluate_case(db, get_settings(), a, case))
            except LLMError as e:
                raise HTTPException(503, str(e))
        config["pending"] = pending[1:]
    metrics = aggregate(results)
    db.execute("UPDATE eval_runs SET config = %s, results = %s, metrics = %s WHERE id = %s",
               (json.dumps(config), json.dumps(results), json.dumps(metrics), run_id))
    return {"done": not config["pending"], "completed": len(results), "remaining": len(config["pending"]), "metrics": metrics,
            "last": results[-1] if results else None}


@router.get("/runs")
def list_runs(a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    rows = db.execute("SELECT id, config, metrics, created_at FROM eval_runs WHERE workspace_id = %s ORDER BY created_at DESC LIMIT 30",
                      (a.workspace_id,)).fetchall()
    return [{"id": str(r["id"]), "config": {k: v for k, v in r["config"].items() if k != "pending"},
             "pending": len(r["config"].get("pending", [])), "metrics": r["metrics"], "created_at": r["created_at"]} for r in rows]


@router.get("/runs/{run_id}")
def get_run(run_id: str, a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    r = db.execute("SELECT id, config, metrics, results, created_at FROM eval_runs WHERE id = %s AND workspace_id = %s", (run_id, a.workspace_id)).fetchone()
    if not r:
        raise HTTPException(404, "Run not found")
    return {**r, "id": str(r["id"])}
