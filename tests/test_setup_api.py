from fastapi.testclient import TestClient

import app.main as main
from app.context_store import ensure_context_files
from app.database_identity import database_source_from_url
from app.main import app
from app.models import SchemaContext


PROVIDER_ENV_VARS = (
    "MODEL_NAME",
    "LITELLM_MODEL",
    "MODEL_API_KEY",
    "LITELLM_API_KEY",
    "MODEL_BASE_URL",
    "LITELLM_API_BASE",
    "WORKER_LLM_PROVIDER",
    "WORKER_OPENROUTER_MODEL",
    "OPENROUTER_API_KEY",
)


def clear_provider_env(monkeypatch) -> None:
    for name in PROVIDER_ENV_VARS:
        monkeypatch.delenv(name, raising=False)


def test_setup_status_reports_missing_database_first(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    clear_provider_env(monkeypatch)
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
    clear_provider_env(monkeypatch)
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
    database_url = "postgresql://readonly:password@localhost:5432/appdb"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setattr(main, "test_database_connection", lambda database_url: None)
    monkeypatch.setenv("MODEL_NAME", "openrouter/openai/gpt-4o-mini")
    monkeypatch.setenv("MODEL_API_KEY", "sk-or-test")
    ensure_context_files(schema=SchemaContext(source=database_source_from_url(database_url)))
    client = TestClient(app)

    response = client.get("/setup/status")

    assert response.status_code == 200
    body = response.json()
    assert body["ready"] is True
    assert body["next_action"] is None
    assert body["context_source"]["database"] == "appdb"


def test_setup_status_reports_context_stale_when_database_changes(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    old_url = "postgresql://readonly:password@localhost:5432/old_app"
    new_url = "postgresql://readonly:password@localhost:5432/new_app"
    ensure_context_files(schema=SchemaContext(source=database_source_from_url(old_url)))
    monkeypatch.setenv("DATABASE_URL", new_url)
    monkeypatch.setattr(main, "test_database_connection", lambda database_url: None)
    monkeypatch.setenv("MODEL_NAME", "openrouter/openai/gpt-4o-mini")
    monkeypatch.setenv("MODEL_API_KEY", "sk-or-test")
    client = TestClient(app)

    response = client.get("/setup/status")

    assert response.status_code == 200
    body = response.json()
    assert body["ready"] is False
    assert body["context"]["configured"] is True
    assert body["context"]["ready"] is False
    assert "Run a context rescan" in body["context"]["message"]
    assert body["next_action"] == "rescan_context"


def test_setup_bootstrap_does_not_rescan_stale_configured_context(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    old_url = "postgresql://readonly:password@localhost:5432/old_app"
    new_url = "postgresql://readonly:password@localhost:5432/new_app"
    ensure_context_files(schema=SchemaContext(source=database_source_from_url(old_url)))
    monkeypatch.setenv("DATABASE_URL", new_url)
    monkeypatch.setattr(main, "test_database_connection", lambda database_url: None)
    monkeypatch.setenv("MODEL_NAME", "openrouter/openai/gpt-4o-mini")
    monkeypatch.setenv("MODEL_API_KEY", "sk-or-test")
    monkeypatch.setattr(main, "scan_context", lambda: (_ for _ in ()).throw(AssertionError("unexpected rescan")))
    client = TestClient(app)

    response = client.post("/setup/bootstrap")

    assert response.status_code == 200
    body = response.json()
    assert body["ready"] is False
    assert body["next_action"] == "rescan_context"


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
