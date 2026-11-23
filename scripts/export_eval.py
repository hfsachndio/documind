"""Export an evaluation run from a DocuMind deployment to JSONL (question / answer / contexts / reference).

    DOCUMIND_URL=https://<your-app> DOCUMIND_TOKEN=<bearer token> python scripts/export_eval.py <workspace_id> [run_id] > run.jsonl

The token is the one the web app stores after sign-in (localStorage "documind.token"), or from POST /api/auth/login.
"""
import json
import os
import sys
import urllib.request

base, token = os.environ["DOCUMIND_URL"].rstrip("/"), os.environ["DOCUMIND_TOKEN"]


def get(path):
    req = urllib.request.Request(f"{base}/api{path}", headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


ws = sys.argv[1]
run_id = sys.argv[2] if len(sys.argv) > 2 else get(f"/workspaces/{ws}/evals/runs")[0]["id"]
run = get(f"/workspaces/{ws}/evals/runs/{run_id}")
for r in run["results"]:
    print(json.dumps({"user_input": r["question"], "response": r["answer"], "retrieved_contexts": r.get("contexts", []),
                      "reference": r.get("reference") or ""}))
print(f"exported {len(run['results'])} rows from run {run_id}", file=sys.stderr)
