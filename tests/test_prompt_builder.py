from app.models import (
    CSVColumnIntent,
    CSVIntent,
    ChatMessage,
    ContextDocument,
    ContextPolicy,
    SchemaColumn,
    SchemaContext,
    SchemaTable,
    SQLProposal,
)
from app.database_identity import database_source_from_url
from app.prompt_builder import build_intent_prompt, build_sql_prompt, response_format_for


def context_document() -> ContextDocument:
    return ContextDocument(
        context="# Business Context\nCustomers are people who buy products.\n",
        schema_context=SchemaContext(
            tables=[
                SchemaTable(
                    schema_name="public",
                    table_name="customers",
                    table_type="BASE TABLE",
                    columns=[
                        SchemaColumn(
                            name="email",
                            data_type="text",
                            is_nullable=False,
                            ordinal_position=1,
                        )
                    ],
                )
            ]
        ),
        policy=ContextPolicy(blocked_columns=["customers.password_hash"], max_row_count=500),
    )


def intent() -> CSVIntent:
    return CSVIntent(
        summary="Customer emails",
        row_meaning="One row per customer",
        columns=[
            CSVColumnIntent(
                name="email",
                description="Email address",
                source_hint="customers.email",
            )
        ],
        max_row_count=100,
    )


def test_build_intent_prompt_includes_context_schema_policy_and_messages() -> None:
    prompt = build_intent_prompt(
        context=context_document(),
        messages=[ChatMessage(role="user", content="I need customer emails.")],
    )
    content = "\n".join(message.content for message in prompt)

    assert "Customers are people who buy products." in content
    assert "customers" in content
    assert "customers.password_hash" in content
    assert "I need customer emails." in content
    assert "CSV intent" in content
    assert "what one CSV row represents" in content
    assert "Do not infer a default CSV from schema or context" in content
    assert "asks what you can do" in content
    assert "intent must be null" in content
    assert "asks for a CSV without saying what should be in it" in content
    assert "useful/everything/all data" in content
    assert "Exclude ID-like fields by default" in content
    assert "foreign-key IDs" in content
    assert "Creation date" in content
    assert "created_at" in content
    assert "source_hint" in content
    assert "table.column" in content
    assert "Use source_hint null for derived values" in content
    assert "policy max_row_count" in content
    assert "smaller row limit" in content


def test_build_sql_prompt_includes_approved_intent_and_sql_requirements() -> None:
    prompt = build_sql_prompt(
        context=context_document(),
        messages=[ChatMessage(role="user", content="I need customer emails.")],
        approved_intent=intent(),
    )
    content = "\n".join(message.content for message in prompt)

    assert "Approved CSV intent" in content
    assert "Customer emails" in content
    assert "integer LIMIT" in content
    assert "names exactly matching" in content
    assert "source_hint" in content
    assert "table.column" in content
    assert "COUNT(*) is allowed" in content
    assert "Avoid hiding source-hinted output columns behind CTE output aliases" in content


def test_response_format_for_includes_model_schema() -> None:
    format_prompt = response_format_for(SQLProposal)

    assert "Return JSON matching this schema" in format_prompt
    assert "sql" in format_prompt
    assert "notes" in format_prompt


def test_response_format_for_csv_intent_proposal_reinforces_clarification_boundary() -> None:
    from app.models import CSVIntentProposal

    format_prompt = response_format_for(CSVIntentProposal)

    assert "clear enough to define an approvable CSV plan" in format_prompt
    assert "Do not infer a default CSV from schema or context" in format_prompt
    assert "greetings" in format_prompt
    assert "exploratory messages" in format_prompt
    assert "what one row represents" in format_prompt
    assert "business condition" in format_prompt
    assert "Exclude ID-like fields by default" in format_prompt
    assert "readable labels" in format_prompt
    assert "policy max_row_count" in format_prompt


def test_build_prompt_serializes_schema_source_metadata() -> None:
    document = context_document()
    document.schema_context.source = database_source_from_url("postgresql://readonly:secret@localhost:5432/appdb")

    prompt = build_intent_prompt(
        context=document,
        messages=[ChatMessage(role="user", content="I need customer emails.")],
    )
    content = "\n".join(message.content for message in prompt)

    assert "scanned_at" in content
    assert "appdb" in content
