from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    status: str = "ok"


class SchemaColumn(BaseModel):
    name: str = Field(min_length=1)
    data_type: str = Field(min_length=1)
    is_nullable: bool
    ordinal_position: int = Field(gt=0)
    default: str | None = None
    sample_values: list[str] = Field(default_factory=list)


class SchemaTable(BaseModel):
    schema_name: str = Field(min_length=1)
    table_name: str = Field(min_length=1)
    table_type: str = Field(min_length=1)
    columns: list[SchemaColumn] = Field(default_factory=list)
    primary_key: list[str] = Field(default_factory=list)


class SchemaRelationship(BaseModel):
    from_schema: str = Field(min_length=1)
    from_table: str = Field(min_length=1)
    from_columns: list[str] = Field(min_length=1)
    to_schema: str = Field(min_length=1)
    to_table: str = Field(min_length=1)
    to_columns: list[str] = Field(min_length=1)


class SchemaContext(BaseModel):
    tables: list[SchemaTable] = Field(default_factory=list)
    relationships: list[SchemaRelationship] = Field(default_factory=list)


class ContextPolicy(BaseModel):
    blocked_schemas: list[str] = Field(default_factory=list)
    blocked_tables: list[str] = Field(default_factory=list)
    blocked_columns: list[str] = Field(default_factory=list)
    blocked_functions: list[str] = Field(default_factory=lambda: ["pg_sleep", "set_config"])
    max_row_count: int = Field(default=100_000, gt=0, le=1_000_000)
    max_export_bytes: int = Field(default=50_000_000, gt=0)
    statement_timeout_ms: int = Field(default=30_000, gt=0)
    lock_timeout_ms: int = Field(default=5_000, gt=0)


class ContextDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    context: str
    schema_context: SchemaContext = Field(alias="schema")
    policy: ContextPolicy


class ContextUpdate(BaseModel):
    context: str = Field(min_length=1)
    policy: ContextPolicy


class ContextScanResponse(ContextDocument):
    table_count: int
    column_count: int


class SQLValidationRequest(BaseModel):
    sql: str = Field(min_length=1)


class SQLValidationResponse(BaseModel):
    valid: bool
    errors: list[str] = Field(default_factory=list)


class ExportCreateResponse(BaseModel):
    export_id: str
    row_count: int
    byte_count: int
    columns: list[str]
    download_url: str


class SessionCreateResponse(BaseModel):
    session: "ExportSession"


class SessionMessageRequest(BaseModel):
    message: ChatMessage


class SessionIntentApprovalRequest(BaseModel):
    intent: "CSVIntent"


class SessionExportRequest(BaseModel):
    sql: str = Field(min_length=1)


class CSVColumnIntent(BaseModel):
    name: str = Field(min_length=1)
    description: str = Field(min_length=1)
    source_hint: str | None = None


class CSVIntent(BaseModel):
    summary: str = Field(min_length=1)
    row_meaning: str = Field(min_length=1)
    columns: list[CSVColumnIntent] = Field(min_length=1)
    filters: list[str] = Field(default_factory=list)
    derived_fields: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    max_row_count: int = Field(default=1000, gt=0, le=100_000)


class SessionStatus(StrEnum):
    DRAFTING_INTENT = "drafting_intent"
    AWAITING_APPROVAL = "awaiting_approval"
    GENERATING_SQL = "generating_sql"
    VALIDATING_SQL = "validating_sql"
    EXPORTING = "exporting"
    COMPLETE = "complete"
    FAILED = "failed"


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant|system)$")
    content: str = Field(min_length=1)


class SessionDebugTrace(BaseModel):
    step: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    details: dict[str, Any] = Field(default_factory=dict)


class ExportSession(BaseModel):
    id: str
    status: SessionStatus = SessionStatus.DRAFTING_INTENT
    messages: list[ChatMessage] = Field(default_factory=list)
    approved_intent: CSVIntent | None = None
    export_id: str | None = None
    last_error: str | None = None
    debug_traces: list[SessionDebugTrace] = Field(default_factory=list)


class ModelConfig(BaseModel):
    model: str = Field(min_length=1)
    api_key: str | None = None
    base_url: str | None = None
    temperature: float = Field(default=0, ge=0, le=2)


class ModelProviderSettings(BaseModel):
    provider: str = Field(default="openrouter", pattern="^(openrouter|custom)$")
    model: str = Field(default="openrouter/openai/gpt-4o-mini", min_length=1)
    api_key: str | None = Field(default=None, min_length=1)
    base_url: str | None = Field(default=None, min_length=1)
    temperature: float = Field(default=0, ge=0, le=2)


class ModelProviderSettingsUpdate(BaseModel):
    provider: str = Field(default="openrouter", pattern="^(openrouter|custom)$")
    model: str = Field(default="openrouter/openai/gpt-4o-mini", min_length=1)
    api_key: str | None = Field(default=None)
    base_url: str | None = Field(default=None)
    temperature: float = Field(default=0, ge=0, le=2)


class ModelProviderSettingsResponse(BaseModel):
    provider: str
    model: str
    base_url: str | None = None
    temperature: float
    api_key_configured: bool


class SetupCheck(BaseModel):
    configured: bool
    ready: bool
    message: str | None = None


class SetupStatusResponse(BaseModel):
    ready: bool
    database: SetupCheck
    model_provider: SetupCheck
    context: SetupCheck
    next_action: str | None = None


class ModelMessage(BaseModel):
    role: str = Field(pattern="^(system|user|assistant)$")
    content: str = Field(min_length=1)


class ClarificationResponse(BaseModel):
    message: str = Field(min_length=1)
    questions: list[str] = Field(default_factory=list)


class CSVIntentProposal(BaseModel):
    message: str = Field(min_length=1)
    intent: CSVIntent | None = None
    questions: list[str] = Field(default_factory=list)


class SQLProposal(BaseModel):
    sql: str = Field(min_length=1)
    notes: list[str] = Field(default_factory=list)


class SQLRepairProposal(BaseModel):
    sql: str = Field(min_length=1)
    changes: list[str] = Field(default_factory=list)


class SQLValidationAttempt(BaseModel):
    sql: str = Field(min_length=1)
    valid: bool
    errors: list[str] = Field(default_factory=list)
    repair_changes: list[str] = Field(default_factory=list)


class SQLPreparationResponse(BaseModel):
    sql: str = Field(min_length=1)
    valid: bool
    errors: list[str] = Field(default_factory=list)
    attempts: list[SQLValidationAttempt] = Field(default_factory=list)
