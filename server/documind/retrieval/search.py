"""Permission-aware hybrid retrieval: pgvector (semantic) + Postgres full-text (keyword), fused with RRF, then reranked."""
from __future__ import annotations

import json
import re
import time
from dataclasses import asdict, dataclass, field

import psycopg

from ..config import Settings
from ..llm import LLMError, get_provider
from ..llm.fake import words
from ..security import VISIBLE_SQL, Access, visible_params

RRF_K = 60


@dataclass
class Hit:
    chunk_id: int
    document_id: str
    title: str
    page: int | None
    heading: str | None
    content: str
    vector_rank: int | None = None
    keyword_rank: int | None = None
    rrf: float = 0.0
    relevance: float = 0.0  # 0..1 after reranking

    def public(self, n: int) -> dict:
        d = asdict(self)
        d["n"] = n
        return d


@dataclass
class Retrieval:
    hits: list[Hit]
    candidates: int
    timings: dict = field(default_factory=dict)
    tokens_in: int = 0
    tokens_out: int = 0
    embed_tokens: int = 0

    @property
    def confident(self) -> bool:
        return bool(self.hits)


def _doc_filter(document_ids: list[str] | None) -> tuple[str, dict]:
    return ("AND d.id = ANY(%(docs)s::uuid[])", {"docs": document_ids}) if document_ids else ("", {})


def vector_search(db: psycopg.Connection, a: Access, qvec: list[float], k: int, document_ids=None) -> list[dict]:
    extra, p = _doc_filter(document_ids)
    db.execute("SET LOCAL hnsw.ef_search = 100")
    try:  # pgvector >= 0.8 keeps scanning the index until enough rows pass the permission filter
        with db.transaction():
            db.execute("SET LOCAL hnsw.iterative_scan = relaxed_order")
    except psycopg.Error:
        pass
    return db.execute(
        f"""SELECT c.id, c.document_id, d.title, c.page, c.heading, c.content
            FROM chunks c JOIN documents d ON d.id = c.document_id
            WHERE {VISIBLE_SQL} {extra}
            ORDER BY c.embedding <=> %(q)s::vector LIMIT %(k)s""",
        {**visible_params(a), **p, "q": qvec, "k": k},
    ).fetchall()


def keyword_search(db: psycopg.Connection, a: Access, query: str, k: int, document_ids=None) -> list[dict]:
    extra, p = _doc_filter(document_ids)
    # OR the query terms (natural questions rarely match every word), rank by cover density.
    return db.execute(
        f"""WITH q AS (SELECT NULLIF(replace(plainto_tsquery('english', %(text)s)::text, '&', '|'), '')::tsquery AS tsq)
            SELECT c.id, c.document_id, d.title, c.page, c.heading, c.content, ts_rank_cd(c.tsv, q.tsq, 32) AS rank
            FROM chunks c JOIN documents d ON d.id = c.document_id, q
            WHERE q.tsq IS NOT NULL AND c.tsv @@ q.tsq AND {VISIBLE_SQL} {extra}
            ORDER BY rank DESC LIMIT %(k)s""",
        {**visible_params(a), **p, "text": query, "k": k},
    ).fetchall()


def fuse(vec_rows: list[dict], kw_rows: list[dict]) -> list[Hit]:
    hits: dict[int, Hit] = {}
    for rank, r in enumerate(vec_rows, 1):
        h = hits.setdefault(r["id"], Hit(r["id"], str(r["document_id"]), r["title"], r["page"], r["heading"], r["content"]))
        h.vector_rank = rank
        h.rrf += 1 / (RRF_K + rank)
    for rank, r in enumerate(kw_rows, 1):
        h = hits.setdefault(r["id"], Hit(r["id"], str(r["document_id"]), r["title"], r["page"], r["heading"], r["content"]))
        h.keyword_rank = rank
        h.rrf += 1 / (RRF_K + rank)
    return sorted(hits.values(), key=lambda h: h.rrf, reverse=True)


