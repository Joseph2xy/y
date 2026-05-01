from fastapi.testclient import TestClient

from app.main import app


def intent_payload() -> dict:
    return {
        "summary": "Customer export",
        "row_meaning": "One row per customer",
        "columns": [{"name": "email", "description": "Email"}],
        "max_row_count": 10,
    }


def test_session_lifecycle(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    client = TestClient(app)

    create_response = client.post("/sessions")
    assert create_response.status_code == 200
    session_id = create_response.json()["session"]["id"]

    message_response = client.post(
        f"/sessions/{session_id}/messages",
        json={"message": {"role": "user", "content": "Export customers"}},
    )
    assert message_response.status_code == 200
    assert message_response.json()["status"] == "awaiting_approval"

    approval_response = client.post(
        f"/sessions/{session_id}/approve-intent",
        json={"intent": intent_payload()},
    )
    assert approval_response.status_code == 200
    assert approval_response.json()["status"] == "generating_sql"

    get_response = client.get(f"/sessions/{session_id}")
    assert get_response.status_code == 200
    assert get_response.json()["approved_intent"]["columns"][0]["name"] == "email"


def test_session_export_requires_approved_intent(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", "postgresql://readonly:password@localhost:5432/appdb")
    client = TestClient(app)
    session_id = client.post("/sessions").json()["session"]["id"]

    response = client.post(
        f"/sessions/{session_id}/export",
        json={"sql": "select email from customers limit 10"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "CSV intent has not been approved."


def test_session_export_requires_database_url(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    client = TestClient(app)
    session_id = client.post("/sessions").json()["session"]["id"]

    response = client.post(
        f"/sessions/{session_id}/export",
        json={"sql": "select email from customers limit 10"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "DATABASE_URL is not configured."


def test_get_missing_session_returns_404(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    client = TestClient(app)

    response = client.get("/sessions/missing")

    assert response.status_code == 404
