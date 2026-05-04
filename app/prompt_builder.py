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
                "Decide whether to ask concise clarification questions or propose a CSV intent.\n\n"
                "Return intent only when the latest user request is clear enough to define an approvable CSV plan. "
                "Clear enough means the user has specified both what one CSV row represents and at least one "
                "requested field, value, metric, filter, date range, or business condition.\n\n"
                "Leave intent null and return concise questions for greetings, vague requests, exploratory messages, "
                "blocked requests, or missing required choices. Do not infer a default CSV from schema or context when "
                "the user has not provided enough CSV details. If the user only says hello, asks what you can do, asks "
                "for a CSV without saying what should be in it, or asks for useful/everything/all data, intent must be null.\n\n"
                "If proposing a CSV intent, use only user-facing CSV language. CSV column names should be readable "
                "labels for the exported file, not raw database names when a clearer label exists. For example, use "
                "'Creation date' instead of 'created_at'. Keep source_hint on each column only when a specific direct "
                "database source column is known, using table.column. Use source_hint null for derived values, counts, "
                "formulas, filters, or uncertain sources, and describe those in description or derived_fields.\n\n"
                "Exclude ID-like fields by default, including primary keys, foreign-key IDs, and columns named 'id' "
                "or ending in '_id', unless the user explicitly asks for identifiers. If the user asks for all/everything "
                "but has not explicitly asked for IDs, do not include IDs.\n\n"
                "For max_row_count, use the policy max_row_count from the provided context as the default unless the "
                "user asks for a smaller row limit."
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
                "The SQL must include an integer LIMIT and must return the same number of selected columns, in the same order, as the CSV intent columns. "
                "The app will write the approved CSV column labels as the final headers, so SQL aliases may be simple database-friendly names. "
                "When a CSV column includes a source_hint, the selected expression in that same output position must use the hinted table.column. "
                "Do not use SELECT * or table.*. COUNT(*) is allowed for count columns. "
                "Avoid hiding source-hinted output columns behind CTE output aliases; keep the hinted table.column visible in the final selected expression when practical."
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
                "Do not broaden the data requested. "
                "Return the same number of selected columns, in the same order, as the CSV intent columns. "
                "The app will write the approved CSV column labels as the final headers, so SQL aliases may be simple database-friendly names. "
                "When a CSV column includes a source_hint, the selected expression in that same output position must use the hinted table.column. "
                "Do not use SELECT * or table.*. COUNT(*) is allowed for count columns. "
                "Avoid hiding source-hinted output columns behind CTE output aliases; keep the hinted table.column visible in the final selected expression when practical."
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
