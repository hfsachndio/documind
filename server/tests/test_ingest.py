import io

import pytest

from documind.ingest.chunker import chunk_blocks, clean, est_tokens, strip_boilerplate
from documind.ingest.parsers import Block, ParseError, detect_type, fetch_url, parse_docx, parse_html, parse_markdown, parse_pdf


def test_clean_rejoins_wrapped_lines_and_dehyphenates():
    assert clean("The reim-\nbursement is paid\nwithin ten days.") == "The reimbursement is paid within ten days."
    assert clean("Items:\n- one\n- two") == "Items:\n- one\n- two"


def test_boilerplate_headers_and_page_numbers_removed():
    blocks = []
    for p in range(1, 6):
        blocks += [Block("ACME CONFIDENTIAL", p), Block(f"Body text for page {p}.", p), Block(f"Page {p} of 5", p)]
    kept = [b.text for b in strip_boilerplate(blocks)]
    assert "ACME CONFIDENTIAL" not in kept and not any(t.startswith("Page ") for t in kept)
    assert len(kept) == 5


def test_chunks_respect_size_overlap_and_headings():
    md = "# Leave\n" + " ".join(f"Sentence number {i} about leave policy details." for i in range(80)) + "\n\n# Travel\nTravel is reimbursed."
    chunks = chunk_blocks(parse_markdown(md), max_tokens=120, overlap=30)
    assert all(c.token_count <= 130 for c in chunks)
    assert {c.heading for c in chunks} == {"Leave", "Travel"}
    leave = [c for c in chunks if c.heading == "Leave"]
    assert len(leave) > 2
    # consecutive chunks in one section share an overlapping sentence
    assert leave[0].content.split(". ")[-1].strip(".") in leave[1].content
    # a new heading always starts a new chunk (no overlap across sections)
    assert chunks[-1].content == "Travel is reimbursed."


def test_huge_sentence_is_wrapped():
    chunks = chunk_blocks([Block("word " * 2000)], max_tokens=200, overlap=0)
    assert len(chunks) >= 10 and all(c.token_count <= 210 for c in chunks)


def test_detect_type():
    assert detect_type("a.PDF", None) == "pdf"
    assert detect_type("notes.md", None) == "markdown"
    assert detect_type("x.docx", None) == "docx"
    with pytest.raises(ParseError):
        detect_type("image.png", "image/png")


def test_parse_pdf_with_pages():
    from fpdf import FPDF
    pdf = FPDF()
    for n in (1, 2):
        pdf.add_page(); pdf.set_font("Helvetica", size=12)
        pdf.multi_cell(0, 8, f"Section {n}\n\nThis is the policy text on page {n}. Refunds take {n * 7} days.")
    blocks = parse_pdf(bytes(pdf.output()))
    assert {b.page for b in blocks} == {1, 2}
    assert any("Refunds take 14 days" in b.text for b in blocks)


def test_parse_pdf_errors():
    with pytest.raises(ParseError):
        parse_pdf(b"not a pdf")


def test_parse_docx_headings_and_tables():
    import docx
    d = docx.Document()
    d.add_heading("Benefits", level=1)
    d.add_paragraph("Medical cover is PKR 500,000 per year.")
    t = d.add_table(rows=1, cols=2); t.rows[0].cells[0].text = "Plan"; t.rows[0].cells[1].text = "Gold"
    buf = io.BytesIO(); d.save(buf)
    blocks = parse_docx(buf.getvalue())
    assert blocks[0].is_heading and blocks[0].text == "Benefits"
    assert any("Plan | Gold" in b.text for b in blocks)


def test_parse_html_drops_navigation():
    title, blocks = parse_html("<html><title>FAQ</title><nav>Home About</nav><main><h1>Pricing</h1><p>Team plan is $49.</p></main>"
                               "<script>alert(1)</script></html>")
    texts = [b.text for b in blocks]
    assert title == "FAQ" and "Team plan is $49." in texts and not any("Home About" in t for t in texts)


@pytest.mark.parametrize("url", ["http://127.0.0.1/admin", "http://localhost:8000", "http://169.254.169.254/latest/meta-data", "ftp://x.com/a"])
def test_fetch_url_blocks_internal_addresses(url):
    with pytest.raises(ParseError):
        fetch_url(url, 1000)


def test_token_estimate():
    assert est_tokens("one two three") == 4
