"""Smoke tests for the Coordinator Copilot router.

These intentionally do NOT hit Azure OpenAI or the real database — they only
verify that the internal-token gate works. The internal-token check is
applied at router-registration time in app/main.py (matching the existing
pattern), so we test via the full FastAPI app.
"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_query_requires_internal_token() -> None:
    r = client.post("/copilot/query", json={"query": "show all batches"})
    assert r.status_code == 401, r.text


def test_narrate_requires_internal_token() -> None:
    r = client.post("/copilot/narrate", json={"batch_id": "x", "report_type": "executive"})
    assert r.status_code == 401, r.text
