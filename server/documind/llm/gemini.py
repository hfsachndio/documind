"""Google Gemini over plain REST (no SDK: smaller serverless bundle, explicit retries)."""
from __future__ import annotations

import json
import math
import random
import time
from typing import Iterator

import httpx

from ..config import Settings
from .base import EmbedResult, LLMError, LLMResult, ToolCall

BASE = "https://generativelanguage.googleapis.com/v1beta"
RETRY_STATUS = {429, 500, 502, 503, 504}


class Overloaded(LLMError):
    """Google returned 5xx (model overloaded) after retries."""


def _normalize(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def _contents(messages: list[dict]) -> list[dict]:
    """Our neutral messages -> Gemini contents. A message may carry 'raw' (a previous model turn) or tool results."""
    out = []
    for m in messages:
        if m.get("raw") is not None:
            out.append(m["raw"])
        elif m["role"] == "tool":
            out.append({"role": "user", "parts": [{"functionResponse": {"name": r["name"], "response": {"result": r["result"]}}} for r in m["results"]]})
        else:
            out.append({"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]})
    return out


class GeminiProvider:
    name = "gemini"

    def __init__(self, s: Settings):
        if not s.gemini_api_key:
            raise LLMError("GEMINI_API_KEY is not set")
        self.s = s
        self.client = httpx.Client(timeout=httpx.Timeout(55.0, connect=10.0), headers={"x-goog-api-key": s.gemini_api_key})

    def _post(self, path: str, body: dict, attempts: int = 4) -> dict:
        for i in range(attempts):
            try:
                r = self.client.post(f"{BASE}/{path}", json=body)
            except httpx.HTTPError as e:
                if i == attempts - 1:
                    raise LLMError(f"Gemini unreachable: {e}") from e
                time.sleep(1.5 * (i + 1))
                continue
            if r.status_code == 200:
                return r.json()
            if r.status_code in RETRY_STATUS and i < attempts - 1:
                wait = 2 ** i + random.random()
                try:  # honour the server's suggested delay when present
                    for d in r.json()["error"].get("details", []):
                        if d.get("retryDelay"):
                            wait = max(wait, float(d["retryDelay"].rstrip("s")))
                except Exception:
                    pass
                time.sleep(min(wait, 20))
                continue
            msg = r.text[:300]
            try:
                msg = r.json()["error"]["message"][:300]
            except Exception:
                pass
            if r.status_code == 429:
                raise LLMError("The free Gemini quota is used up for now. Please try again in a minute.")
            if r.status_code in (500, 502, 503, 504):
                raise Overloaded(f"Gemini is busy ({r.status_code}): {msg}")
            raise LLMError(f"Gemini error {r.status_code}: {msg}")
        raise LLMError("Gemini did not respond")

    # ---- embeddings -------------------------------------------------------------------------------------------
    def embed(self, texts: list[str], task: str = "document") -> EmbedResult:
        task_type = {"document": "RETRIEVAL_DOCUMENT", "query": "RETRIEVAL_QUERY", "similarity": "SEMANTIC_SIMILARITY"}[task]
        model = f"models/{self.s.embed_model}"
        vectors: list[list[float]] = []
        tokens = 0
        for start in range(0, len(texts), 50):  # batch endpoint takes up to 100; 50 keeps requests small
            batch = texts[start:start + 50]
            body = {"requests": [{"model": model, "content": {"parts": [{"text": t[:8000]}]}, "taskType": task_type,
                                  "outputDimensionality": self.s.embed_dim} for t in batch]}
            data = self._post(f"{model}:batchEmbedContents", body)
            vectors += [_normalize(e["values"]) for e in data["embeddings"]]
            tokens += sum(len(t) // 4 + 1 for t in batch)  # embed API returns no usage; ~4 chars/token estimate
        return EmbedResult(vectors=vectors, tokens=tokens)

    # ---- generation -------------------------------------------------------------------------------------------
    def _body(self, system: str, messages: list[dict], temperature: float, json_mode: bool, tools: list[dict] | None) -> dict:
        body: dict = {"contents": _contents(messages), "generationConfig": {"temperature": temperature}}
        if system:
            body["systemInstruction"] = {"parts": [{"text": system}]}
        if json_mode:
            body["generationConfig"]["responseMimeType"] = "application/json"
        if tools:
            body["tools"] = [{"functionDeclarations": tools}]
        return body

    def generate(self, system, messages, *, model=None, temperature=0.2, json_mode=False, tools=None) -> LLMResult:
        model = model or self.s.chat_model
        body = self._body(system, messages, temperature, json_mode, tools)
        try:
            # the main model gets two quick tries; when Google reports it overloaded, the fast model answers instead
            data = self._post(f"models/{model}:generateContent", body, attempts=2 if model != self.s.fast_model else 4)
        except Overloaded:
            if model == self.s.fast_model:
                raise LLMError("Gemini is overloaded right now. Please try again in a minute.") from None
            data = self._post(f"models/{self.s.fast_model}:generateContent", body)
        cand = (data.get("candidates") or [{}])[0]
        content = cand.get("content") or {"role": "model", "parts": []}
        parts = content.get("parts", [])
        usage = data.get("usageMetadata", {})
        return LLMResult(
            text="".join(p.get("text", "") for p in parts if not p.get("thought")),
            tool_calls=[ToolCall(p["functionCall"]["name"], p["functionCall"].get("args", {})) for p in parts if "functionCall" in p],
            tokens_in=usage.get("promptTokenCount", 0),
            tokens_out=usage.get("candidatesTokenCount", 0) + usage.get("thoughtsTokenCount", 0),
            raw_content=content,
        )

    def stream(self, system, messages, *, model=None, temperature=0.2) -> Iterator[str | LLMResult]:
        model = model or self.s.chat_model
        body = self._body(system, messages, temperature, False, None)
        usage: dict = {}
        try:
            with self.client.stream("POST", f"{BASE}/models/{model}:streamGenerateContent?alt=sse", json=body) as r:
                if r.status_code in (500, 502, 503, 504) and model != self.s.fast_model:
                    r.read()  # main model overloaded before anything was sent: stream from the fast model instead
                    yield from self.stream(system, messages, model=self.s.fast_model, temperature=temperature)
                    return
                if r.status_code != 200:
                    r.read()
                    if r.status_code == 429:
                        raise LLMError("The free Gemini quota is used up for now. Please try again in a minute.")
                    raise LLMError(f"Gemini error {r.status_code}")
                for line in r.iter_lines():
                    if not line.startswith("data:"):
                        continue
                    chunk = json.loads(line[5:])
                    usage = chunk.get("usageMetadata", usage)
                    for p in ((chunk.get("candidates") or [{}])[0].get("content") or {}).get("parts", []):
                        if p.get("text") and not p.get("thought"):
                            yield p["text"]
        except httpx.HTTPError as e:
            raise LLMError(f"Gemini unreachable: {e}") from e
        yield LLMResult(tokens_in=usage.get("promptTokenCount", 0),
                        tokens_out=usage.get("candidatesTokenCount", 0) + usage.get("thoughtsTokenCount", 0))
