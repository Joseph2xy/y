from tools.api_client import APIClient

import app.main as main
from app.context_store import ensure_context_files
from app.database_identity import database_source_from_url
from app.main import app
from app.models import SchemaContext
from app.saved_csv_plan_store import load_saved_csv_plan, save_saved_csv_plan
from app.session_store import mark_export_complete


def intent_payload() -> dict:
    return {
        "summary": "Customer export",
        "row_meaning": "One row per customer",
        "columns": [{"name": "email", "description": "Email"}],
        "max_row_count": 10,
    }


def create_completed_session(client: APIClient) -> str:
    session_id = client.post("/sessions").json()["session"]["id"]
    client.post(f"/sessions/{session_id}/approve-intent", json={"intent": intent_payload()})
    response = client.post(
        f"/sessions/{session_id}/export",
        json={"sql": "select email from customers limit 10"},
    )
    assert response.status_code == 200
    return session_id


def test_saved_csv_plan_lifecycle_and_rerun(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", "postgresql://readonly:password@localhost:5432/appdb")
    ensure_context_files(schema=SchemaContext(source=database_source_from_url("postgresql://readonly:password@localhost:5432/appdb")))
    monkeypatch.setattr(main, "read_only_query_runner", lambda *args, **kwargs: lambda sql: [{"email": "a@example.com"}])
    client = APIClient(app)
    session_id = create_completed_session(client)

    create_response = client.post(
        "/saved-csv-plans",
        json={
            "session_id": session_id,
            "name": "Customer emails",
            "description": "Reusable customer email CSV",
        },
    )

    assert create_response.status_code == 200
    plan = create_response.json()
    assert plan["name"] == "Customer emails"
    assert plan["intent"]["summary"] == "Customer export"
    assert plan["last_run_at"] is None

    list_response = client.get("/saved-csv-plans")
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()["plans"]] == [plan["id"]]

    run_response = client.post(f"/saved-csv-plans/{plan['id']}/run")
    assert run_response.status_code == 200
    assert run_response.json()["row_count"] == 1
    assert (tmp_path / "data" / "exports" / f"{run_response.json()['export_id']}.csv").read_text(encoding="utf-8") == (
        "email\na@example.com\n"
    )

    get_response = client.get(f"/saved-csv-plans/{plan['id']}")
    assert get_response.json()["last_run_at"] is not None
    assert get_response.json()["last_export_id"] == run_response.json()["export_id"]

    update_response = client.put(
        f"/saved-csv-plans/{plan['id']}",
        json={"name": "Renamed emails", "description": None},
    )
    assert update_response.status_code == 200
    assert update_response.json()["name"] == "Renamed emails"
    assert update_response.json()["description"] is None

    delete_response = client.request("DELETE", f"/saved-csv-plans/{plan['id']}")
    assert delete_response.status_code == 204
    assert client.get("/saved-csv-plans").json()["plans"] == []


def test_saved_csv_plan_rerun_rejects_different_database_context(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", "postgresql://readonly:password@localhost:5432/appdb")
    ensure_context_files(schema=SchemaContext(source=database_source_from_url("postgresql://readonly:password@localhost:5432/appdb")))
    monkeypatch.setattr(main, "read_only_query_runner", lambda *args, **kwargs: lambda sql: [{"email": "a@example.com"}])
    client = APIClient(app)
    session_id = create_completed_session(client)
    plan = client.post("/saved-csv-plans", json={"session_id": session_id, "name": "Customer emails"}).json()

    ensure_context_files(schema=SchemaContext(source=database_source_from_url("postgresql://readonly:password@localhost:5432/otherdb")))

    response = client.post(f"/saved-csv-plans/{plan['id']}/run")

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "This saved CSV was created for a different database context. "
        "Switch back to the original database or create a new saved CSV for the current database."
    )


def test_saved_csv_plan_rerun_rejects_missing_database_context_metadata(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", "postgresql://readonly:password@localhost:5432/appdb")
    ensure_context_files(schema=SchemaContext(source=database_source_from_url("postgresql://readonly:password@localhost:5432/appdb")))
    monkeypatch.setattr(main, "read_only_query_runner", lambda *args, **kwargs: lambda sql: [{"email": "a@example.com"}])
    client = APIClient(app)
    session_id = create_completed_session(client)
    plan = client.post("/saved-csv-plans", json={"session_id": session_id, "name": "Customer emails"}).json()
    saved_plan = load_saved_csv_plan(plan["id"])
    saved_plan.schema_fingerprint = None
    save_saved_csv_plan(saved_plan)

    response = client.post(f"/saved-csv-plans/{plan['id']}/run")

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "This saved CSV has no database context metadata. "
        "Create a new saved CSV after rescanning the current database."
    )


def test_saved_csv_plan_requires_completed_export(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    client = APIClient(app)
    session_id = client.post("/sessions").json()["session"]["id"]
    client.post(f"/sessions/{session_id}/approve-intent", json={"intent": intent_payload()})

    response = client.post(
        "/saved-csv-plans",
        json={
            "session_id": session_id,
            "name": "Customer emails",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "CSV must be created before it can be saved."


def test_saved_csv_plan_uses_server_recorded_export_sql(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", "postgresql://readonly:password@localhost:5432/appdb")
    ensure_context_files()
    monkeypatch.setattr(main, "read_only_query_runner", lambda *args, **kwargs: lambda sql: [{"email": "a@example.com"}])
    client = APIClient(app)
    session_id = create_completed_session(client)
    response = client.post(
        "/saved-csv-plans",
        json={
            "session_id": session_id,
            "sql": "delete from customers",
            "name": "Customer emails",
        },
    )

    assert response.status_code == 200
    assert response.json()["sql"] == "select email from customers limit 10"


def test_saved_csv_plan_requires_recorded_export_sql(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    client = APIClient(app)
    session_id = client.post("/sessions").json()["session"]["id"]
    client.post(f"/sessions/{session_id}/approve-intent", json={"intent": intent_payload()})
    mark_export_complete(session_id, "legacy-export-without-sql")

    response = client.post(
        "/saved-csv-plans",
        json={"session_id": session_id, "name": "Customer emails"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Completed CSV is missing the validated SQL."
