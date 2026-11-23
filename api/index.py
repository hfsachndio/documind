"""Vercel serverless entry point: exposes the FastAPI app from server/documind."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "server"))

from documind.main import app  # noqa: E402,F401
