from __future__ import annotations

import psycopg
from fastapi import APIRouter, Depends

from ..db import get_db
from ..security import Access, access_dep

router = APIRouter(prefix="/api/workspaces/{workspace_id}", tags=["usage"])


@router.get("/usage")
def usage(a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    a.require("viewer")
    mine = "" if a.sees_everything else "AND user_id = %(me)s"  # members see their own usage, admins the workspace's
    p = {"ws": a.workspace_id, "me": a.user.id}
    totals = db.execute(f"""SELECT count(*) AS questions, count(*) FILTER (WHERE answered) AS answered,
                                   COALESCE(sum(tokens_in), 0) AS tokens_in, COALESCE(sum(tokens_out), 0) AS tokens_out,
                                   COALESCE(sum(cost_usd), 0)::float AS cost_usd,
                                   percentile_cont(0.5) WITHIN GROUP (ORDER BY (latency_ms->>'total')::int) AS p50,
                                   percentile_cont(0.95) WITHIN GROUP (ORDER BY (latency_ms->>'total')::int) AS p95,
                                   count(*) FILTER (WHERE mode = 'agent') AS agent_questions
                            FROM query_logs WHERE workspace_id = %(ws)s AND created_at > now() - interval '30 days' {mine}""", p).fetchone()
    daily = db.execute(f"""SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*) AS questions,
                                  count(*) FILTER (WHERE answered) AS answered, COALESCE(sum(cost_usd), 0)::float AS cost_usd,
                                  round(avg((latency_ms->>'total')::int)) AS avg_ms
                           FROM query_logs WHERE workspace_id = %(ws)s AND created_at > now() - interval '14 days' {mine}
                           GROUP BY 1 ORDER BY 1""", p).fetchall()
    docs = db.execute("""SELECT count(*) AS documents, COALESCE(sum(chunk_count), 0) AS chunks, COALESCE(sum(token_count), 0) AS tokens
                         FROM documents WHERE workspace_id = %s AND status = 'ready'""", (a.workspace_id,)).fetchone()
    fb = db.execute("""SELECT count(*) FILTER (WHERE m.feedback = 1) AS up, count(*) FILTER (WHERE m.feedback = -1) AS down
                       FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.workspace_id = %s""", (a.workspace_id,)).fetchone()
    return {"scope": "workspace" if a.sees_everything else "you", "totals": totals, "daily": daily, "library": docs, "feedback": fb}
