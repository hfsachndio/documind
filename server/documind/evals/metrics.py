"""RAG evaluation metrics (RAGAS-style), computed per test case and aggregated per run.

Retrieval:  hit_rate@k, MRR, context_precision (share of retrieved passages the reranker judged relevant)
Generation: faithfulness (claims supported by sources), answer_relevancy (judge 1-5 -> 0..1),
            answer_correctness vs a reference answer (judge), abstention accuracy on unanswerable questions
Ops:        latency p50/p95, tokens, cost per question
"""
from __future__ import annotations

import json
import re
import statistics
import time

import psycopg

from ..config import Settings
from ..llm import LLMError, get_provider
from ..rag.answer import answer
from ..security import Access

JUDGE_RELEVANCY = """TASK: judge
Rate how directly the ANSWER addresses the QUESTION (ignore whether it is correct). 5 = fully addresses it, 1 = off-topic.
A refusal saying the information wasn't found scores 1. Return JSON {"score": 1-5, "reason": "..."}"""

JUDGE_CORRECTNESS = """TASK: judge
Compare the ANSWER with the REFERENCE answer. 5 = same facts, 3 = partly correct or incomplete, 1 = wrong or contradicts it.
Return JSON {"score": 1-5, "reason": "..."}"""


def _judge(s: Settings, system: str, content: str) -> tuple[float | None, str, int, int]:
    try:
        r = get_provider(s).generate(system, [{"role": "user", "content": content}], model=s.fast_model, temperature=0.0, json_mode=True)
        d = json.loads(re.search(r"\{.*\}", r.text, re.S).group(0))
        return (max(1, min(5, float(d["score"]))) - 1) / 4, str(d.get("reason", ""))[:200], r.tokens_in, r.tokens_out
    except (LLMError, AttributeError, ValueError, KeyError, TypeError):
        return None, "judge unavailable", 0, 0


def evaluate_case(db: psycopg.Connection, s: Settings, a: Access, case: dict) -> dict:
    t0 = time.perf_counter()
    ans = answer(db, s, a, case["question"], check_faithfulness=True)
    latency = round((time.perf_counter() - t0) * 1000)
    retrieved_docs = [r["title"] for r in ans.trace.get("retrieved", [])]
    expected_doc = case.get("expected_document_title")
    should_answer = bool(case.get("expected_answer") or expected_doc)
    res: dict = {"question": case["question"], "answer": ans.text, "answered": ans.answered, "latency_ms": latency,
                 "tokens_in": ans.tokens_in, "tokens_out": ans.tokens_out, "cost_usd": ans.cost_usd,
                 "retrieved": retrieved_docs, "expected_document": expected_doc, "should_answer": should_answer,
                 "citations": len(ans.citations), "guardrail": ans.trace.get("guardrail"),
                 "contexts": [c["content"][:800] for c in ans.citations[:4]], "reference": case.get("expected_answer")}
    if expected_doc:
        rank = next((i + 1 for i, t in enumerate(retrieved_docs) if t == expected_doc), None)
        res["hit"] = rank is not None
        res["reciprocal_rank"] = round(1 / rank, 3) if rank else 0.0
    rel = [r["relevance"] for r in ans.trace.get("retrieved", [])]
    res["context_precision"] = round(sum(1 for x in rel if x >= 0.5) / len(rel), 3) if rel else None
    res["faithfulness"] = (ans.trace.get("verification") or {}).get("faithfulness") if ans.answered else None
    res["abstained_correctly"] = (not ans.answered) if not should_answer else None
    if ans.answered:
        sc, why, i, o = _judge(s, JUDGE_RELEVANCY, f"QUESTION: {case['question']}\nANSWER: {ans.text}")
        res["answer_relevancy"], res["relevancy_reason"] = sc, why
        res["tokens_in"] += i; res["tokens_out"] += o
    if case.get("expected_answer"):
        if ans.answered:
            sc, why, i, o = _judge(s, JUDGE_CORRECTNESS, f"QUESTION: {case['question']}\nREFERENCE: {case['expected_answer']}\nANSWER: {ans.text}")
            res["tokens_in"] += i; res["tokens_out"] += o
        else:
            sc, why = 0.0, "did not answer"
        res["answer_correctness"], res["correctness_reason"] = sc, why
    return res


def _mean(xs):
    xs = [x for x in xs if x is not None]
    return round(statistics.fmean(xs), 3) if xs else None


def _pct(xs, p):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    return xs[min(len(xs) - 1, round(p / 100 * (len(xs) - 1)))]


def aggregate(results: list[dict]) -> dict:
    hits = [r["hit"] for r in results if "hit" in r]
    abst = [r["abstained_correctly"] for r in results if r.get("abstained_correctly") is not None]
    answerable = [r for r in results if r["should_answer"]]
    return {
        "cases": len(results),
        "hit_rate": round(sum(hits) / len(hits), 3) if hits else None,
        "mrr": _mean([r.get("reciprocal_rank") for r in results]),
        "context_precision": _mean([r.get("context_precision") for r in results]),
        "faithfulness": _mean([r.get("faithfulness") for r in results]),
        "answer_relevancy": _mean([r.get("answer_relevancy") for r in results]),
        "answer_correctness": _mean([r.get("answer_correctness") for r in results]),
        "answer_rate": round(sum(1 for r in answerable if r["answered"]) / len(answerable), 3) if answerable else None,
        "abstention_accuracy": round(sum(abst) / len(abst), 3) if abst else None,
        "latency_p50_ms": _pct([r["latency_ms"] for r in results], 50),
        "latency_p95_ms": _pct([r["latency_ms"] for r in results], 95),
        "avg_tokens": round(statistics.fmean([r["tokens_in"] + r["tokens_out"] for r in results])) if results else 0,
        "cost_per_question_usd": round(statistics.fmean([r["cost_usd"] for r in results]), 6) if results else 0,
    }
