from fastapi.testclient import TestClient

from app.context_store import ensure_context_files
from app.main import app


def test_create_export_requires_database_url(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files(tmp_path / "data" / "context")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    client = TestClient(app)

    response = client.post(
        "/exports",
        json={
            "intent": {
                "summary": "Customer export",
                "row_meaning": "One row per customer",
                "columns": [{"name": "email", "description": "Email"}],
                "max_row_count": 10,
            },
            "sql": "select email from customers limit 10",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "DATABASE_URL is not configured."


def test_download_export_returns_404_for_missing_file(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    client = TestClient(app)

    response = client.get("/exports/missing/download")

    assert response.status_code == 404


def test_download_export_rejects_invalid_id(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    client = TestClient(app)

    response = client.get("/exports/..%2Fsecret/download")

    assert response.status_code == 404


def test_download_export_returns_csv_file(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    export_dir = tmp_path / "data" / "exports"
    export_dir.mkdir(parents=True)
    (export_dir / "abc123.csv").write_text("email\na@example.com\n", encoding="utf-8")
    client = TestClient(app)

    response = client.get("/exports/abc123/download")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert response.text == "email\na@example.com\n"