RERANK_PROMPT = """TASK: rerank
You are a search relevance judge. For each passage, score how well it helps answer the question:
1.0 = directly answers it, 0.5 = related/partial, 0.0 = irrelevant. Judge only relevance, not truth.
Return JSON: {"scores":[{"id":<passage number>,"score":<0..1>}, ...]} covering every passage."""


def lexical_scores(query: str, hits: list[Hit]) -> list[float]:
    q = set(words(query))
    out = []
    for h in hits:
        w = set(words(f"{h.heading or ''} {h.content}"))
        out.append(len(q & w) / (len(q) or 1))
    return out


_cross_encoder = None


def cross_encoder_scores(query: str, hits: list[Hit]) -> list[float] | None:
    """Local cross-encoder (FlashRank, ONNX). Only for container deployments; returns None if not installed."""
    global _cross_encoder
    try:
        from flashrank import Ranker, RerankRequest
    except ImportError:
        return None
    if _cross_encoder is None:
        _cross_encoder = Ranker(model_name="ms-marco-MiniLM-L-12-v2", cache_dir="/tmp/flashrank")
    ranked = _cross_encoder.rerank(RerankRequest(query=query, passages=[{"id": i, "text": h.content} for i, h in enumerate(hits)]))
    by_id = {r["id"]: float(r["score"]) for r in ranked}
    return [by_id.get(i, 0.0) for i in range(len(hits))]


def rerank(s: Settings, query: str, hits: list[Hit]) -> tuple[list[Hit], int, int]:
    if not hits:
        return hits, 0, 0
    tin = tout = 0
    scores: list[float] | None = None
    if s.reranker == "cross-encoder":
        scores = cross_encoder_scores(query, hits)
    if s.reranker == "llm":
        passages = "\n".join(f"[{i}] {(h.heading + ': ') if h.heading else ''}{h.content[:700]}" for i, h in enumerate(hits))
        try:
            r = get_provider(s).generate(RERANK_PROMPT, [{"role": "user", "content": f"QUESTION: {query}\nPASSAGES:\n{passages}"}],
                                         model=s.fast_model, temperature=0.0, json_mode=True)
            tin, tout = r.tokens_in, r.tokens_out
            data = json.loads(re.search(r"\{.*\}", r.text, re.S).group(0))
            by_id = {int(x["id"]): float(x["score"]) for x in data.get("scores", [])}
            scores = [max(0.0, min(1.0, by_id.get(i, 0.0))) for i in range(len(hits))]
        except (LLMError, AttributeError, ValueError, KeyError, TypeError):
            scores = None  # fall back to lexical scoring rather than failing the question
    if scores is None and s.reranker != "none":
        scores = lexical_scores(query, hits)
    if scores is None:
        top = hits[0].rrf or 1
        scores = [h.rrf / top for h in hits]
    for h, sc in zip(hits, scores):
        # blend: reranker dominates, fusion rank breaks ties
        h.relevance = round(0.85 * sc + 0.15 * (h.rrf / (hits[0].rrf or 1)), 4)
    return sorted(hits, key=lambda h: h.relevance, reverse=True), tin, tout


def retrieve(db: psycopg.Connection, s: Settings, a: Access, query: str, *, top_k: int | None = None,
             document_ids: list[str] | None = None) -> Retrieval:
    t = {}
    t0 = time.perf_counter()
    emb = get_provider(s).embed([query], task="query")
    t["embed"] = round((time.perf_counter() - t0) * 1000)
    t1 = time.perf_counter()
    vec = vector_search(db, a, emb.vectors[0], s.candidates, document_ids)
    kw = keyword_search(db, a, query, s.candidates, document_ids)
    fused = fuse(vec, kw)[: max(12, (top_k or s.top_k) * 3)]
    t["search"] = round((time.perf_counter() - t1) * 1000)
    t2 = time.perf_counter()
    ranked, tin, tout = rerank(s, query, fused)
    t["rerank"] = round((time.perf_counter() - t2) * 1000)
    k = top_k or s.top_k
    kept = [h for h in ranked if h.relevance >= s.min_relevance][:k]
    return Retrieval(hits=kept, candidates=len(fused), timings=t, tokens_in=tin, tokens_out=tout, embed_tokens=emb.tokens)
