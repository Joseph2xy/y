from fastapi.testclient import TestClient

from app.context_store import ensure_context_files, update_context
from app.main import app
from app.models import ContextPolicy, ContextUpdate


def test_validate_sql_uses_context_policy(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files(tmp_path / "data" / "context")
    update_context(
        ContextUpdate(
            context="# Context\n",
            policy=ContextPolicy(blocked_tables=["private_notes"], max_row_count=10),
        ),
        tmp_path / "data" / "context",
    )
    client = TestClient(app)

    response = client.post(
        "/sql/validate",
        json={"sql": "select id from private_notes limit 100"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "valid": False,
        "errors": [
            "SQL LIMIT must be between 1 and 10.",
            "SQL references blocked table 'private_notes'.",
        ],
    }


def test_validate_sql_requires_context_files(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    client = TestClient(app)

    response = client.post("/sql/validate", json={"sql": "select id from customers limit 10"})

    assert response.status_code == 404
