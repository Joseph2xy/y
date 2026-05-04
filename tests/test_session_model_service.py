import pytest
from pydantic import BaseModel

from app.context_store import ensure_context_files
from app.models import (
    CSVColumnIntent,
    CSVIntent,
    CSVIntentProposal,
    ChatMessage,
    SQLProposal,
    SQLRepairProposal,
)
from app.session_model_service import (
    SessionModelError,
    prepare_sql,
    propose_csv_intent,
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


def test_propose_csv_intent_can_request_clarification(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    session = create_session()
    add_message(session.id, ChatMessage(role="user", content="Send me the useful customer stuff."))
    provider = FakeProvider(
        CSVIntentProposal(
            message="Which customer fields should the CSV include?",
            questions=["Which customer fields should the CSV include?"],
        )
    )

    proposal = propose_csv_intent(session_id=session.id, model_provider=provider)

    updated = load_session(session.id)
    assert proposal.intent is None
    assert proposal.questions == ["Which customer fields should the CSV include?"]
    assert updated.status == "drafting_intent"
    assert updated.messages[-1].content == "Which customer fields should the CSV include?"
    assert updated.approved_intent is None


def test_csv_intent_coerces_model_text_list_objects() -> None:
    proposal = CSVIntentProposal.model_validate(
        {
            "message": "Here is the CSV plan.",
            "intent": {
                "summary": "Overdue invoices",
                "row_meaning": "One row per overdue invoice.",
                "columns": [{"name": "invoice_number", "description": "Invoice number"}],
                "filters": [{"Only unpaid invoices": None}],
                "derived_fields": [{"days_overdue": "April 15 2026 minus due date"}],
                "assumptions": [{"Invoice total calculated from invoice lines.": None}],
            },
        }
    )

    assert proposal.intent is not None
    assert proposal.intent.filters == ["Only unpaid invoices"]
    assert proposal.intent.derived_fields == ["days_overdue: April 15 2026 minus due date"]
    assert proposal.intent.assumptions == ["Invoice total calculated from invoice lines."]


def test_csv_intent_keeps_only_concrete_source_hints() -> None:
    proposal = CSVIntentProposal.model_validate(
        {
            "message": "Here is the CSV plan.",
            "intent": {
                "summary": "Student grades",
                "row_meaning": "One row per student.",
                "columns": [
                    {
                        "name": "Student Name",
                        "description": "Student name",
                        "source_hint": "students.name",
                    },
                    {
                        "name": "Average Grade",
                        "description": "Average of subject grades",
                        "source_hint": "grades.math + grades.english + grades.science",
                    },
                    {
                        "name": "Open Ticket Count",
                        "description": "Count of open tickets",
                        "source_hint": "support_tickets (count where status='open')",
                    },
                    {
                        "name": "Qualified Source",
                        "description": "Schema-qualified source",
                        "source_hint": "public.students.class_name",
                    },
                ],
            },
        }
    )

    assert proposal.intent is not None
    assert [column.source_hint for column in proposal.intent.columns] == [
        "students.name",
        None,
        None,
        "public.students.class_name",
    ]


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


def test_model_rate_limit_failure_gets_plain_user_message(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    session = create_session()

    with pytest.raises(RuntimeError, match="RateLimitError"):
        propose_csv_intent(
            session_id=session.id,
            model_provider=RaisingProvider(RuntimeError("litellm.RateLimitError: 429 daily quota exceeded")),
        )

    updated = load_session(session.id)
    assert updated.status == "failed"
    assert updated.last_error == (
        "Model provider could not respond because the provider reported a quota, credit, or rate-limit problem. "
        "Check your provider account or switch to a provider/model with available usage, then try again."
    )
    assert updated.debug_traces[0].details["error"] == "litellm.RateLimitError: 429 daily quota exceeded"


def test_model_schema_failure_gets_plain_user_message(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    ensure_context_files()
    session = create_session()

    with pytest.raises(RuntimeError, match="did not match schema"):
        propose_csv_intent(
            session_id=session.id,
            model_provider=RaisingProvider(RuntimeError("Model response did not match schema: message field required")),
        )

    updated = load_session(session.id)
    assert updated.status == "failed"
    assert updated.last_error == (
        "Model provider returned a response the app could not use. "
        "Try again, or switch to a different provider/model if it keeps happening."
    )
    assert updated.debug_traces[0].details["error"] == "Model response did not match schema: message field required"


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


def test_prepare_sql_rejects_wrong_output_column_count(tmp_path, monkeypatch) -> None:
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
    assert response.errors == ["SQL must select exactly 1 output column for the approved CSV plan."]
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
