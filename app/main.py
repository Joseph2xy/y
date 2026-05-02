import os

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse

from app.context_store import ContextStoreError, load_context, save_scanned_schema, update_context
from app.db import read_only_query_runner
from app.export_service import ExportError, create_export, export_path
from app.model_provider import LiteLLMModelProvider, ModelProviderError
from app.models import (
    CSVIntentProposal,
    ClarificationResponse,
    ContextDocument,
    ContextScanResponse,
    ContextUpdate,
    ExportSession,
    ExportCreateResponse,
    HealthResponse,
    ModelProviderSettingsResponse,
    ModelProviderSettingsUpdate,
    SessionDebugTrace,
    SessionCreateResponse,
    SessionExportRequest,
    SessionIntentApprovalRequest,
    SessionMessageRequest,
    SQLProposal,
    SQLPreparationResponse,
    SQLValidationRequest,
    SQLValidationResponse,
)
from app.provider_settings import (
    ProviderSettingsError,
    load_provider_settings,
    model_config_from_settings_or_env,
    provider_settings_response,
    save_provider_settings,
)
from app.schema_scan import scan_postgres_schema
from app.session_model_service import (
    SessionModelError,
    StructuredModelProvider,
    ask_clarification,
    prepare_sql,
    propose_csv_intent,
    propose_sql,
)
from app.session_store import (
    SessionStoreError,
    add_message,
    append_debug_trace,
    approve_intent,
    create_session,
    load_session,
    mark_export_complete,
    mark_session_exporting,
    mark_session_failed,
)
from app.sql_guard import sql_policy_from_context, validate_sql

app = FastAPI(
    title="CSV Chat API",
    version="0.1.0",
    description="Generate validated CSV exports from a connected Postgres database.",
)


