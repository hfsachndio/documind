"""Turn uploaded files and web pages into page/heading-tagged text blocks."""
from __future__ import annotations

import io
import ipaddress
import re
import socket
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup


@dataclass
class Block:
    text: str
    page: int | None = None
    heading: str | None = None
    is_heading: bool = False


class ParseError(ValueError):
    pass


def detect_type(filename: str, content_type: str | None) -> str:
    name = filename.lower()
    if name.endswith(".pdf") or content_type == "application/pdf":
        return "pdf"
    if name.endswith(".docx"):
        return "docx"
    if name.endswith((".md", ".markdown")):
        return "markdown"
    if name.endswith((".html", ".htm")):
        return "html"
    if name.endswith((".txt", ".csv", ".log")) or (content_type or "").startswith("text/"):
        return "text"
    raise ParseError("Unsupported file type. Upload PDF, Word (.docx), Markdown, HTML or plain text.")


def parse_pdf(data: bytes) -> list[Block]:
    from pypdf import PdfReader
    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception as e:
        raise ParseError(f"Could not read this PDF ({e.__class__.__name__}).")
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception:
            raise ParseError("This PDF is password-protected.")
    blocks = []
    for i, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        for para in re.split(r"\n\s*\n", text):
            if para.strip():
                blocks.append(Block(text=para, page=i, is_heading=_looks_like_heading(para)))
    if not any(b.text.strip() for b in blocks):
        raise ParseError("No text found in this PDF. It may be a scanned image; upload a text-based PDF.")
    return blocks


def _looks_like_heading(line: str) -> bool:
    s = line.strip()
    return 0 < len(s) < 80 and "\n" not in s and not s.endswith((".", ",", ";", ":")) and (s.isupper() or s.istitle() or bool(re.match(r"^(\d+(\.\d+)*|[IVX]+\.)\s+\w", s)))


def parse_docx(data: bytes) -> list[Block]:
    import docx
    try:
        d = docx.Document(io.BytesIO(data))
    except Exception:
        raise ParseError("Could not read this Word document.")
    blocks = []
    for p in d.paragraphs:
        if not p.text.strip():
            continue
        style = (p.style.name or "").lower() if p.style is not None else ""
        blocks.append(Block(text=p.text, is_heading=style.startswith("heading") or style == "title"))
    for t in d.tables:
        rows = [" | ".join(c.text.strip() for c in r.cells) for r in t.rows]
        if rows:
            blocks.append(Block(text="\n".join(rows)))
    return blocks


def parse_markdown(text: str) -> list[Block]:
    blocks, buf = [], []
    for line in text.splitlines():
        if re.match(r"^#{1,6}\s", line):
            if buf:
                blocks.append(Block(text="\n".join(buf))); buf = []
            blocks.append(Block(text=line.lstrip("#").strip(), is_heading=True))
        elif not line.strip():
            if buf:
                blocks.append(Block(text="\n".join(buf))); buf = []
        else:
            buf.append(line)
    if buf:
        blocks.append(Block(text="\n".join(buf)))
    return blocks


def parse_text(text: str) -> list[Block]:
    return [Block(text=p) for p in re.split(r"\n\s*\n", text) if p.strip()]


def parse_html(html: str) -> tuple[str | None, list[Block]]:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "nav", "footer", "header", "aside", "form", "svg", "iframe"]):
        tag.decompose()
    title = soup.title.get_text(strip=True) if soup.title else None
    root = soup.find("article") or soup.find("main") or soup.body or soup
    blocks = []
    for el in root.find_all(["h1", "h2", "h3", "h4", "p", "li", "pre", "td", "blockquote"]):
        t = el.get_text(" ", strip=True)
        if t:
            blocks.append(Block(text=t, is_heading=el.name in ("h1", "h2", "h3", "h4")))
    return title, blocks


def _public_host(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            return False
    return True


def fetch_url(url: str, max_bytes: int) -> tuple[str, str, bytes]:
    """Fetch a public web page or file. Blocks private/internal addresses (SSRF protection)."""
    for _ in range(4):  # follow redirects manually so every hop is checked
        u = urlparse(url)
        if u.scheme not in ("http", "https") or not u.hostname:
            raise ParseError("Enter a full http(s) URL.")
        if not _public_host(u.hostname):
            raise ParseError("That address isn't reachable from DocuMind (private or unknown host).")
        try:
            r = httpx.get(url, timeout=20, follow_redirects=False, headers={"User-Agent": "DocuMindBot/1.0 (+https://github.com/hfsachndio/documind)"})
        except httpx.HTTPError as e:
            raise ParseError(f"Could not fetch the page ({e.__class__.__name__}).")
        if r.is_redirect and r.headers.get("location"):
            url = str(r.url.join(r.headers["location"]))
            continue
        if r.status_code != 200:
            raise ParseError(f"The page returned HTTP {r.status_code}.")
        if len(r.content) > max_bytes:
            raise ParseError("That page is too large.")
        return url, r.headers.get("content-type", "").split(";")[0].strip(), r.content
    raise ParseError("Too many redirects.")
