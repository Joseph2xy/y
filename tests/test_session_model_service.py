import pytest
from pydantic import BaseModel

from app.context_store import ensure_context_files
from app.models import (
    CSVColumnIntent,
    CSVIntent,
    CSVIntentProposal,
    ChatMessage,
    ClarificationResponse,
    SQLProposal,
    SQLRepairProposal,
)
from app.session_model_service import (
    SessionModelError,
    ask_clarification,
    prepare_sql,
    propose_csv_intent,
    propose_sql,
)
from app.session_store import add_message, approve_intent, create_session, load_session


class FakeProvider:
    def __init__(self, response: BaseModel) -> None:
        self.response = response
        self.calls = []

    def generate_json(self, *, messages: list, response_model: type[BaseModel]) -> BaseModel:
        self.calls.append({"messages": messages, "response_model": response_model})
        return self.response


class QueueProvider:
    def __init__(self, responses: list[BaseModel]) -> None:
        self.responses = responses
        self.calls = []

    def generate_json(self, *, messages: list, response_model: type[BaseModel]) -> BaseModel:
        self.calls.append({"messages": messages, "response_model": response_model})
        return self.responses.pop(0)


class RaisingProvider:
    def __init__(self, exc: Exception) -> None:
        self.exc = exc

    def generate_json(self, *, messages: list, response_model: type[BaseModel]) -> BaseModel:
        raise self.exc


def intent() -> CSVIntent:
    return CSVIntent(
        summary="Customer emails",
        row_meaning="One row per customer",
        columns=[CSVColumnIntent(name="email", description="Email address")],
        max_row_count=10,
    )


