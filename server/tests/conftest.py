import os

os.environ.setdefault("DATABASE_URL", os.environ.get("TEST_DATABASE_URL", "postgresql://documind@localhost:5434/documind_test"))
os.environ["LLM_PROVIDER"] = "fake"
os.environ["JWT_SECRET"] = "test-secret-that-is-at-least-32-bytes-long"
os.environ["RERANKER"] = "llm"          # the fake provider implements the rerank task
os.environ["MIN_RELEVANCE"] = "0.2"
os.environ["QUESTIONS_PER_HOUR"] = "1000"

import psycopg  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from documind.db import ensure_schema  # noqa: E402
from documind.main import app  # noqa: E402

HANDBOOK = """# Acme Employee Handbook

## Annual leave
Full-time employees receive 24 days of paid annual leave per calendar year. Leave must be requested in the HR portal
at least two weeks in advance. Up to 5 unused days can be carried over to the next year.

## Remote work
Employees may work remotely up to 3 days per week with their manager's approval. Core hours are 11:00 to 15:00 PKT.

## Expenses
Travel expenses are reimbursed within 10 working days of submitting receipts. Meals are covered up to PKR 3,000 per day.
"""

SALARIES = """# Salary bands 2026 (confidential)

## Engineering
Senior engineers are paid between PKR 450,000 and PKR 650,000 per month. Bonuses are 15% of annual salary.
"""

PRODUCT = """# DocuMind product FAQ

## Pricing
The Team plan costs USD 49 per month and includes 10 seats. Extra seats cost USD 5 each.

## Security
All documents are encrypted at rest. Single sign-on is available on the Enterprise plan.
"""


@pytest.fixture(scope="session", autouse=True)
def schema():
    ensure_schema(os.environ["DATABASE_URL"])


@pytest.fixture(autouse=True)
def clean():
    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as c:
        c.execute("TRUNCATE users, workspaces, invites, eval_runs, eval_cases, query_logs CASCADE")
    yield


@pytest.fixture
def client():
    return TestClient(app)


def signup(client, name="Ayesha Khan", email="ayesha@acme.test", password="correct-horse-9"):
    r = client.post("/api/auth/signup", json={"name": name, "email": email, "password": password})
    assert r.status_code == 201, r.text
    data = r.json()
    return {"Authorization": f"Bearer {data['token']}"}, data["workspaces"][0]["id"] if data["workspaces"] else None, data


def add_text(client, h, ws, title, text, access="workspace", group_ids=None):
    r = client.post(f"/api/workspaces/{ws}/documents/text", headers=h,
                    json={"title": title, "text": text, "access": access, "group_ids": group_ids or []})
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "ready", r.json()
    return r.json()["id"]
