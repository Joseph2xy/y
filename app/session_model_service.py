from dataclasses import replace
from typing import Protocol, TypeVar

from pydantic import BaseModel

from app.context_store import load_context
from app.models import (
    CSVIntentProposal,
    ChatMessage,
    ExportSession,
    ModelMessage,
    SessionDebugTrace,
    SQLProposal,
    SQLPreparationResponse,
    SQLRepairProposal,
    SQLValidationAttempt,
    SessionStatus,
)
from app.prompt_builder import build_intent_prompt, build_sql_prompt, build_sql_repair_prompt
from app.session_store import load_session, save_session
from app.sql_guard import sql_policy_from_context, validate_sql


class SessionModelError(RuntimeError):
    pass


T = TypeVar("T", bound=BaseModel)


class StructuredModelProvider(Protocol):
    def generate_json(self, *, messages: list[ModelMessage], response_model: type[T]) -> T:
        pass


def propose_csv_intent(
    *,
    session_id: str,
    model_provider: StructuredModelProvider,
) -> CSVIntentProposal:
    session = load_session(session_id)
    context = load_context()

    prompt = build_intent_prompt(context=context, messages=session.messages)
    try:
        proposal = model_provider.generate_json(
            messages=prompt,
            response_model=CSVIntentProposal,
        )
    except Exception as exc:
        _mark_model_failure(session, exc, step="propose_intent", prompt=prompt)
        raise
    _append_model_trace(session, "propose_intent", prompt, proposal)

    session.messages.append(ChatMessage(role="assistant", content=proposal.message))
    session.approved_intent = None
    session.export_id = None
    session.status = SessionStatus.AWAITING_APPROVAL if proposal.intent is not None else SessionStatus.DRAFTING_INTENT
    session.last_error = None
    save_session(_validate_session(session))
    return proposal


def prepare_sql(
    *,
    session_id: str,
    model_provider: StructuredModelProvider,
    max_repair_attempts: int = 2,
) -> SQLPreparationResponse:
    if max_repair_attempts < 0:
        raise SessionModelError("Repair attempt count cannot be negative.")

    session = load_session(session_id)
    if session.approved_intent is None:
        raise SessionModelError("CSV intent must be approved before SQL generation.")

    context = load_context()
    session.status = SessionStatus.GENERATING_SQL
    save_session(session)

    prompt: list[ModelMessage] | None = None
    try:
        prompt = build_sql_prompt(
            context=context,
            messages=session.messages,
            approved_intent=session.approved_intent,
        )
        proposal = model_provider.generate_json(
            messages=prompt,
            response_model=SQLProposal,
        )
        _append_model_trace(session, "prepare_sql", prompt, proposal)
    except Exception as exc:
        _mark_model_failure(session, exc, step="prepare_sql", prompt=prompt)
        raise

    policy = sql_policy_from_context(context.policy)
    policy = replace(policy, max_limit=min(policy.max_limit, session.approved_intent.max_row_count))
    expected_columns = [column.name for column in session.approved_intent.columns]
    attempts: list[SQLValidationAttempt] = []
    current_sql = proposal.sql
    repair_changes: list[str] = []

    for attempt_number in range(max_repair_attempts + 1):
        result = validate_sql(
            current_sql,
            policy,
            expected_columns=expected_columns,
            intent=session.approved_intent,
        )
        _append_validation_trace(
            session,
            attempt_number=attempt_number + 1,
            sql=current_sql,
            valid=result.valid,
            errors=result.errors,
            repair_changes=repair_changes,
        )
        attempts.append(
            SQLValidationAttempt(
                sql=current_sql,
                valid=result.valid,
                errors=result.errors,
                repair_changes=repair_changes,
            )
        )

        if result.valid:
            session.status = SessionStatus.VALIDATING_SQL
            session.last_error = None
            save_session(session)
            return SQLPreparationResponse(
                sql=current_sql,
                valid=True,
                errors=[],
                attempts=attempts,
            )

        if attempt_number == max_repair_attempts:
            break

        repair_prompt: list[ModelMessage] | None = None
        try:
            repair_prompt = build_sql_repair_prompt(
                context=context,
                approved_intent=session.approved_intent,
                sql=current_sql,
                validation_errors=result.errors,
            )
            repair = model_provider.generate_json(
                messages=repair_prompt,
                response_model=SQLRepairProposal,
            )
            _append_model_trace(session, "repair_sql", repair_prompt, repair)
        except Exception as exc:
            _mark_model_failure(session, exc, step="repair_sql", prompt=repair_prompt)
            raise
        current_sql = repair.sql
        repair_changes = repair.changes

    final_errors = attempts[-1].errors if attempts else ["SQL was not generated."]
    session.status = SessionStatus.FAILED
    session.last_error = "SQL validation failed: " + "; ".join(final_errors)
    save_session(session)
    return SQLPreparationResponse(
        sql=current_sql,
        valid=False,
        errors=final_errors,
        attempts=attempts,
    )


def _validate_session(session: ExportSession) -> ExportSession:
    return ExportSession.model_validate(session)


def _mark_model_failure(
    session: ExportSession,
    exc: Exception,
    *,
    step: str,
    prompt: list[ModelMessage] | None,
) -> None:
    details: dict[str, object] = {"error": str(exc)}
    if prompt is not None:
        details["prompt"] = [message.model_dump(mode="json") for message in prompt]

    session.debug_traces.append(
        SessionDebugTrace(
            step=step,
            summary=f"Model call failed for {step}.",
            details=details,
        )
    )
    session.status = SessionStatus.FAILED
    session.last_error = _user_facing_model_error(exc)
    save_session(session)


def _user_facing_model_error(exc: Exception) -> str:
    raw_message = str(exc)
    normalized = raw_message.lower()
    if any(token in normalized for token in ("rate limit", "ratelimit", "quota", "insufficient credits", "429")):
        return (
            "Model provider could not respond because the provider reported a quota, credit, or rate-limit problem. "
            "Check your provider account or switch to a provider/model with available usage, then try again."
        )
    if "invalid json" in normalized or "did not match schema" in normalized:
        return (
            "Model provider returned a response the app could not use. "
            "Try again, or switch to a different provider/model if it keeps happening."
        )
    return f"Model provider failed: {raw_message}"


def _append_model_trace(
    session: ExportSession,
    step: str,
    prompt: list[ModelMessage],
    response: BaseModel,
) -> None:
    _append_trace(
        session,
        step=step,
        summary=f"Model call completed for {step}.",
        details={
            "prompt": [message.model_dump(mode="json") for message in prompt],
            "response_model": response.__class__.__name__,
            "response": response.model_dump(mode="json"),
        },
    )


def _append_validation_trace(
    session: ExportSession,
    *,
    attempt_number: int,
    sql: str,
    valid: bool,
    errors: list[str],
    repair_changes: list[str],
) -> None:
    _append_trace(
        session,
        step="validate_sql",
        summary=f"SQL validation attempt {attempt_number} {'passed' if valid else 'failed'}.",
        details={
            "attempt": attempt_number,
            "sql": sql,
            "valid": valid,
            "errors": errors,
            "repair_changes": repair_changes,
        },
    )


def _append_trace(session: ExportSession, *, step: str, summary: str, details: dict) -> None:
    session.debug_traces.append(
        SessionDebugTrace(
            step=step,
            summary=summary,
            details=details,
        )
    )
    save_session(session)
