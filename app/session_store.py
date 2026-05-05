import json
from pathlib import Path
from uuid import uuid4

from pydantic import ValidationError

from app.models import CSVIntent, ChatMessage, ExportSession, SessionDebugTrace, SessionStatus


SESSION_DIR = Path("data/sessions")


class SessionStoreError(RuntimeError):
    pass


def create_session(session_dir: Path = SESSION_DIR) -> ExportSession:
    session = ExportSession(id=uuid4().hex)
    save_session(session, session_dir)
    return session


def load_session(session_id: str, session_dir: Path = SESSION_DIR) -> ExportSession:
    path = _session_path(session_id, session_dir)
    if not path.exists():
        raise SessionStoreError("Session not found.")

    try:
        return ExportSession.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise SessionStoreError(f"Session file is invalid: {exc}") from exc


def save_session(session: ExportSession, session_dir: Path = SESSION_DIR) -> ExportSession:
    session_dir.mkdir(parents=True, exist_ok=True)
    _session_path(session.id, session_dir).write_text(
        json.dumps(session.model_dump(mode="json"), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return session


def add_message(session_id: str, message: ChatMessage, session_dir: Path = SESSION_DIR) -> ExportSession:
    session = load_session(session_id, session_dir)
    session.messages.append(message)
    if message.role == "user":
        session.approved_intent = None
        session.export_id = None
        session.last_export_sql = None
        session.status = SessionStatus.DRAFTING_INTENT
        session.last_error = None
        session.debug_traces = []
    return save_session(session, session_dir)


def approve_intent(session_id: str, intent: CSVIntent, session_dir: Path = SESSION_DIR) -> ExportSession:
    session = load_session(session_id, session_dir)
    session.approved_intent = intent
    session.status = SessionStatus.GENERATING_SQL
    session.last_error = None
    return save_session(session, session_dir)


def mark_export_complete(
    session_id: str,
    export_id: str,
    sql: str | None = None,
    session_dir: Path = SESSION_DIR,
) -> ExportSession:
    session = load_session(session_id, session_dir)
    session.export_id = export_id
    session.last_export_sql = sql
    session.status = SessionStatus.COMPLETE
    session.last_error = None
    return save_session(session, session_dir)


def mark_session_exporting(session_id: str, session_dir: Path = SESSION_DIR) -> ExportSession:
    session = load_session(session_id, session_dir)
    session.status = SessionStatus.EXPORTING
    session.last_error = None
    return save_session(session, session_dir)


def mark_session_failed(session_id: str, error: str, session_dir: Path = SESSION_DIR) -> ExportSession:
    session = load_session(session_id, session_dir)
    session.status = SessionStatus.FAILED
    session.last_error = error
    return save_session(session, session_dir)


def append_debug_trace(
    session_id: str,
    trace: SessionDebugTrace,
    session_dir: Path = SESSION_DIR,
) -> ExportSession:
    session = load_session(session_id, session_dir)
    session.debug_traces.append(trace)
    return save_session(session, session_dir)


def _session_path(session_id: str, session_dir: Path) -> Path:
    if not session_id or any(character in session_id for character in ("/", "\\", ".")):
        raise SessionStoreError("Invalid session id.")
    return session_dir / f"{session_id}.json"
