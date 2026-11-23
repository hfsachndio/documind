import io
import json

from conftest import HANDBOOK, PRODUCT, SALARIES, add_text, signup


def test_signup_login_me(client):
    h, ws, data = signup(client)
    assert data["workspaces"][0]["role"] == "owner"
    assert client.post("/api/auth/signup", json={"name": "X", "email": "AYESHA@acme.test", "password": "longenough1"}).status_code == 409
    assert client.post("/api/auth/login", json={"email": "ayesha@acme.test", "password": "wrong-password"}).status_code == 401
    r = client.post("/api/auth/login", json={"email": "Ayesha@Acme.test", "password": "correct-horse-9"})
    assert r.status_code == 200 and r.json()["user"]["name"] == "Ayesha Khan"
    assert client.get("/api/auth/me", headers=h).json()["user"]["email"] == "ayesha@acme.test"
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer junk"}).status_code == 401


def test_weak_input_rejected(client):
    assert client.post("/api/auth/signup", json={"name": "A", "email": "a@b.co", "password": "short"}).status_code == 422
    assert client.post("/api/auth/signup", json={"name": "A", "email": "not-an-email", "password": "longenough1"}).status_code == 422


def test_cited_answer_and_refusal(client):
    h, ws, _ = signup(client)
    add_text(client, h, ws, "Employee Handbook", HANDBOOK)
    add_text(client, h, ws, "Product FAQ", PRODUCT)
    r = client.post(f"/api/workspaces/{ws}/ask", headers=h, json={"question": "How many days of annual leave do employees get?"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["answered"] and "24 days" in body["answer"] and "[" in body["answer"]
    assert body["citations"][0]["title"] == "Employee Handbook"
    assert body["trace"]["retrieved"] and "total" in body["trace"]["timings_ms"]
    assert body["trace"]["verification"]["faithfulness"] == 1.0
    # nothing relevant -> guardrail refuses instead of inventing an answer
    r = client.post(f"/api/workspaces/{ws}/ask", headers=h, json={"question": "Who won the cricket world cup in 1992?"})
    assert not r.json()["answered"] and r.json()["citations"] == []
    assert r.json()["trace"]["guardrail"] == "no_relevant_sources"


def test_follow_up_uses_conversation(client):
    h, ws, _ = signup(client)
    add_text(client, h, ws, "Employee Handbook", HANDBOOK)
    first = client.post(f"/api/workspaces/{ws}/ask", headers=h, json={"question": "What is the remote work policy?"}).json()
    r = client.post(f"/api/workspaces/{ws}/ask", headers=h, json={"question": "And travel expenses reimbursement?", "conversation_id": first["conversation_id"]})
    assert r.status_code == 200 and r.json()["conversation_id"] == first["conversation_id"]
    conv = client.get(f"/api/workspaces/{ws}/conversations/{first['conversation_id']}", headers=h).json()
    assert len(conv["messages"]) == 4
    assert client.post(f"/api/workspaces/{ws}/messages/{conv['messages'][1]['id']}/feedback", headers=h, json={"value": 1}).status_code == 200


def test_streaming_answer(client):
    h, ws, _ = signup(client)
    add_text(client, h, ws, "Product FAQ", PRODUCT)
    with client.stream("POST", f"/api/workspaces/{ws}/ask/stream", headers=h, json={"question": "How much does the Team plan cost?"}) as r:
        events = [json.loads(line[5:]) for line in r.iter_lines() if line.startswith("data:")]
    types = [e["type"] for e in events]
    assert types[0] == "retrieval" and "token" in types and types[-1] == "done"
    assert "49" in events[-1]["answer"] and events[-1]["citations"]


def test_permission_aware_retrieval(client):
    """A document restricted to the HR group must never reach a member outside HR, through any path."""
    h_owner, ws, _ = signup(client)
    h_member, _, _ = signup(client, "Bilal Ahmed", "bilal@acme.test")
    bilal_id = client.get("/api/auth/me", headers=h_member).json()["user"]["id"]
    assert client.post(f"/api/workspaces/{ws}/members", headers=h_owner, json={"email": "bilal@acme.test", "role": "member"}).json()["status"] == "added"
    hr = client.post(f"/api/workspaces/{ws}/groups", headers=h_owner, json={"name": "HR"}).json()["id"]
    add_text(client, h_owner, ws, "Employee Handbook", HANDBOOK)
    salaries = add_text(client, h_owner, ws, "Salary bands", SALARIES, access="groups", group_ids=[hr])
    q = {"question": "What are the salary bands for senior engineers?"}

    # owner (admin+) sees it
    assert client.post(f"/api/workspaces/{ws}/ask", headers=h_owner, json=q).json()["citations"][0]["title"] == "Salary bands"
    # member outside HR: not in the library, not retrievable, not readable by id, not reachable by the agent
    assert all(d["title"] != "Salary bands" for d in client.get(f"/api/workspaces/{ws}/documents", headers=h_member).json())
    ans = client.post(f"/api/workspaces/{ws}/ask", headers=h_member, json=q).json()
    assert all(c["title"] != "Salary bands" for c in ans["citations"]) and "450,000" not in ans["answer"]
    assert client.get(f"/api/workspaces/{ws}/documents/{salaries}", headers=h_member).status_code == 404
    agent = client.post(f"/api/workspaces/{ws}/ask", headers=h_member, json={**q, "mode": "agent"}).json()
    assert "450,000" not in agent["answer"]
    # once added to HR, the member can retrieve it
    client.put(f"/api/workspaces/{ws}/groups/{hr}/members", headers=h_owner, json={"user_ids": [bilal_id]})
    assert client.post(f"/api/workspaces/{ws}/ask", headers=h_member, json=q).json()["citations"][0]["title"] == "Salary bands"


def test_workspaces_are_isolated(client):
    h1, ws1, _ = signup(client)
    h2, ws2, _ = signup(client, "Other Org", "other@corp.test")
    add_text(client, h1, ws1, "Employee Handbook", HANDBOOK)
    assert client.get(f"/api/workspaces/{ws1}/documents", headers=h2).status_code == 404
    assert client.post(f"/api/workspaces/{ws1}/ask", headers=h2, json={"question": "annual leave?"}).status_code == 404
    r = client.post(f"/api/workspaces/{ws2}/ask", headers=h2, json={"question": "How many days of annual leave?"})
    assert not r.json()["answered"]


def test_roles(client):
    h_owner, ws, _ = signup(client)
    h_viewer, _, _ = signup(client, "Vera Viewer", "vera@acme.test")
    client.post(f"/api/workspaces/{ws}/members", headers=h_owner, json={"email": "vera@acme.test", "role": "viewer"})
    assert client.post(f"/api/workspaces/{ws}/documents/text", headers=h_viewer, json={"title": "x", "text": "y" * 30}).status_code == 403
    assert client.post(f"/api/workspaces/{ws}/groups", headers=h_viewer, json={"name": "HR"}).status_code == 403
    add_text(client, h_owner, ws, "Product FAQ", PRODUCT)
    assert client.post(f"/api/workspaces/{ws}/ask", headers=h_viewer, json={"question": "What does the Team plan cost?"}).json()["answered"]
    members = client.get(f"/api/workspaces/{ws}/members", headers=h_owner).json()["members"]
    owner_id = next(m["id"] for m in members if m["role"] == "owner")
    assert client.patch(f"/api/workspaces/{ws}/members/{owner_id}", headers=h_owner, json={"role": "viewer"}).status_code == 400


def test_invite_applies_on_signup(client):
    h, ws, _ = signup(client)
    assert client.post(f"/api/workspaces/{ws}/members", headers=h, json={"email": "new@acme.test", "role": "member"}).json()["status"] == "invited"
    _, _, data = signup(client, "New Person", "new@acme.test")
    assert [w["id"] for w in data["workspaces"]] == [ws] and data["workspaces"][0]["role"] == "member"


def test_upload_files_and_errors(client):
    h, ws, _ = signup(client)
    r = client.post(f"/api/workspaces/{ws}/documents/upload", headers=h,
                    files={"file": ("handbook.md", HANDBOOK.encode(), "text/markdown")})
    assert r.status_code == 201 and r.json()["chunks"] >= 3
    r = client.post(f"/api/workspaces/{ws}/documents/upload", headers=h, files={"file": ("photo.png", b"\x89PNG", "image/png")})
    assert r.status_code == 422
    r = client.post(f"/api/workspaces/{ws}/documents/upload", headers=h, data={"access": "groups", "group_ids": "[]"},
                    files={"file": ("a.md", b"# A\nSome text here that is long enough.", "text/markdown")})
    assert r.status_code == 422
    docs = client.get(f"/api/workspaces/{ws}/documents", headers=h).json()
    assert docs[0]["title"] == "handbook" and docs[0]["status"] == "ready" and docs[0]["summary"]
    detail = client.get(f"/api/workspaces/{ws}/documents/{docs[0]['id']}", headers=h).json()
    assert detail["chunks"][0]["heading"] in ("Annual leave", "Acme Employee Handbook")
    assert client.delete(f"/api/workspaces/{ws}/documents/{docs[0]['id']}", headers=h).status_code == 200
    assert client.get(f"/api/workspaces/{ws}/documents", headers=h).json() == []


def test_agent_mode_traces_tools(client):
    h, ws, _ = signup(client)
    add_text(client, h, ws, "Employee Handbook", HANDBOOK)
    r = client.post(f"/api/workspaces/{ws}/ask", headers=h, json={"question": "How many days of annual leave do employees get?", "mode": "agent"})
    body = r.json()
    assert r.status_code == 200 and body["trace"]["mode"] == "agent"
    assert body["trace"]["steps"][0]["tool"] == "search_documents"
    assert body["answered"] and body["citations"]


def test_evaluation_run(client):
    h, ws, _ = signup(client)
    doc = add_text(client, h, ws, "Employee Handbook", HANDBOOK)
    client.post(f"/api/workspaces/{ws}/evals/cases", headers=h, json={"question": "How many days of annual leave?", "expected_answer": "24 days", "expected_document_id": doc})
    client.post(f"/api/workspaces/{ws}/evals/cases", headers=h, json={"question": "What is the capital of Peru?"})  # unanswerable
    run = client.post(f"/api/workspaces/{ws}/evals/runs", headers=h).json()
    assert run["total"] == 2
    while True:
        step = client.post(f"/api/workspaces/{ws}/evals/runs/{run['id']}/next", headers=h).json()
        if step["done"]:
            break
    m = step["metrics"]
    assert m["cases"] == 2 and m["hit_rate"] == 1.0 and m["abstention_accuracy"] == 1.0 and m["latency_p50_ms"] is not None
    assert client.get(f"/api/workspaces/{ws}/evals/runs", headers=h).json()[0]["metrics"]["cases"] == 2


def test_usage(client):
    h, ws, _ = signup(client)
    add_text(client, h, ws, "Product FAQ", PRODUCT)
    client.post(f"/api/workspaces/{ws}/ask", headers=h, json={"question": "How much does the Team plan cost?"})
    u = client.get(f"/api/workspaces/{ws}/usage", headers=h).json()
    assert u["totals"]["questions"] == 1 and u["library"]["documents"] == 1 and u["daily"]


def test_bad_ids_are_404(client):
    h, ws, _ = signup(client)
    assert client.get("/api/workspaces/not-a-uuid/documents", headers=h).status_code == 404
    assert client.get(f"/api/workspaces/{ws}/documents/not-a-uuid", headers=h).status_code == 404


def test_delete_account_removes_user_and_own_workspaces(client):
    h, ws, _ = signup(client, email="leaver@acme.test")
    assert client.request("DELETE", "/api/auth/me", json={"password": "wrong-password"}, headers=h).status_code == 403
    assert client.request("DELETE", "/api/auth/me", json={"password": "correct-horse-9"}, headers=h).json() == {"deleted": True}
    assert client.get("/api/auth/me", headers=h).status_code == 401
    assert client.post("/api/auth/login", json={"email": "leaver@acme.test", "password": "correct-horse-9"}).status_code == 401
    other, _, _ = signup(client, email="other@acme.test")
    assert client.get(f"/api/workspaces/{ws}", headers=other).status_code in (403, 404)
