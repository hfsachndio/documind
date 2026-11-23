from documind.agent.agent import safe_calc
from documind.evals.metrics import aggregate
from documind.rag.answer import extract_citations, is_refusal
from documind.retrieval.search import fuse

import pytest


def row(i, t="Doc"):
    return {"id": i, "document_id": "00000000-0000-0000-0000-000000000001", "title": t, "page": None, "heading": None, "content": f"c{i}"}


def test_rrf_rewards_agreement_between_retrievers():
    hits = fuse([row(1), row(2), row(3)], [row(3), row(4)])
    assert hits[0].chunk_id == 3  # ranked by both
    assert hits[0].vector_rank == 3 and hits[0].keyword_rank == 1
    assert {h.chunk_id for h in hits} == {1, 2, 3, 4}


def test_citations_to_missing_sources_are_removed():
    text, used = extract_citations("Leave is 24 days [2]. Carry-over is 5 days [9][1].", 3)
    assert used == [2, 1]
    assert "[9]" not in text


def test_refusal_detection():
    assert is_refusal("I couldn't find this in the documents you have access to.")
    assert not is_refusal("Leave is 24 days [1].")


@pytest.mark.parametrize("expr,val", [("2 + 3 * 4", 14), ("(120000 * 15%) / 12", 1500), ("10 / 4", 2.5), ("-3 + 1", -2)])
def test_calculator(expr, val):
    assert safe_calc(expr) == val


@pytest.mark.parametrize("expr", ["__import__('os').system('ls')", "open('x')", "a + 1", "9 ** 9999"])
def test_calculator_rejects_code(expr):
    with pytest.raises((ValueError, SyntaxError)):
        safe_calc(expr)


def test_aggregate_metrics():
    results = [
        {"should_answer": True, "answered": True, "hit": True, "reciprocal_rank": 1.0, "context_precision": 0.5, "faithfulness": 1.0,
         "answer_relevancy": 1.0, "answer_correctness": 0.75, "latency_ms": 900, "tokens_in": 100, "tokens_out": 20, "cost_usd": 0.0001},
        {"should_answer": True, "answered": False, "hit": False, "reciprocal_rank": 0.0, "context_precision": None, "faithfulness": None,
         "answer_correctness": 0.0, "latency_ms": 400, "tokens_in": 50, "tokens_out": 0, "cost_usd": 0.0},
        {"should_answer": False, "answered": False, "abstained_correctly": True, "latency_ms": 300, "tokens_in": 10, "tokens_out": 0, "cost_usd": 0},
    ]
    m = aggregate(results)
    assert m["hit_rate"] == 0.5 and m["mrr"] == 0.5 and m["answer_rate"] == 0.5 and m["abstention_accuracy"] == 1.0
    assert m["faithfulness"] == 1.0 and m["latency_p50_ms"] == 400 and m["cases"] == 3


def test_gemini_falls_back_to_fast_model_when_main_model_is_overloaded(monkeypatch):
    import httpx
    from documind.config import Settings
    from documind.llm import gemini as g

    monkeypatch.setattr(g.time, "sleep", lambda s: None)
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if "flash-latest" in request.url.path:
            return httpx.Response(503, json={"error": {"message": "The model is overloaded."}})
        return httpx.Response(200, json={"candidates": [{"content": {"role": "model", "parts": [{"text": "ok [1]"}]}}], "usageMetadata": {"promptTokenCount": 3}})

    p = g.GeminiProvider(Settings(gemini_api_key="test-key"))
    p.client = httpx.Client(transport=httpx.MockTransport(handler))
    r = p.generate("sys", [{"role": "user", "content": "hi"}])
    assert r.text == "ok [1]"
    assert sum("flash-latest" in c for c in calls) == 2 and "flash-lite-latest" in calls[-1]
