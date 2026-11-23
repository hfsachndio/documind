"""Provider-neutral LLM interface so the pipeline can swap Gemini, OpenAI, Bedrock or a local model."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterator, Protocol


@dataclass
class ToolCall:
    name: str
    args: dict


@dataclass
class LLMResult:
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    tokens_in: int = 0
    tokens_out: int = 0
    raw_content: Any = None  # provider message to send back verbatim in multi-turn tool use


@dataclass
class EmbedResult:
    vectors: list[list[float]]
    tokens: int


class LLMError(RuntimeError):
    """Provider failure the API turns into a friendly 503 (quota, outage, bad key)."""


class Provider(Protocol):
    name: str

    def embed(self, texts: list[str], task: str = "document") -> EmbedResult: ...

    def generate(self, system: str, messages: list[dict], *, model: str | None = None, temperature: float = 0.2,
                 json_mode: bool = False, tools: list[dict] | None = None) -> LLMResult: ...

    def stream(self, system: str, messages: list[dict], *, model: str | None = None, temperature: float = 0.2) -> Iterator[str | LLMResult]: ...
