"""Postgres access: one connection per request (works well with Neon's pooled endpoint on serverless)."""
from __future__ import annotations

import pathlib
import threading
from contextlib import contextmanager
from typing import Iterator

import psycopg
from pgvector.psycopg import register_vector
from psycopg.rows import dict_row

from .config import get_settings

_SCHEMA = (pathlib.Path(__file__).parent / "schema.sql").read_text()
_ready: set[str] = set()
_lock = threading.Lock()


def _connect(url: str) -> psycopg.Connection:
    conn = psycopg.connect(url, row_factory=dict_row, autocommit=False, connect_timeout=10)
    return conn


def ensure_schema(url: str | None = None) -> None:
    url = url or get_settings().database_url
    if url in _ready:
        return
    with _lock:
        if url in _ready:
            return
        with _connect(url) as conn:
            conn.execute("SELECT pg_advisory_xact_lock(424242)")  # one migrator at a time
            conn.execute(_SCHEMA)
            conn.commit()
        _ready.add(url)


@contextmanager
def connection(url: str | None = None) -> Iterator[psycopg.Connection]:
    url = url or get_settings().database_url
    ensure_schema(url)
    conn = _connect(url)
    register_vector(conn)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_db() -> Iterator[psycopg.Connection]:
    """FastAPI dependency."""
    with connection() as conn:
        yield conn
