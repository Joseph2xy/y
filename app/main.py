import os

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import Response

from app.context_store import ContextStoreError, load_context, save_scanned_schema, update_context
from app.database_identity import database_source_from_url, database_source_label, database_sources_match
from app.db import read_only_query_runner, test_database_connection
from app.db_diagnostics import explain_database_failure
from app.export_service import ExportError, create_export, export_path
from app.model_provider import LiteLLMModelProvider, ModelProviderError
from app.models import (
    CSVIntentProposal,
    ContextDocument,
    ContextScanResponse,
    ContextUpdate,
    DatabaseConnectionTestResponse,
    ExportSession,
    ExportCreateResponse,
    HealthResponse,
    ModelProviderSettingsResponse,
    ModelProviderSettingsUpdate,
    SavedCSVPlan,
    SavedCSVPlanCreateRequest,
    SavedCSVPlanListResponse,
    SavedCSVPlanUpdateRequest,
    SessionDebugTrace,
    SessionCreateResponse,
    SessionExportRequest,
    SessionIntentApprovalRequest,
    SessionMessageRequest,
    SetupCheck,
    SetupStatusResponse,
    SQLPreparationResponse,
)
from app.saved_csv_plan_store import (
    SavedCSVPlanStoreError,
    create_saved_csv_plan,
    delete_saved_csv_plan,
    list_saved_csv_plans,
    load_saved_csv_plan,
    mark_saved_csv_plan_run,
    update_saved_csv_plan,
)
from app.provider_settings import (
    ProviderSettingsError,
    load_provider_settings,
    model_config_from_settings,
    provider_settings_response,
    save_provider_settings,
)
from app.schema_scan import scan_postgres_schema
from app.session_model_service import (
    SessionModelError,
    StructuredModelProvider,
    prepare_sql,
    propose_csv_intent,
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

load_dotenv()

app = FastAPI(
    title="CSV Chat API",
    version="0.1.0",
    description="Generate validated CSV exports from a connected Postgres database.",
)


async def get_model_provider() -> StructuredModelProvider:
    try:
        return LiteLLMModelProvider(model_config_from_settings())
    except (ProviderSettingsError, ModelProviderError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def configured_database_url() -> str | None:
    return os.environ.get("DATABASE_URL")


def setup_status() -> SetupStatusResponse:
    database_url = configured_database_url()
    try:
        current_database = database_source_from_url(database_url) if database_url else None
    except Exception:
        current_database = None
    if not database_url:
        database = SetupCheck(
            configured=False,
            ready=False,
            message="Database connection is not configured.",
        )
    else:
        try:
            test_database_connection(database_url)
        except Exception as exc:
            database = SetupCheck(
                configured=True,
                ready=False,
                message=f"Database connection failed: {explain_database_failure(exc, database_url)}",
            )
        else:
            database = SetupCheck(configured=True, ready=True)

    try:
        model_config_from_settings()
    except ProviderSettingsError as exc:
        provider = SetupCheck(configured=False, ready=False, message=str(exc))
    except (ModelProviderError, ValueError) as exc:
        provider = SetupCheck(configured=True, ready=False, message=str(exc))
    else:
        provider = SetupCheck(configured=True, ready=True)

    context_source = None
    try:
        document = load_context()
    except ContextStoreError as exc:
        context = SetupCheck(configured=False, ready=False, message=str(exc))
    else:
        context_source = document.schema_context.source
        if database.ready and not database_sources_match(context_source, current_database):
            if context_source is None:
                message = "Context has no database scan metadata. Run a context rescan."
            else:
                message = (
                    "Context was scanned from "
                    f"{database_source_label(context_source)}, but .env points to "
                    f"{database_source_label(current_database)}. Run a context rescan."
                )
            context = SetupCheck(configured=True, ready=False, message=message)
        else:
            context = SetupCheck(configured=True, ready=True)

    next_action = None
    if not database.ready:
        next_action = "configure_database" if not database.configured else "connect_database"
    elif not provider.ready:
        next_action = "configure_model_provider"
    elif not context.ready:
        next_action = "rescan_context" if context.configured else "setup_context"

    return SetupStatusResponse(
        ready=database.ready and provider.ready and context.ready,
        database=database,
        model_provider=provider,
        context=context,
        current_database=current_database,
        context_source=context_source,
        next_action=next_action,
    )


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.get("/setup/status", response_model=SetupStatusResponse)
async def get_setup_status_endpoint() -> SetupStatusResponse:
    return setup_status()


@app.post("/setup/bootstrap", response_model=SetupStatusResponse)
async def bootstrap_setup_endpoint() -> SetupStatusResponse:
    status = setup_status()
    if not status.database.ready:
        raise HTTPException(status_code=400, detail=status.database.message)
    if not status.model_provider.ready:
        raise HTTPException(status_code=400, detail=status.model_provider.message)
    if status.context.ready:
        return status
    if status.context.configured:
        return status

    await scan_context()
    return setup_status()


@app.get("/settings/model-provider", response_model=ModelProviderSettingsResponse)
async def get_model_provider_settings_endpoint() -> ModelProviderSettingsResponse:
    try:
        return provider_settings_response(load_provider_settings())
    except ProviderSettingsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.put("/settings/model-provider", response_model=ModelProviderSettingsResponse)
async def put_model_provider_settings_endpoint(
    update: ModelProviderSettingsUpdate,
) -> ModelProviderSettingsResponse:
    try:
        return provider_settings_response(save_provider_settings(update))
    except ProviderSettingsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/settings/database/test", response_model=DatabaseConnectionTestResponse)
async def test_database_settings_endpoint() -> DatabaseConnectionTestResponse:
    database_url = configured_database_url()
    if not database_url:
        return DatabaseConnectionTestResponse(
            configured=False,
            ok=False,
            message="DATABASE_URL is not configured.",
        )

    try:
        current_database = database_source_from_url(database_url)
    except Exception:
        current_database = None

    try:
        test_database_connection(database_url)
    except Exception as exc:
        return DatabaseConnectionTestResponse(
            configured=True,
            ok=False,
            message=f"Database connection failed: {explain_database_failure(exc, database_url)}",
            current_database=current_database,
        )

    label = database_source_label(current_database) if current_database else "configured database"
    return DatabaseConnectionTestResponse(
        configured=True,
        ok=True,
        message=f"Connected to {label}.",
        current_database=current_database,
    )


@app.post("/context/scan", response_model=ContextScanResponse)
async def scan_context() -> ContextScanResponse:
    database_url = configured_database_url()
    if not database_url:
        raise HTTPException(status_code=400, detail="DATABASE_URL is not configured.")

    try:
        policy = load_context().policy
    except ContextStoreError:
        policy = None

    schema = scan_postgres_schema(database_url, policy=policy)
    schema.source = database_source_from_url(database_url)
    document = save_scanned_schema(schema)
    return ContextScanResponse(
        context=document.context,
        schema_context=document.schema_context,
        policy=document.policy,
        table_count=len(schema.tables),
        column_count=sum(len(table.columns) for table in schema.tables),
    )


@app.get("/context", response_model=ContextDocument)
async def get_context() -> ContextDocument:
    try:
        return load_context()
    except ContextStoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.put("/context", response_model=ContextDocument)
async def put_context(update: ContextUpdate) -> ContextDocument:
    try:
        return update_context(update)
    except ContextStoreError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/sessions", response_model=SessionCreateResponse)
async def create_session_endpoint() -> SessionCreateResponse:
    return SessionCreateResponse(session=create_session())


@app.post("/sessions/{session_id}/messages", response_model=ExportSession)
async def add_session_message_endpoint(session_id: str, request: SessionMessageRequest) -> ExportSession:
    try:
        return add_message(session_id, request.message)
    except SessionStoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/sessions/{session_id}/approve-intent", response_model=ExportSession)
async def approve_session_intent_endpoint(
    session_id: str,
    request: SessionIntentApprovalRequest,
) -> ExportSession:
    try:
        return approve_intent(session_id, request.intent)
    except SessionStoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/sessions/{session_id}/propose-intent", response_model=CSVIntentProposal)
async def propose_session_intent_endpoint(
    session_id: str,
    model_provider: StructuredModelProvider = Depends(get_model_provider),
) -> CSVIntentProposal:
    try:
        return propose_csv_intent(session_id=session_id, model_provider=model_provider)
    except (SessionStoreError, ContextStoreError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (SessionModelError, ModelProviderError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/sessions/{session_id}/prepare-sql", response_model=SQLPreparationResponse)
async def prepare_session_sql_endpoint(
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
async def create_session_export_endpoint(
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
            schema=document.schema_context,
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
        mark_export_complete(session_id, response.export_id, request.sql)
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


@app.get("/saved-csv-plans", response_model=SavedCSVPlanListResponse)
async def list_saved_csv_plans_endpoint() -> SavedCSVPlanListResponse:
    try:
        return SavedCSVPlanListResponse(plans=list_saved_csv_plans())
    except SavedCSVPlanStoreError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/saved-csv-plans", response_model=SavedCSVPlan)
async def create_saved_csv_plan_endpoint(request: SavedCSVPlanCreateRequest) -> SavedCSVPlan:
    try:
        session = load_session(request.session_id)
        if session.approved_intent is None:
            raise HTTPException(status_code=400, detail="CSV intent has not been approved.")
        if session.export_id is None:
            raise HTTPException(status_code=400, detail="CSV must be created before it can be saved.")
        if session.last_export_sql is None:
            raise HTTPException(status_code=400, detail="Completed CSV is missing the validated SQL.")

        document = load_context()
        return create_saved_csv_plan(
            name=request.name,
            description=request.description,
            intent=session.approved_intent,
            sql=session.last_export_sql,
            schema_fingerprint=document.schema_context.source.fingerprint
            if document.schema_context.source
            else None,
        )
    except HTTPException:
        raise
    except (SessionStoreError, ContextStoreError, SavedCSVPlanStoreError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/saved-csv-plans/{plan_id}", response_model=SavedCSVPlan)
async def get_saved_csv_plan_endpoint(plan_id: str) -> SavedCSVPlan:
    try:
        return load_saved_csv_plan(plan_id)
    except SavedCSVPlanStoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.put("/saved-csv-plans/{plan_id}", response_model=SavedCSVPlan)
async def update_saved_csv_plan_endpoint(
    plan_id: str,
    request: SavedCSVPlanUpdateRequest,
) -> SavedCSVPlan:
    try:
        return update_saved_csv_plan(plan_id, name=request.name, description=request.description)
    except SavedCSVPlanStoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/saved-csv-plans/{plan_id}/run", response_model=ExportCreateResponse)
async def run_saved_csv_plan_endpoint(plan_id: str) -> ExportCreateResponse:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise HTTPException(status_code=400, detail="DATABASE_URL is not configured.")

    try:
        plan = load_saved_csv_plan(plan_id)
        document = load_context()
        context_source = document.schema_context.source
        if plan.schema_fingerprint and (
            context_source is None or context_source.fingerprint != plan.schema_fingerprint
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "This saved CSV was created for a different database context. "
                    "Switch back to the original database or create a new saved CSV for the current database."
                ),
            )
        if plan.schema_fingerprint is None:
            raise HTTPException(
                status_code=409,
                detail=(
                    "This saved CSV has no database context metadata. "
                    "Create a new saved CSV after rescanning the current database."
                ),
            )
        runner = read_only_query_runner(
            database_url,
            statement_timeout_ms=document.policy.statement_timeout_ms,
            lock_timeout_ms=document.policy.lock_timeout_ms,
        )
        response = create_export(
            intent=plan.intent,
            sql=plan.sql,
            policy=document.policy,
            schema=document.schema_context,
            query_runner=runner,
        )
        mark_saved_csv_plan_run(plan_id, export_id=response.export_id)
        return response
    except HTTPException:
        raise
    except SavedCSVPlanStoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ContextStoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ExportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Saved CSV run failed.") from exc


@app.delete("/saved-csv-plans/{plan_id}", status_code=204)
async def delete_saved_csv_plan_endpoint(plan_id: str) -> Response:
    try:
        delete_saved_csv_plan(plan_id)
    except SavedCSVPlanStoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(status_code=204)


@app.get("/sessions/{session_id}", response_model=ExportSession)
async def get_session_endpoint(session_id: str) -> ExportSession:
    try:
        return load_session(session_id)
    except SessionStoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get(
    "/exports/{export_id}/download",
    response_class=Response,
    responses={200: {"content": {"text/csv": {}}}},
)
async def download_export(export_id: str) -> Response:
    try:
        path = export_path(export_id)
    except ExportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not path.exists():
        raise HTTPException(status_code=404, detail="Export not found.")

    return Response(
        content=path.read_bytes(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{export_id}.csv"'},
    )
