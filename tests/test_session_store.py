import pytest

from app.models import CSVColumnIntent, CSVIntent, ChatMessage, SessionDebugTrace, SessionStatus
from app.session_store import (
    SessionStoreError,
    add_message,
    append_debug_trace,
    approve_intent,
    create_session,
    load_session,
    mark_export_complete,
    mark_session_failed,
)


def csv_intent() -> CSVIntent:
    return CSVIntent(
        summary="Customer export",
        row_meaning="One row per customer",
        columns=[CSVColumnIntent(name="email", description="Email")],
    )


def test_create_and_load_session(tmp_path) -> None:
    session = create_session(tmp_path)

    loaded = load_session(session.id, tmp_path)

    assert loaded.id == session.id
    assert loaded.status == SessionStatus.DRAFTING_INTENT


def test_add_message_keeps_session_drafting_intent(tmp_path) -> None:
    session = create_session(tmp_path)

    updated = add_message(session.id, ChatMessage(role="user", content="Export customers"), tmp_path)

    assert updated.status == SessionStatus.DRAFTING_INTENT
    assert updated.messages[0].content == "Export customers"


def test_add_user_message_clears_stale_approval(tmp_path) -> None:
    session = create_session(tmp_path)
    approve_intent(session.id, csv_intent(), tmp_path)
    append_debug_trace(
        session.id,
        SessionDebugTrace(step="validate_sql", summary="Old trace", details={"sql": "select 1"}),
        tmp_path,
    )

    updated = add_message(session.id, ChatMessage(role="user", content="Actually export orders"), tmp_path)

    assert updated.status == SessionStatus.DRAFTING_INTENT
    assert updated.approved_intent is None
    assert updated.export_id is None
    assert updated.debug_traces == []


def test_append_debug_trace_persists_trace(tmp_path) -> None:
    session = create_session(tmp_path)

    append_debug_trace(
        session.id,
        SessionDebugTrace(step="validate_sql", summary="Validation failed.", details={"errors": ["Missing LIMIT"]}),
        tmp_path,
    )

    loaded = load_session(session.id, tmp_path)
    assert loaded.debug_traces[0].step == "validate_sql"
    assert loaded.debug_traces[0].details == {"errors": ["Missing LIMIT"]}


def test_approve_intent_stores_intent(tmp_path) -> None:
    session = create_session(tmp_path)

    updated = approve_intent(session.id, csv_intent(), tmp_path)

    assert updated.status == SessionStatus.GENERATING_SQL
    assert updated.approved_intent is not None
    assert updated.approved_intent.columns[0].name == "email"


def test_mark_export_complete(tmp_path) -> None:
    session = create_session(tmp_path)

    updated = mark_export_complete(session.id, "export123", "select email from customers limit 10", tmp_path)

    assert updated.status == SessionStatus.COMPLETE
    assert updated.export_id == "export123"
    assert updated.last_export_sql == "select email from customers limit 10"


def test_mark_session_failed(tmp_path) -> None:
    session = create_session(tmp_path)

    updated = mark_session_failed(session.id, "bad sql", tmp_path)

    assert updated.status == SessionStatus.FAILED
    assert updated.last_error == "bad sql"


def test_load_session_rejects_invalid_id(tmp_path) -> None:
    with pytest.raises(SessionStoreError):
        load_session("../secret", tmp_path)
