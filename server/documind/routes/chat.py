from __future__ import annotations

import json
import uuid

import psycopg
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..agent.agent import run_agent
from ..config import get_settings
from ..db import connection, get_db
from ..llm import LLMError
from ..rag.answer import Answer, answer, answer_stream
from ..security import Access, access_dep, current_user, workspace_access

router = APIRouter(prefix="/api/workspaces/{workspace_id}", tags=["chat"])


class AskIn(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    conversation_id: str | None = None
    mode: str = Field(default="rag", pattern="^(rag|agent)$")


class FeedbackIn(BaseModel):
    value: int = Field(ge=-1, le=1)


def _rate_limit(db: psycopg.Connection, a: Access) -> None:
    n = db.execute("SELECT count(*) AS n FROM query_logs WHERE user_id = %s AND created_at > now() - interval '1 hour'",
                   (a.user.id,)).fetchone()["n"]
    if n >= get_settings().questions_per_hour:
        raise HTTPException(429, "You've reached the hourly question limit. Please try again later.")


def _conversation(db: psycopg.Connection, a: Access, conversation_id: str | None, question: str) -> tuple[str, list[dict]]:
    if conversation_id:
        try:
            uuid.UUID(conversation_id)
        except ValueError:
            raise HTTPException(404, "Conversation not found")
        conv = db.execute("SELECT id FROM conversations WHERE id = %s AND workspace_id = %s AND user_id = %s",
                          (conversation_id, a.workspace_id, a.user.id)).fetchone()
        if not conv:
            raise HTTPException(404, "Conversation not found")
        rows = db.execute("SELECT role, content FROM messages WHERE conversation_id = %s ORDER BY id DESC LIMIT 8", (conversation_id,)).fetchall()
        return conversation_id, [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]
    title = question.strip().replace("\n", " ")
    conv = db.execute("INSERT INTO conversations (workspace_id, user_id, title) VALUES (%s, %s, %s) RETURNING id",
                      (a.workspace_id, a.user.id, title[:80] + ("…" if len(title) > 80 else ""))).fetchone()
    return str(conv["id"]), []


def _save(db: psycopg.Connection, a: Access, conv_id: str, question: str, mode: str, ans: Answer) -> int:
    db.execute("INSERT INTO messages (conversation_id, role, content) VALUES (%s, 'user', %s)", (conv_id, question))
    msg = db.execute("INSERT INTO messages (conversation_id, role, content, citations, trace) VALUES (%s, 'assistant', %s, %s, %s) RETURNING id",
                     (conv_id, ans.text, json.dumps(ans.citations), json.dumps(ans.trace))).fetchone()
    db.execute("""INSERT INTO query_logs (workspace_id, user_id, question, mode, answered, latency_ms, tokens_in, tokens_out, cost_usd)
                  VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
               (a.workspace_id, a.user.id, question[:2000], mode, ans.answered, json.dumps(ans.trace.get("timings_ms", {})),
                ans.tokens_in, ans.tokens_out, ans.cost_usd))
    return msg["id"]


def _payload(conv_id: str, msg_id: int, ans: Answer) -> dict:
    return {"conversation_id": conv_id, "message_id": msg_id, "answer": ans.text, "answered": ans.answered,
            "citations": ans.citations, "trace": ans.trace, "usage": {"tokens_in": ans.tokens_in, "tokens_out": ans.tokens_out,
                                                                       "cost_usd": ans.cost_usd}}


@router.post("/ask")
def ask(body: AskIn, a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    _rate_limit(db, a)
    conv_id, history = _conversation(db, a, body.conversation_id, body.question)
    s = get_settings()
    try:
        ans = run_agent(db, s, a, body.question, history) if body.mode == "agent" else answer(db, s, a, body.question, history)
    except LLMError as e:
        raise HTTPException(503, str(e))
    return _payload(conv_id, _save(db, a, conv_id, body.question, body.mode, ans), ans)


@router.post("/ask/stream")
def ask_stream(workspace_id: str, body: AskIn, user=Depends(current_user)):
    """Server-sent events. Uses its own connection because the response outlives the request scope."""
    with connection() as db:
        a = workspace_access(db, user, workspace_id)
        _rate_limit(db, a)
        conv_id, history = _conversation(db, a, body.conversation_id, body.question)

    def events():
        try:
            with connection() as db:
                for ev in answer_stream(db, get_settings(), a, body.question, history):
                    if ev["type"] == "done":
                        ans: Answer = ev["answer"]
                        msg_id = _save(db, a, conv_id, body.question, "rag", ans)
                        yield f"data: {json.dumps({'type': 'done', **_payload(conv_id, msg_id, ans)})}\n\n"
                    else:
                        yield f"data: {json.dumps(ev)}\n\n"
        except LLMError as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/conversations")
def conversations(a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    rows = db.execute("""SELECT c.id, c.title, c.created_at, (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id) AS messages
                         FROM conversations c WHERE c.workspace_id = %s AND c.user_id = %s ORDER BY c.created_at DESC LIMIT 50""",
                      (a.workspace_id, a.user.id)).fetchall()
    return [{**r, "id": str(r["id"])} for r in rows]


@router.get("/conversations/{conversation_id}")
def conversation(conversation_id: str, a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    conv = db.execute("SELECT id, title FROM conversations WHERE id = %s AND workspace_id = %s AND user_id = %s",
                      (conversation_id, a.workspace_id, a.user.id)).fetchone()
    if not conv:
        raise HTTPException(404, "Conversation not found")
    msgs = db.execute("SELECT id, role, content, citations, trace, feedback, created_at FROM messages WHERE conversation_id = %s ORDER BY id",
                      (conversation_id,)).fetchall()
    return {"id": str(conv["id"]), "title": conv["title"], "messages": msgs}


@router.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: str, a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    db.execute("DELETE FROM conversations WHERE id = %s AND workspace_id = %s AND user_id = %s", (conversation_id, a.workspace_id, a.user.id))
    return {"ok": True}


@router.post("/messages/{message_id}/feedback")
def feedback(message_id: int, body: FeedbackIn, a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    r = db.execute("""UPDATE messages m SET feedback = %s FROM conversations c
                      WHERE m.id = %s AND m.conversation_id = c.id AND c.user_id = %s AND c.workspace_id = %s RETURNING m.id""",
                   (body.value or None, message_id, a.user.id, a.workspace_id)).fetchone()
    if not r:
        raise HTTPException(404, "Message not found")
    return {"ok": True}
