from dataclasses import replace
from typing import Protocol, TypeVar

from pydantic import BaseModel

from app.context_store import load_context
from app.models import (
    CSVIntentProposal,
    ChatMessage,
    ClarificationResponse,
    ExportSession,
    ModelMessage,
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

    proposal = model_provider.generate_json(
        messages=build_intent_prompt(context=context, messages=session.messages),
        response_model=CSVIntentProposal,
    )

    session.messages.append(ChatMessage(role="assistant", content=proposal.message))
    session.approved_intent = None
    session.export_id = None
    session.status = SessionStatus.AWAITING_APPROVAL
    session.last_error = None
    save_session(_validate_session(session))
    return proposal


def ask_clarification(
    *,
    session_id: str,
    model_provider: StructuredModelProvider,
) -> ClarificationResponse:
    session = load_session(session_id)
    context = load_context()

    response = model_provider.generate_json(
        messages=build_intent_prompt(context=context, messages=session.messages),
        response_model=ClarificationResponse,
    )

    session.messages.append(ChatMessage(role="assistant", content=response.message))
    session.approved_intent = None
    session.export_id = None
    session.status = SessionStatus.DRAFTING_INTENT
    session.last_error = None
    save_session(_validate_session(session))
    return response


def propose_sql(
    *,
    session_id: str,
    model_provider: StructuredModelProvider,
) -> SQLProposal:
    session = load_session(session_id)
    if session.approved_intent is None:
        raise SessionModelError("CSV intent must be approved before SQL generation.")

    context = load_context()
    session.status = SessionStatus.GENERATING_SQL
    save_session(session)

    proposal = model_provider.generate_json(
        messages=build_sql_prompt(
            context=context,
            messages=session.messages,
            approved_intent=session.approved_intent,
        ),
        response_model=SQLProposal,
    )

    session.status = SessionStatus.VALIDATING_SQL
    session.last_error = None
    save_session(session)
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

    proposal = model_provider.generate_json(
        messages=build_sql_prompt(
            context=context,
            messages=session.messages,
            approved_intent=session.approved_intent,
        ),
        response_model=SQLProposal,
    )

    policy = sql_policy_from_context(context.policy)
    policy = replace(policy, max_limit=min(policy.max_limit, session.approved_intent.max_row_count))
    expected_columns = [column.name for column in session.approved_intent.columns]
    attempts: list[SQLValidationAttempt] = []
    current_sql = proposal.sql
    repair_changes: list[str] = []

    for attempt_number in range(max_repair_attempts + 1):
        result = validate_sql(current_sql, policy, expected_columns=expected_columns)
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

        repair = model_provider.generate_json(
            messages=build_sql_repair_prompt(
                context=context,
                approved_intent=session.approved_intent,
                sql=current_sql,
                validation_errors=result.errors,
            ),
            response_model=SQLRepairProposal,
        )
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
