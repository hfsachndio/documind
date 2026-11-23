"""Cleaning and structure-aware chunking.

Strategy: keep headings attached to the text under them, never split mid-sentence, pack ~N tokens per chunk
with a sentence-level overlap, and carry page/heading metadata so answers can cite "Handbook, p. 4 - Leave policy".
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from .parsers import Block

SENT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(\[])")


def est_tokens(text: str) -> int:
    return max(1, round(len(text.split()) * 1.33))


def clean(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).replace("­", "")
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)          # de-hyphenate line breaks from PDFs
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"(?<![.!?:\n])\n(?!\n|[-*•\d])", " ", text)  # re-join wrapped lines, keep lists
    return text.strip()


def strip_boilerplate(blocks: list[Block]) -> list[Block]:
    """Drop page numbers and lines repeated on most pages (running headers/footers)."""
    pages = {b.page for b in blocks if b.page}
    counts: dict[str, int] = {}
    for b in blocks:
        key = b.text.strip().lower()
        if len(key) < 90:
            counts[key] = counts.get(key, 0) + 1
    out = []
    for b in blocks:
        key = b.text.strip().lower()
        if re.fullmatch(r"(page\s*)?\d+(\s*(of|/)\s*\d+)?", key):
            continue
        if len(pages) >= 3 and counts.get(key, 0) >= max(3, len(pages) * 0.6):
            continue
        out.append(b)
    return out


@dataclass
class Chunk:
    ord: int
    content: str
    page: int | None
    heading: str | None
    token_count: int


def chunk_blocks(blocks: list[Block], max_tokens: int = 350, overlap: int = 60) -> list[Chunk]:
    blocks = strip_boilerplate([Block(clean(b.text), b.page, b.heading, b.is_heading) for b in blocks if b.text.strip()])
    # 1) sentences tagged with their heading and page
    units: list[tuple[str, int | None, str | None]] = []
    heading = None
    for b in blocks:
        if b.is_heading:
            heading = b.text[:120]
            continue
        for s in SENT.split(b.text):
            s = s.strip()
            if not s:
                continue
            while est_tokens(s) > max_tokens:  # a single huge "sentence" (tables, code): hard-wrap by words
                words = s.split()
                cut = int(max_tokens / 1.33)
                units.append((" ".join(words[:cut]), b.page, heading))
                s = " ".join(words[cut:])
            units.append((s, b.page, heading))
    # 2) pack sentences; start a new chunk at heading changes so chunks stay on one topic
    chunks: list[Chunk] = []
    cur: list[tuple[str, int | None, str | None]] = []

    def flush():
        if not cur:
            return
        text = " ".join(u[0] for u in cur)
        chunks.append(Chunk(len(chunks), text, cur[0][1], cur[0][2], est_tokens(text)))

    for u in units:
        size = sum(est_tokens(x[0]) for x in cur)
        if cur and (size + est_tokens(u[0]) > max_tokens or u[2] != cur[-1][2]):
            same_section = u[2] == cur[-1][2]
            flush()
            tail: list = []
            if same_section:  # sentence overlap keeps context across the boundary
                for x in reversed(cur):
                    if sum(est_tokens(t[0]) for t in tail) + est_tokens(x[0]) > overlap:
                        break
                    tail.insert(0, x)
            cur = tail
        cur.append(u)
    flush()
    return chunks