def get_model_provider() -> StructuredModelProvider:
    try:
        return LiteLLMModelProvider(model_config_from_settings_or_env(os.environ))
    except (ProviderSettingsError, ModelProviderError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.get("/settings/model-provider", response_model=ModelProviderSettingsResponse)
def get_model_provider_settings_endpoint() -> ModelProviderSettingsResponse:
    try:
        return provider_settings_response(load_provider_settings())
    except ProviderSettingsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.put("/settings/model-provider", response_model=ModelProviderSettingsResponse)
def put_model_provider_settings_endpoint(
    update: ModelProviderSettingsUpdate,
) -> ModelProviderSettingsResponse:
    try:
        return provider_settings_response(save_provider_settings(update))
    except ProviderSettingsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/context/scan", response_model=ContextScanResponse)
def scan_context() -> ContextScanResponse:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise HTTPException(status_code=400, detail="DATABASE_URL is not configured.")

    try:
        policy = load_context().policy
    except ContextStoreError:
        policy = None

    schema = scan_postgres_schema(database_url, policy=policy)
    document = save_scanned_schema(schema)
    return ContextScanResponse(
        context=document.context,
        schema_context=document.schema_context,
        policy=document.policy,
        table_count=len(schema.tables),
        column_count=sum(len(table.columns) for table in schema.tables),
    )


@app.get("/context", response_model=ContextDocument)
def get_context() -> ContextDocument:
    try:
        return load_context()
    except ContextStoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.put("/context", response_model=ContextDocument)
def put_context(update: ContextUpdate) -> ContextDocument:
    try:
        return update_context(update)
    except ContextStoreError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/sql/validate", response_model=SQLValidationResponse)
def validate_sql_endpoint(request: SQLValidationRequest) -> SQLValidationResponse:
    try:
        document = load_context()
    except ContextStoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    result = validate_sql(request.sql, sql_policy_from_context(document.policy))
    return SQLValidationResponse(valid=result.valid, errors=result.errors)


@app.post("/sessions", response_model=SessionCreateResponse)
def create_session_endpoint() -> SessionCreateResponse:
    return SessionCreateResponse(session=create_session())


@app.post("/sessions/{session_id}/messages", response_model=ExportSession)
def add_session_message_endpoint(session_id: str, request: SessionMessageRequest) -> ExportSession:
    try:
        return add_message(session_id, request.message)
    except SessionStoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/sessions/{session_id}/approve-intent", response_model=ExportSession)
def approve_session_intent_endpoint(
    session_id: str,
    request: SessionIntentApprovalRequest,
) -> ExportSession:
    try:
        return approve_intent(session_id, request.intent)
    except SessionStoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/sessions/{session_id}/clarify", response_model=ClarificationResponse)
def clarify_session_endpoint(
    session_id: str,
    model_provider: StructuredModelProvider = Depends(get_model_provider),
) -> ClarificationResponse:
    try:
        return ask_clarification(session_id=session_id, model_provider=model_provider)
    except (SessionStoreError, ContextStoreError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (SessionModelError, ModelProviderError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/sessions/{session_id}/propose-intent", response_model=CSVIntentProposal)
def propose_session_intent_endpoint(
    session_id: str,
    model_provider: StructuredModelProvider = Depends(get_model_provider),
) -> CSVIntentProposal:
    try:
        return propose_csv_intent(session_id=session_id, model_provider=model_provider)
    except (SessionStoreError, ContextStoreError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (SessionModelError, ModelProviderError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/sessions/{session_id}/propose-sql", response_model=SQLProposal)
def propose_session_sql_endpoint(
    session_id: str,
    model_provider: StructuredModelProvider = Depends(get_model_provider),
) -> SQLProposal:
    try:
        return propose_sql(session_id=session_id, model_provider=model_provider)
    except (SessionStoreError, ContextStoreError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (SessionModelError, ModelProviderError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/sessions/{session_id}/prepare-sql", response_model=SQLPreparationResponse)
def prepare_session_sql_endpoint(
    session_id: str,
    model_provider: StructuredModelProvider = Depends(get_model_provider),
) -> SQLPreparationResponse:
    try:
        return prepare_sql(session_id=session_id, model_provider=model_provider)
    except (SessionStoreError, ContextStoreError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (SessionModelError, ModelProviderError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/sessions/{session_id}/export", response_model=ExportCreateResponse)
def create_session_export_endpoint(
    session_id: str,
    request: SessionExportRequest,
) -> ExportCreateResponse:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise HTTPException(status_code=400, detail="DATABASE_URL is not configured.")

    try:
        session = load_session(session_id)
        if session.approved_intent is None:
            raise HTTPException(status_code=400, detail="CSV intent has not been approved.")

        document = load_context()
        runner = read_only_query_runner(
            database_url,
            statement_timeout_ms=document.policy.statement_timeout_ms,
            lock_timeout_ms=document.policy.lock_timeout_ms,
        )
        append_debug_trace(
            session_id,
            SessionDebugTrace(
                step="export",
                summary="Export execution started.",
                details={
                    "sql": request.sql,
                    "expected_columns": [column.name for column in session.approved_intent.columns],
                    "max_row_count": min(session.approved_intent.max_row_count, document.policy.max_row_count),
                    "max_export_bytes": document.policy.max_export_bytes,
                },
            ),
        )
        mark_session_exporting(session_id)
        response = create_export(
            intent=session.approved_intent,
            sql=request.sql,
            policy=document.policy,
            query_runner=runner,
        )
        append_debug_trace(
            session_id,
            SessionDebugTrace(
                step="export",
                summary="Export execution completed.",
                details=response.model_dump(mode="json"),
            ),
        )
        mark_export_complete(session_id, response.export_id)
        return response
    except HTTPException:
        raise
    except SessionStoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ContextStoreError as exc:
        mark_session_failed(session_id, str(exc))
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ExportError as exc:
        append_debug_trace(
            session_id,
            SessionDebugTrace(
                step="export",
                summary="Export execution failed.",
                details={"error": str(exc)},
            ),
        )
        mark_session_failed(session_id, str(exc))
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        append_debug_trace(
            session_id,
            SessionDebugTrace(
                step="export",
                summary="Export execution failed unexpectedly.",
                details={"error": str(exc)},
            ),
        )
        mark_session_failed(session_id, str(exc))
        raise HTTPException(status_code=500, detail="Export failed.") from exc


@app.get("/sessions/{session_id}", response_model=ExportSession)
def get_session_endpoint(session_id: str) -> ExportSession:
    try:
        return load_session(session_id)
    except SessionStoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get(
    "/exports/{export_id}/download",
    response_class=FileResponse,
    responses={200: {"content": {"text/csv": {}}}},
)
def download_export(export_id: str) -> FileResponse:
    try:
        path = export_path(export_id)
    except ExportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not path.exists():
        raise HTTPException(status_code=404, detail="Export not found.")

    return FileResponse(path, media_type="text/csv", filename=f"{export_id}.csv")
