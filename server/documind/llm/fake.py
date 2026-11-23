"""Deterministic offline provider for tests and keyless local development.

Embeddings are hashed bag-of-words vectors (so lexical overlap ~ cosine similarity); generation is extractive.
Each system prompt carries a 'TASK: <name>' line so the fake can respond in the expected shape.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from typing import Iterator

from ..config import Settings
from .base import EmbedResult, LLMResult, ToolCall

WORD = re.compile(r"[a-z0-9]+")
STOP = set("the a an of to and or in on for is are was were be by with as at from that this it its what which who how do does can i you your our we".split())


def words(t: str) -> list[str]:
    return [w for w in WORD.findall(t.lower()) if w not in STOP]


def _task(system: str) -> str:
    m = re.search(r"TASK:\s*(\w+)", system)
    return m.group(1) if m else "answer"


class FakeProvider:
    name = "fake"

    def __init__(self, s: Settings):
        self.dim = s.embed_dim

    def embed(self, texts, task="document") -> EmbedResult:
        out = []
        for t in texts:
            v = [0.0] * self.dim
            for w in words(t):
                h = int(hashlib.md5(w.encode()).hexdigest(), 16)
                v[h % self.dim] += 1.0 if (h >> 8) & 1 else -1.0
            n = math.sqrt(sum(x * x for x in v)) or 1.0
            out.append([x / n for x in v])
        return EmbedResult(vectors=out, tokens=sum(len(t) // 4 + 1 for t in texts))

    def _last_user(self, messages) -> str:
        for m in reversed(messages):
            if m.get("role") == "user" and "content" in m:
                return m["content"]
        return ""

    def generate(self, system, messages, *, model=None, temperature=0.2, json_mode=False, tools=None) -> LLMResult:
        task, prompt = _task(system), self._last_user(messages)
        if tools:
            if messages and messages[-1].get("role") == "tool":
                found = messages[-1]["results"][0]["result"]
                srcs = found.get("sources", []) if isinstance(found, dict) else []
                text = (f"{srcs[0]['text'].split('. ')[0].strip()}. [{srcs[0]['n']}]" if srcs else "I couldn't find that in your documents.")
                return LLMResult(text=text, tokens_in=50, tokens_out=20, raw_content={"role": "model", "parts": [{"text": text}]})
            q = prompt.split("\n")[0][:200]
            call = {"functionCall": {"name": "search_documents", "args": {"query": q}}}
            return LLMResult(tool_calls=[ToolCall("search_documents", {"query": q})], tokens_in=40, tokens_out=10,
                             raw_content={"role": "model", "parts": [call]})
        if task == "rerank":
            q = set(words(prompt.split("PASSAGES:")[0]))
            scores = []
            for m in re.finditer(r"\[(\d+)\]\s*(.+)", prompt.split("PASSAGES:")[-1]):
                w = set(words(m.group(2)))
                scores.append({"id": int(m.group(1)), "score": round(len(q & w) / (len(q) or 1), 3)})
            return LLMResult(text=json.dumps({"scores": scores}), tokens_in=100, tokens_out=30)
        if task == "verify":
            claims = [s for s in re.split(r"(?<=[.!?])\s+", prompt.split("ANSWER:")[-1].strip()) if s]
            return LLMResult(text=json.dumps({"claims": [{"claim": c, "supported": True} for c in claims]}), tokens_in=80, tokens_out=20)
        if task == "judge":
            return LLMResult(text=json.dumps({"score": 4, "reason": "offline judge"}), tokens_in=60, tokens_out=10)
        if task == "condense":
            return LLMResult(text=prompt.split("user:")[-1].strip(), tokens_in=30, tokens_out=10)
        if task in ("summarize", "compare", "title"):
            body = prompt.split("\n", 1)[-1]
            return LLMResult(text=" ".join(body.split()[:40]), tokens_in=60, tokens_out=30)
        return LLMResult(text=self._extractive(prompt), tokens_in=len(prompt) // 4, tokens_out=30)

    def _extractive(self, prompt: str) -> str:
        q = set(words(prompt.split("QUESTION:")[-1]))
        best, best_n, score = "", 0, 0
        for m in re.finditer(r"\[(\d+)\][^\n]*\n(.+?)(?=\n\[\d+\]|\nQUESTION:|\Z)", prompt, re.S):
            for sent in re.split(r"(?<=[.!?])\s+", m.group(2)):
                sc = len(q & set(words(sent)))
                if sc > score:
                    best, best_n, score = sent.strip(), int(m.group(1)), sc
        return f"{best} [{best_n}]" if best else "I couldn't find this in your documents."

    def stream(self, system, messages, *, model=None, temperature=0.2) -> Iterator[str | LLMResult]:
        r = self.generate(system, messages)
        for i in range(0, len(r.text), 24):
            yield r.text[i:i + 24]
        yield LLMResult(tokens_in=r.tokens_in, tokens_out=r.tokens_out)
