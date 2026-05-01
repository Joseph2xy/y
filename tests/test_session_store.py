import pytest

from app.models import CSVColumnIntent, CSVIntent, ChatMessage, SessionStatus
from app.session_store import (
    SessionStoreError,
    add_message,
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


def test_add_message_moves_session_to_awaiting_approval(tmp_path) -> None:
    session = create_session(tmp_path)

    updated = add_message(session.id, ChatMessage(role="user", content="Export customers"), tmp_path)

    assert updated.status == SessionStatus.AWAITING_APPROVAL
    assert updated.messages[0].content == "Export customers"


def test_approve_intent_stores_intent(tmp_path) -> None:
    session = create_session(tmp_path)

    updated = approve_intent(session.id, csv_intent(), tmp_path)

    assert updated.status == SessionStatus.GENERATING_SQL
    assert updated.approved_intent is not None
    assert updated.approved_intent.columns[0].name == "email"


def test_mark_export_complete(tmp_path) -> None:
    session = create_session(tmp_path)

    updated = mark_export_complete(session.id, "export123", tmp_path)

    assert updated.status == SessionStatus.COMPLETE
    assert updated.export_id == "export123"


def test_mark_session_failed(tmp_path) -> None:
    session = create_session(tmp_path)

    updated = mark_session_failed(session.id, "bad sql", tmp_path)

    assert updated.status == SessionStatus.FAILED
    assert updated.last_error == "bad sql"


def test_load_session_rejects_invalid_id(tmp_path) -> None:
    with pytest.raises(SessionStoreError):
        load_session("../secret", tmp_path)
