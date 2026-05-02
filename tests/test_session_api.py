from fastapi.testclient import TestClient
from pydantic import BaseModel

import app.main as main
from app.context_store import ensure_context_files
from app.main import app
from app.models import CSVIntentProposal, ClarificationResponse, SQLProposal, SQLRepairProposal
from app.main import get_model_provider
from app.session_store import load_session


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
    assert message_response.json()["status"] == "drafting_intent"

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


def test_session_export_happy_path_marks_complete_and_escapes_csv(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", "postgresql://readonly:password@localhost:5432/appdb")
    ensure_context_files()
    monkeypatch.setattr(
        main,
        "read_only_query_runner",
        lambda *args, **kwargs: lambda sql: [{"email": "a@example.com", "note": " =1+1"}],
    )
    client = TestClient(app)
    session_id = client.post("/sessions").json()["session"]["id"]
    client.post(
        f"/sessions/{session_id}/approve-intent",
        json={
            "intent": {
                "summary": "Customer export",
                "row_meaning": "One row per customer",
                "columns": [
                    {"name": "email", "description": "Email"},
                    {"name": "note", "description": "Note"},
                ],
                "max_row_count": 10,
            }
        },
    )

    response = client.post(
        f"/sessions/{session_id}/export",
        json={"sql": "select email, note from customers limit 10"},
    )

    body = response.json()
    assert response.status_code == 200
    assert body["row_count"] == 1
    assert load_session(session_id).status == "complete"
    assert (tmp_path / "data" / "exports" / f"{body['export_id']}.csv").read_text(encoding="utf-8") == (
        "email,note\na@example.com,' =1+1\n"
    )


def test_session_export_invalid_sql_marks_failed_and_writes_no_export(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", "postgresql://readonly:password@localhost:5432/appdb")
    ensure_context_files()
    monkeypatch.setattr(main, "read_only_query_runner", lambda *args, **kwargs: lambda sql: [])
    client = TestClient(app)
    session_id = client.post("/sessions").json()["session"]["id"]
    client.post(f"/sessions/{session_id}/approve-intent", json={"intent": intent_payload()})

    response = client.post(
        f"/sessions/{session_id}/export",
        json={"sql": "delete from customers"},
    )

    assert response.status_code == 400
    session = load_session(session_id)
    assert session.status == "failed"
    assert session.last_error and session.last_error.startswith("SQL validation failed:")
    assert not (tmp_path / "data" / "exports").exists()


def test_session_export_unexpected_error_marks_failed(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", "postgresql://readonly:password@localhost:5432/appdb")
    ensure_context_files()

    def broken_runner(*args, **kwargs):
        def run(sql: str):
            raise OSError("disk full")
            yield {}

        return run

    monkeypatch.setattr(main, "read_only_query_runner", broken_runner)
    client = TestClient(app, raise_server_exceptions=False)
    session_id = client.post("/sessions").json()["session"]["id"]
    client.post(f"/sessions/{session_id}/approve-intent", json={"intent": intent_payload()})

    response = client.post(
        f"/sessions/{session_id}/export",
        json={"sql": "select email from customers limit 10"},
    )

    assert response.status_code == 500
    session = load_session(session_id)
    assert session.status == "failed"
    assert session.last_error == "disk full"


def test_get_missing_session_returns_404(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    client = TestClient(app)

    response = client.get("/sessions/missing")

    assert response.status_code == 404


class FakeProvider:
    def __init__(self, response: BaseModel) -> None:
        self.response = response

    def generate_json(self, *, messages: list, response_model: type[BaseModel]) -> BaseModel:
        return self.response


class QueueProvider:
    def __init__(self, responses: list[BaseModel]) -> None:
        self.responses = responses

    def generate_json(self, *, messages: list, response_model: type[BaseModel]) -> BaseModel:
        return self.responses.pop(0)


def override_provider(response: BaseModel):
    app.dependency_overrides[get_model_provider] = lambda: FakeProvider(response)


def override_queue_provider(responses: list[BaseModel]):
    app.dependency_overrides[get_model_provider] = lambda: QueueProvider(responses)


def clear_overrides() -> None:
    app.dependency_overrides.clear()


def test_propose_intent_endpoint_uses_model_provider(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    override_provider(CSVIntentProposal(message="Here is the CSV plan.", intent=intent_payload()))
    client = TestClient(app)
    session_id = client.post("/sessions").json()["session"]["id"]
    client.post(
        f"/sessions/{session_id}/messages",
        json={"message": {"role": "user", "content": "Export customer emails"}},
    )

    try:
        response = client.post(f"/sessions/{session_id}/propose-intent")
    finally:
        clear_overrides()

    assert response.status_code == 200
    assert response.json()["intent"]["summary"] == "Customer export"
    session = client.get(f"/sessions/{session_id}").json()
    assert session["status"] == "awaiting_approval"
    assert session["messages"][-1]["content"] == "Here is the CSV plan."


def test_clarify_endpoint_uses_model_provider(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    override_provider(
        ClarificationResponse(
            message="Which date range should the CSV cover?",
            questions=["Which date range should the CSV cover?"],
        )
    )
    client = TestClient(app)
    session_id = client.post("/sessions").json()["session"]["id"]

    try:
        response = client.post(f"/sessions/{session_id}/clarify")
    finally:
        clear_overrides()

    assert response.status_code == 200
    assert response.json()["questions"] == ["Which date range should the CSV cover?"]
    assert client.get(f"/sessions/{session_id}").json()["status"] == "drafting_intent"


def test_propose_sql_endpoint_requires_approved_intent(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    override_provider(SQLProposal(sql="select email from customers limit 10"))
    client = TestClient(app)
    session_id = client.post("/sessions").json()["session"]["id"]

    try:
        response = client.post(f"/sessions/{session_id}/propose-sql")
    finally:
        clear_overrides()

    assert response.status_code == 400
    assert response.json()["detail"] == "CSV intent must be approved before SQL generation."


def test_prepare_sql_endpoint_requires_approved_intent(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    override_provider(SQLProposal(sql="select email from customers limit 10"))
    client = TestClient(app)
    session_id = client.post("/sessions").json()["session"]["id"]

    try:
        response = client.post(f"/sessions/{session_id}/prepare-sql")
    finally:
        clear_overrides()

    assert response.status_code == 400
    assert response.json()["detail"] == "CSV intent must be approved before SQL generation."


def test_propose_sql_endpoint_returns_sql_after_approval(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    override_provider(SQLProposal(sql="select email from customers limit 10", notes=["Ready to validate."]))
    client = TestClient(app)
    session_id = client.post("/sessions").json()["session"]["id"]
    client.post(f"/sessions/{session_id}/approve-intent", json={"intent": intent_payload()})

    try:
        response = client.post(f"/sessions/{session_id}/propose-sql")
    finally:
        clear_overrides()

    assert response.status_code == 200
    assert response.json()["sql"] == "select email from customers limit 10"
    assert client.get(f"/sessions/{session_id}").json()["status"] == "validating_sql"


def test_public_repair_sql_endpoint_is_not_available(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    client = TestClient(app)
    session_id = client.post("/sessions").json()["session"]["id"]
    client.post(f"/sessions/{session_id}/approve-intent", json={"intent": intent_payload()})

    response = client.post(
        f"/sessions/{session_id}/repair-sql",
        json={
            "sql": "select email from customers limit 100",
            "validation_errors": ["SQL LIMIT must be between 1 and 10."],
        },
    )

    assert response.status_code == 404


def test_prepare_sql_endpoint_repairs_and_returns_validation_trace(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    override_queue_provider(
        [
            SQLProposal(sql="select email from customers"),
            SQLRepairProposal(sql="select email from customers limit 10", changes=["Added a limit."]),
        ]
    )
    client = TestClient(app)
    session_id = client.post("/sessions").json()["session"]["id"]
    client.post(f"/sessions/{session_id}/approve-intent", json={"intent": intent_payload()})

    try:
        response = client.post(f"/sessions/{session_id}/prepare-sql")
    finally:
        clear_overrides()

    body = response.json()
    assert response.status_code == 200
    assert body["valid"] is True
    assert body["sql"] == "select email from customers limit 10"
    assert body["attempts"][0]["errors"] == ["SQL must include a LIMIT."]
    assert body["attempts"][1]["repair_changes"] == ["Added a limit."]


def test_prepare_sql_endpoint_rejects_wrong_output_columns(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    override_queue_provider(
        [
            SQLProposal(sql="select email, created_at from customers limit 10"),
            SQLRepairProposal(sql="select email, created_at from customers limit 10"),
            SQLRepairProposal(sql="select email, created_at from customers limit 10"),
        ]
    )
    client = TestClient(app)
    session_id = client.post("/sessions").json()["session"]["id"]
    client.post(f"/sessions/{session_id}/approve-intent", json={"intent": intent_payload()})

    try:
        response = client.post(f"/sessions/{session_id}/prepare-sql")
    finally:
        clear_overrides()

    body = response.json()
    assert response.status_code == 200
    assert body["valid"] is False
    assert body["errors"] == ["SQL output columns must exactly match the approved CSV columns: email."]


def test_model_endpoint_requires_model_configuration(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("MODEL_NAME", raising=False)
    monkeypatch.delenv("LITELLM_MODEL", raising=False)
    ensure_context_files()
    client = TestClient(app)
    session_id = client.post("/sessions").json()["session"]["id"]

    response = client.post(f"/sessions/{session_id}/clarify")

    assert response.status_code == 400
    assert response.json()["detail"] == "MODEL_NAME or LITELLM_MODEL is not configured."
