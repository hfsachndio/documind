"""Runtime settings, all from environment variables (12-factor)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def _jwt_secret() -> str:
    """JWT_SECRET if set; otherwise a key derived from the (already secret) DATABASE_URL, so a fresh
    deployment is secure without an extra variable. Only local development falls back to a fixed key."""
    if os.environ.get("JWT_SECRET"):
        return os.environ["JWT_SECRET"]
    url = os.environ.get("DATABASE_URL", "")
    if url and "localhost" not in url and "127.0.0.1" not in url:
        import hashlib
        return hashlib.sha256(f"documind-jwt-v1:{url}".encode()).hexdigest()
    return "dev-only-change-me"


@dataclass(frozen=True)
class Settings:
    database_url: str = field(default_factory=lambda: os.environ.get("DATABASE_URL", "postgresql://documind@localhost:5434/documind"))
    jwt_secret: str = field(default_factory=lambda: _jwt_secret())
    jwt_ttl_hours: int = field(default_factory=lambda: _int("JWT_TTL_HOURS", 72))

    # LLM provider: "gemini" in production, "fake" for tests/offline development.
    llm_provider: str = field(default_factory=lambda: os.environ.get("LLM_PROVIDER", "gemini" if os.environ.get("GEMINI_API_KEY") else "fake"))
    gemini_api_key: str = field(default_factory=lambda: os.environ.get("GEMINI_API_KEY", ""))
    chat_model: str = field(default_factory=lambda: os.environ.get("CHAT_MODEL", "gemini-flash-latest"))
    fast_model: str = field(default_factory=lambda: os.environ.get("FAST_MODEL", "gemini-flash-lite-latest"))
    embed_model: str = field(default_factory=lambda: os.environ.get("EMBED_MODEL", "gemini-embedding-001"))
    embed_dim: int = field(default_factory=lambda: _int("EMBED_DIM", 768))

    # Retrieval
    chunk_tokens: int = field(default_factory=lambda: _int("CHUNK_TOKENS", 350))
    chunk_overlap: int = field(default_factory=lambda: _int("CHUNK_OVERLAP", 60))
    candidates: int = field(default_factory=lambda: _int("RETRIEVE_CANDIDATES", 30))
    top_k: int = field(default_factory=lambda: _int("TOP_K", 6))
    reranker: str = field(default_factory=lambda: os.environ.get("RERANKER", "llm"))  # llm | cross-encoder | lexical | none
    min_relevance: float = field(default_factory=lambda: _float("MIN_RELEVANCE", 0.35))

    # Cost accounting (USD per 1M tokens) - the free tier costs $0, these show the equivalent paid price.
    price_in_per_m: float = field(default_factory=lambda: _float("PRICE_IN_PER_M", 0.30))
    price_out_per_m: float = field(default_factory=lambda: _float("PRICE_OUT_PER_M", 2.50))
    price_embed_per_m: float = field(default_factory=lambda: _float("PRICE_EMBED_PER_M", 0.15))

    max_upload_mb: int = field(default_factory=lambda: _int("MAX_UPLOAD_MB", 4))
    cors_origins: str = field(default_factory=lambda: os.environ.get("CORS_ORIGINS", "http://localhost:5173"))
    questions_per_hour: int = field(default_factory=lambda: _int("QUESTIONS_PER_HOUR", 60))


def get_settings() -> Settings:
    return Settings()
