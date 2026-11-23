from ..config import Settings, get_settings
from .base import EmbedResult, LLMError, LLMResult, Provider, ToolCall

_cache: dict[tuple, "Provider"] = {}


def get_provider(s: Settings | None = None) -> "Provider":
    s = s or get_settings()
    key = (s.llm_provider, s.gemini_api_key, s.chat_model, s.embed_model)
    if key not in _cache:
        if s.llm_provider == "gemini":
            from .gemini import GeminiProvider
            _cache[key] = GeminiProvider(s)
        else:
            from .fake import FakeProvider
            _cache[key] = FakeProvider(s)
    return _cache[key]


def cost_usd(s: Settings, tokens_in: int, tokens_out: int, embed_tokens: int = 0) -> float:
    return round(tokens_in / 1e6 * s.price_in_per_m + tokens_out / 1e6 * s.price_out_per_m + embed_tokens / 1e6 * s.price_embed_per_m, 6)


__all__ = ["get_provider", "cost_usd", "EmbedResult", "LLMError", "LLMResult", "Provider", "ToolCall"]
