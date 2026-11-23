"""Ingestion: parse -> clean -> chunk -> embed (with title/heading context) -> store -> summarize."""
from __future__ import annotations

import time

import psycopg

from ..config import Settings
from ..llm import LLMError, get_provider
from .chunker import chunk_blocks
from .parsers import Block, ParseError, detect_type, parse_docx, parse_html, parse_markdown, parse_pdf, parse_text


def blocks_from_bytes(filename: str, content_type: str | None, data: bytes) -> tuple[str, list[Block], str | None]:
    kind = detect_type(filename, content_type)
    title = None
    if kind == "pdf":
        blocks = parse_pdf(data)
    elif kind == "docx":
        blocks = parse_docx(data)
    else:
        text = data.decode("utf-8", errors="replace")
        if kind == "markdown":
            blocks = parse_markdown(text)
        elif kind == "html":
            title, blocks = parse_html(text)
        else:
            blocks = parse_text(text)
    if not blocks:
        raise ParseError("The file has no readable text.")
    return kind, blocks, title


def embed_text(title: str, heading: str | None, content: str) -> str:
    """Contextual embedding: prefix each chunk with where it came from, which improves retrieval of short chunks."""
    return f"{title}\n{heading}\n{content}" if heading else f"{title}\n{content}"


def ingest(db: psycopg.Connection, s: Settings, *, workspace_id: str, user_id: str, title: str, source_type: str,
           blocks: list[Block], source_url: str | None = None, access: str = "workspace", group_ids: list[str] | None = None) -> dict:
    t0 = time.perf_counter()
    doc = db.execute(
        """INSERT INTO documents (workspace_id, title, source_type, source_url, access, created_by, pages)
           VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id""",
        (workspace_id, title[:200], source_type, source_url, access, user_id, max([b.page or 0 for b in blocks] + [0])),
    ).fetchone()
    doc_id = str(doc["id"])
    for g in group_ids or []:
        db.execute("INSERT INTO document_groups (document_id, group_id) SELECT %s, id FROM groups WHERE id = %s AND workspace_id = %s",
                   (doc_id, g, workspace_id))
    db.commit()  # the document shows as "processing" while we embed
    try:
        chunks = chunk_blocks(blocks, s.chunk_tokens, s.chunk_overlap)
        if not chunks:
            raise ParseError("No text to index after cleaning.")
        if len(chunks) > 600:
            raise ParseError(f"This document is very large ({len(chunks)} chunks). Split it into parts of about 200 pages.")
        provider = get_provider(s)
        emb = provider.embed([embed_text(title, c.heading, c.content) for c in chunks], task="document")
        with db.cursor() as cur:
            cur.executemany(
                """INSERT INTO chunks (document_id, workspace_id, ord, page, heading, content, token_count, embedding)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                [(doc_id, workspace_id, c.ord, c.page, c.heading, c.content, c.token_count, v) for c, v in zip(chunks, emb.vectors)],
            )
        summary = None
        try:
            head = "\n".join(c.content for c in chunks[:6])[:6000]
            summary = provider.generate(
                "TASK: summarize\nSummarize this document in 2 sentences for a document library. Plain text, no preamble.",
                [{"role": "user", "content": f"{title}\n{head}"}], model=s.fast_model, temperature=0.1).text.strip()[:600]
        except LLMError:
            pass  # summaries are optional
        db.execute(
            """UPDATE documents SET status='ready', chunk_count=%s, token_count=%s, summary=%s WHERE id=%s""",
            (len(chunks), sum(c.token_count for c in chunks), summary, doc_id),
        )
        db.commit()
        return {"id": doc_id, "status": "ready", "chunks": len(chunks), "embed_tokens": emb.tokens,
                "seconds": round(time.perf_counter() - t0, 2)}
    except (ParseError, LLMError) as e:
        db.rollback()
        db.execute("DELETE FROM chunks WHERE document_id = %s", (doc_id,))
        db.execute("UPDATE documents SET status='failed', error=%s WHERE id=%s", (str(e)[:500], doc_id))
        db.commit()
        return {"id": doc_id, "status": "failed", "error": str(e)}
