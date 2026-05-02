from fastapi.testclient import TestClient

import app.main as main
from app.context_store import ensure_context_files
from app.main import app


def test_setup_status_reports_missing_database_first(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("MODEL_NAME", raising=False)
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    client = TestClient(app)

    response = client.get("/setup/status")

    assert response.status_code == 200
    body = response.json()
    assert body["ready"] is False
    assert body["database"]["ready"] is False
    assert body["next_action"] == "configure_database"


def test_setup_status_reports_missing_provider_after_database(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", "postgresql://readonly:password@localhost:5432/appdb")
    monkeypatch.setattr(main, "test_database_connection", lambda database_url: None)
    monkeypatch.delenv("MODEL_NAME", raising=False)
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    client = TestClient(app)

    response = client.get("/setup/status")

    assert response.status_code == 200
    body = response.json()
    assert body["database"]["ready"] is True
    assert body["model_provider"]["ready"] is False
    assert body["next_action"] == "configure_model_provider"


def test_setup_status_reports_context_needed_after_config(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", "postgresql://readonly:password@localhost:5432/appdb")
    monkeypatch.setattr(main, "test_database_connection", lambda database_url: None)
    monkeypatch.setenv("MODEL_NAME", "openrouter/openai/gpt-4o-mini")
    monkeypatch.setenv("MODEL_API_KEY", "sk-or-test")
    client = TestClient(app)

    response = client.get("/setup/status")

    assert response.status_code == 200
    body = response.json()
    assert body["model_provider"]["ready"] is True
    assert body["context"]["ready"] is False
    assert body["next_action"] == "setup_context"


def test_setup_status_ready_when_context_exists(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", "postgresql://readonly:password@localhost:5432/appdb")
    monkeypatch.setattr(main, "test_database_connection", lambda database_url: None)
    monkeypatch.setenv("MODEL_NAME", "openrouter/openai/gpt-4o-mini")
    monkeypatch.setenv("MODEL_API_KEY", "sk-or-test")
    ensure_context_files()
    client = TestClient(app)

    response = client.get("/setup/status")

    assert response.status_code == 200
    body = response.json()
    assert body["ready"] is True
    assert body["next_action"] is None


def test_setup_bootstrap_requires_ready_config(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    client = TestClient(app)

    response = client.post("/setup/bootstrap")

    assert response.status_code == 400
    assert "Database connection is not configured" in response.json()["detail"]


def test_setup_status_reports_database_connection_failure(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", "postgresql://readonly:password@localhost:5432/appdb")

    def fail_connection(database_url: str) -> None:
        raise RuntimeError("connection refused")

    monkeypatch.setattr(main, "test_database_connection", fail_connection)
    client = TestClient(app)

    response = client.get("/setup/status")

    assert response.status_code == 200
    body = response.json()
    assert body["database"]["configured"] is True
    assert body["database"]["ready"] is False
    assert "connection refused" in body["database"]["message"]
    assert body["next_action"] == "configure_database"
