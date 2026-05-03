from fastapi.testclient import TestClient

import app.main as main
from app.context_store import ensure_context_files
from app.database_identity import database_source_from_url
from app.main import app
from app.models import ModelProviderSettingsUpdate, SchemaContext
from app.provider_settings import save_provider_settings


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


def save_test_provider() -> None:
    save_provider_settings(
        ModelProviderSettingsUpdate(
            provider="openrouter",
            model="openrouter/openai/gpt-4o-mini",
            api_key="sk-or-test",
        )
    )


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
    monkeypatch.setenv("MODEL_NAME", "openrouter/openai/gpt-4o-mini")
    monkeypatch.setenv("MODEL_API_KEY", "sk-or-ignored")
    client = TestClient(app)

    response = client.get("/setup/status")

    assert response.status_code == 200
    body = response.json()
    assert body["database"]["ready"] is True
    assert body["model_provider"]["ready"] is False
    assert "Open Settings" in body["model_provider"]["message"]
    assert body["next_action"] == "configure_model_provider"


def test_setup_status_reports_context_needed_after_config(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", "postgresql://readonly:password@localhost:5432/appdb")
    monkeypatch.setattr(main, "test_database_connection", lambda database_url: None)
    save_test_provider()
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
    save_test_provider()
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
    save_test_provider()
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
    save_test_provider()
    monkeypatch.setattr(main, "scan_context", lambda: (_ for _ in ()).throw(AssertionError("unexpected rescan")))
    client = TestClient(app)

    response = client.post("/setup/bootstrap")

    assert response.status_code == 200
    body = response.json()
    assert body["ready"] is False
    assert body["next_action"] == "rescan_context"


def test_setup_bootstrap_scans_database_when_context_is_missing(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    database_url = "postgresql://readonly:password@localhost:5432/appdb"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setattr(main, "test_database_connection", lambda database_url: None)
    monkeypatch.setattr(main, "scan_postgres_schema", lambda database_url, policy=None: SchemaContext())
    save_test_provider()
    client = TestClient(app)

    response = client.post("/setup/bootstrap")

    assert response.status_code == 200
    body = response.json()
    assert body["ready"] is True
    assert body["context_source"]["database"] == "appdb"


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
    assert body["next_action"] == "connect_database"


def test_database_settings_test_reports_success(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", "postgresql://readonly:password@localhost:5432/appdb")
    monkeypatch.setattr(main, "test_database_connection", lambda database_url: None)
    client = TestClient(app)

    response = client.post("/settings/database/test")

    assert response.status_code == 200
    body = response.json()
    assert body["configured"] is True
    assert body["ok"] is True
    assert body["message"] == "Connected to appdb on localhost:5432."
    assert body["current_database"]["database"] == "appdb"


def test_database_settings_test_reports_missing_database_url(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    client = TestClient(app)

    response = client.post("/settings/database/test")

    assert response.status_code == 200
    body = response.json()
    assert body == {
        "configured": False,
        "ok": False,
        "message": "DATABASE_URL is not configured.",
        "current_database": None,
    }


def test_database_settings_test_reports_connection_failure(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", "postgresql://readonly:password@localhost:5432/appdb")

    def fail_connection(database_url: str) -> None:
        raise RuntimeError("connection refused")

    monkeypatch.setattr(main, "test_database_connection", fail_connection)
    client = TestClient(app)

    response = client.post("/settings/database/test")

    assert response.status_code == 200
    body = response.json()
    assert body["configured"] is True
    assert body["ok"] is False
    assert body["message"] == "Database connection failed: connection refused"
    assert body["current_database"]["database"] == "appdb"
