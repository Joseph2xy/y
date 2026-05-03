import json
from typing import Any

from pydantic import BaseModel

from app.models import CSVIntent, ChatMessage, ContextDocument, ModelMessage


SYSTEM_PROMPT = """You help generate safe CSV exports from a connected Postgres database.

You may inspect provided schema and context, ask clarifying questions, propose a user-facing CSV intent, and propose SQL.
You must not ask for or expose database credentials.
You must not claim that SQL has run.
Use plain user-facing language for CSV intent work.
Return only JSON matching the requested schema."""


def build_intent_prompt(
    *,
    context: ContextDocument,
    messages: list[ChatMessage],
) -> list[ModelMessage]:
    return [
        _system_message(),
        _context_message(context),
        ModelMessage(
            role="user",
            content=(
                "Conversation so far:\n"
                f"{_dump([message.model_dump() for message in messages])}\n\n"
                "Decide whether to ask a concise clarification question or propose a CSV intent. "
                "If the request is clear enough to define the CSV, return a CSV intent. "
                "If the request is too vague, blocked, or missing required choices, leave intent null and return concise questions. "
                "If proposing a CSV intent, use only user-facing CSV language."
            ),
        ),
    ]


def build_sql_prompt(
    *,
    context: ContextDocument,
    messages: list[ChatMessage],
    approved_intent: CSVIntent,
) -> list[ModelMessage]:
    return [
        _system_message(),
        _context_message(context),
        ModelMessage(
            role="user",
            content=(
                "Conversation so far:\n"
                f"{_dump([message.model_dump() for message in messages])}\n\n"
                "Approved CSV intent:\n"
                f"{_dump(approved_intent.model_dump())}\n\n"
                "Propose one Postgres SELECT statement for the approved CSV intent. "
                "The SQL must include an integer LIMIT and must return columns with names exactly matching the CSV intent."
            ),
        ),
    ]


def build_sql_repair_prompt(
    *,
    context: ContextDocument,
    approved_intent: CSVIntent,
    sql: str,
    validation_errors: list[str],
) -> list[ModelMessage]:
    return [
        _system_message(),
        _context_message(context),
        ModelMessage(
            role="user",
            content=(
                "Approved CSV intent:\n"
                f"{_dump(approved_intent.model_dump())}\n\n"
                "SQL that failed validation:\n"
                f"{sql}\n\n"
                "Validation errors:\n"
                f"{_dump(validation_errors)}\n\n"
                "Return repaired SQL only for the same approved CSV intent. "
                "Do not broaden the data requested."
            ),
        ),
    ]


def response_format_for(model: type[BaseModel]) -> str:
    return (
        "Return JSON matching this schema. Do not include Markdown fences or extra text.\n"
        f"{_dump(model.model_json_schema())}"
    )


def _system_message() -> ModelMessage:
    return ModelMessage(role="system", content=SYSTEM_PROMPT)


def _context_message(context: ContextDocument) -> ModelMessage:
    return ModelMessage(
        role="user",
        content=(
            "Database context markdown:\n"
            f"{context.context}\n\n"
            "Schema JSON:\n"
            f"{_dump(context.schema_context.model_dump(mode='json'))}\n\n"
            "Policy JSON:\n"
            f"{_dump(context.policy.model_dump(mode='json'))}"
        ),
    )


def _dump(value: Any) -> str:
    return json.dumps(value, indent=2, sort_keys=True)