def test_propose_csv_intent_updates_session(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    session = create_session()
    add_message(session.id, ChatMessage(role="user", content="Export customer emails."))
    provider = FakeProvider(CSVIntentProposal(message="Here is the CSV plan.", intent=intent()))

    proposal = propose_csv_intent(session_id=session.id, model_provider=provider)

    updated = load_session(session.id)
    assert proposal.intent.summary == "Customer emails"
    assert updated.status == "awaiting_approval"
    assert updated.messages[-1].content == "Here is the CSV plan."
    assert updated.debug_traces[0].step == "propose_intent"
    assert updated.debug_traces[0].details["response_model"] == "CSVIntentProposal"
    assert provider.calls[0]["response_model"] is CSVIntentProposal


def test_propose_csv_intent_clears_stale_approval(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    session = create_session()
    approve_intent(session.id, intent())
    provider = FakeProvider(CSVIntentProposal(message="Here is the new CSV plan.", intent=intent()))

    propose_csv_intent(session_id=session.id, model_provider=provider)

    updated = load_session(session.id)
    assert updated.status == "awaiting_approval"
    assert updated.approved_intent is None


def test_propose_csv_intent_marks_session_failed_when_model_generation_fails(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    session = create_session()

    with pytest.raises(RuntimeError, match="provider unavailable"):
        propose_csv_intent(session_id=session.id, model_provider=RaisingProvider(RuntimeError("provider unavailable")))

    updated = load_session(session.id)
    assert updated.status == "failed"
    assert updated.last_error == "Model provider failed: provider unavailable"
    assert updated.debug_traces[0].step == "propose_intent"
    assert updated.debug_traces[0].summary == "Model call failed for propose_intent."
    assert updated.debug_traces[0].details["error"] == "provider unavailable"
    assert "prompt" in updated.debug_traces[0].details


def test_ask_clarification_keeps_session_in_drafting_state(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    session = create_session()
    provider = FakeProvider(
        ClarificationResponse(
            message="Which date range should the CSV cover?",
            questions=["Which date range should the CSV cover?"],
        )
    )

    response = ask_clarification(session_id=session.id, model_provider=provider)

    updated = load_session(session.id)
    assert response.questions == ["Which date range should the CSV cover?"]
    assert updated.status == "drafting_intent"
    assert updated.messages[-1].role == "assistant"


def test_ask_clarification_clears_stale_approval(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    session = create_session()
    approve_intent(session.id, intent())
    provider = FakeProvider(
        ClarificationResponse(
            message="Which date range should the CSV cover?",
            questions=["Which date range should the CSV cover?"],
        )
    )

    ask_clarification(session_id=session.id, model_provider=provider)

    updated = load_session(session.id)
    assert updated.status == "drafting_intent"
    assert updated.approved_intent is None


def test_propose_sql_requires_approved_intent(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    session = create_session()
    provider = FakeProvider(SQLProposal(sql="select email from customers limit 10"))

    with pytest.raises(SessionModelError, match="approved"):
        propose_sql(session_id=session.id, model_provider=provider)


def test_propose_sql_uses_approved_intent_and_sets_validating_state(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    session = create_session()
    approve_intent(session.id, intent())
    provider = FakeProvider(SQLProposal(sql="select email from customers limit 10"))

    proposal = propose_sql(session_id=session.id, model_provider=provider)

    updated = load_session(session.id)
    prompt_text = "\n".join(message.content for message in provider.calls[0]["messages"])
    assert proposal.sql == "select email from customers limit 10"
    assert updated.status == "validating_sql"
    assert "Approved CSV intent" in prompt_text
    assert "Customer emails" in prompt_text


def test_prepare_sql_returns_valid_first_proposal(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    session = create_session()
    approve_intent(session.id, intent())
    provider = QueueProvider([SQLProposal(sql="select email from customers limit 10")])

    response = prepare_sql(session_id=session.id, model_provider=provider)

    updated = load_session(session.id)
    assert response.valid is True
    assert response.sql == "select email from customers limit 10"
    assert len(response.attempts) == 1
    assert response.attempts[0].valid is True
    assert updated.status == "validating_sql"
    assert [trace.step for trace in updated.debug_traces] == ["prepare_sql", "validate_sql"]
    assert updated.debug_traces[-1].details["valid"] is True


def test_prepare_sql_requires_approved_intent(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    session = create_session()
    provider = QueueProvider([SQLProposal(sql="select email from customers limit 10")])

    with pytest.raises(SessionModelError, match="approved"):
        prepare_sql(session_id=session.id, model_provider=provider)


def test_prepare_sql_marks_session_failed_when_model_generation_fails(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    session = create_session()
    approve_intent(session.id, intent())

    with pytest.raises(RuntimeError, match="provider unavailable"):
        prepare_sql(session_id=session.id, model_provider=RaisingProvider(RuntimeError("provider unavailable")))

    updated = load_session(session.id)
    assert updated.status == "failed"
    assert updated.last_error == "Model provider failed: provider unavailable"
    assert updated.debug_traces[0].step == "prepare_sql"
    assert updated.debug_traces[0].summary == "Model call failed for prepare_sql."
    assert updated.debug_traces[0].details["error"] == "provider unavailable"


def test_prepare_sql_rejects_negative_repair_attempts(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    session = create_session()
    approve_intent(session.id, intent())
    provider = QueueProvider([SQLProposal(sql="select email from customers limit 10")])

    with pytest.raises(SessionModelError, match="cannot be negative"):
        prepare_sql(session_id=session.id, model_provider=provider, max_repair_attempts=-1)


def test_prepare_sql_validates_limit_against_intent_max(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    session = create_session()
    approve_intent(session.id, intent())
    provider = QueueProvider([SQLProposal(sql="select email from customers limit 11")])

    response = prepare_sql(session_id=session.id, model_provider=provider, max_repair_attempts=0)

    assert response.valid is False
    assert response.errors == ["SQL LIMIT must be between 1 and 10."]


def test_prepare_sql_repairs_invalid_proposal(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    session = create_session()
    approve_intent(session.id, intent())
    provider = QueueProvider(
        [
            SQLProposal(sql="select email from customers"),
            SQLRepairProposal(sql="select email from customers limit 10", changes=["Added a limit."]),
        ]
    )

    response = prepare_sql(session_id=session.id, model_provider=provider)

    assert response.valid is True
    assert response.sql == "select email from customers limit 10"
    assert len(response.attempts) == 2
    assert response.attempts[0].errors == ["SQL must include a LIMIT."]
    assert response.attempts[1].repair_changes == ["Added a limit."]
    updated = load_session(session.id)
    assert [trace.step for trace in updated.debug_traces] == [
        "prepare_sql",
        "validate_sql",
        "repair_sql",
        "validate_sql",
    ]
    assert updated.debug_traces[1].details["errors"] == ["SQL must include a LIMIT."]
    assert updated.debug_traces[2].details["response"]["changes"] == ["Added a limit."]


def test_prepare_sql_marks_session_failed_when_repair_generation_fails(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    session = create_session()
    approve_intent(session.id, intent())
    provider = QueueProvider([SQLProposal(sql="select email from customers")])
    original_generate_json = provider.generate_json

    def raise_on_repair(*, messages: list, response_model: type[BaseModel]) -> BaseModel:
        if response_model is SQLRepairProposal:
            raise RuntimeError("repair failed")
        return original_generate_json(messages=messages, response_model=response_model)

    provider.generate_json = raise_on_repair  # type: ignore[method-assign]

    with pytest.raises(RuntimeError, match="repair failed"):
        prepare_sql(session_id=session.id, model_provider=provider)

    updated = load_session(session.id)
    assert updated.status == "failed"
    assert updated.last_error == "Model provider failed: repair failed"
    assert [trace.step for trace in updated.debug_traces] == ["prepare_sql", "validate_sql", "repair_sql"]
    assert updated.debug_traces[-1].summary == "Model call failed for repair_sql."
    assert updated.debug_traces[-1].details["error"] == "repair failed"


def test_prepare_sql_rejects_wrong_output_columns(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    session = create_session()
    approve_intent(session.id, intent())
    provider = QueueProvider(
        [
            SQLProposal(sql="select email, created_at from customers limit 10"),
            SQLRepairProposal(sql="select email, created_at from customers limit 10"),
            SQLRepairProposal(sql="select email, created_at from customers limit 10"),
        ]
    )

    response = prepare_sql(session_id=session.id, model_provider=provider)

    updated = load_session(session.id)
    assert response.valid is False
    assert response.errors == ["SQL output columns must exactly match the approved CSV columns: email."]
    assert updated.status == "failed"


def test_prepare_sql_returns_validation_trace_after_repair_limit(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    session = create_session()
    approve_intent(session.id, intent())
    provider = QueueProvider(
        [
            SQLProposal(sql="select email from customers"),
            SQLRepairProposal(sql="select email from customers"),
        ]
    )

    response = prepare_sql(session_id=session.id, model_provider=provider, max_repair_attempts=1)

    updated = load_session(session.id)
    assert response.valid is False
    assert response.errors == ["SQL must include a LIMIT."]
    assert len(response.attempts) == 2
    assert updated.status == "failed"
    assert updated.last_error == "SQL validation failed: SQL must include a LIMIT."
