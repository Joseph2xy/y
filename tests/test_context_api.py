from tools.api_client import APIClient

import app.main as main
from app.main import app
from app.models import SchemaContext


def test_get_context_returns_404_before_files_exist(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    client = APIClient(app)

    response = client.get("/context")

    assert response.status_code == 404


def test_put_context_creates_and_returns_document(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    client = APIClient(app)

    response = client.put(
        "/context",
        json={
            "context": "# Local Context\n",
            "policy": {
                "blocked_schemas": [],
                "blocked_tables": ["audit_log"],
                "blocked_columns": [],
                "blocked_functions": ["pg_sleep"],
                "max_row_count": 1000,
                "max_export_bytes": 1000000,
                "statement_timeout_ms": 30000,
                "lock_timeout_ms": 5000,
            },
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["context"] == "# Local Context\n"
    assert body["schema"]["tables"] == []
    assert body["policy"]["blocked_tables"] == ["audit_log"]


def test_scan_context_requires_database_url(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    client = APIClient(app)

    response = client.post("/context/scan")

    assert response.status_code == 400
    assert response.json()["detail"] == "DATABASE_URL is not configured."


def test_scan_context_recovers_malformed_policy_file(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", "postgresql://readonly:password@localhost:5432/appdb")
    context_dir = tmp_path / "data" / "context"
    context_dir.mkdir(parents=True)
    (context_dir / "context.md").write_text("# Context\n", encoding="utf-8")
    (context_dir / "schema.json").write_text("{bad json", encoding="utf-8")
    (context_dir / "policy.json").write_text("{bad json", encoding="utf-8")
    monkeypatch.setattr(main, "scan_postgres_schema", lambda database_url, policy=None: SchemaContext())
    client = APIClient(app)

    response = client.post("/context/scan")

    assert response.status_code == 200
    body = response.json()
    assert body["schema"]["source"]["database"] == "appdb"
    assert body["policy"]["max_row_count"] == 100000
