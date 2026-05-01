# Implementation Status

This file is the primary handoff context for starting a new implementation session.

Keep this file current as work progresses. The other Markdown files are steadier reference docs and should be updated only when a milestone or durable decision changes them.

## What Exists

The project currently has a tested FastAPI backend scaffold.

Implemented modules:

- `app/main.py`: FastAPI routes.
- `app/models.py`: Pydantic request/response/domain models.
- `app/context_store.py`: filesystem context file management.
- `app/schema_scan.py`: Postgres metadata scan via `information_schema`.
- `app/sql_guard.py`: SQLGlot-based validation.
- `app/db.py`: read-only psycopg query execution helper.
- `app/csv_writer.py`: CSV writing and formula-like cell escaping.
- `app/export_service.py`: validate SQL, run query, enforce limits, write CSV.
- `app/session_store.py`: filesystem JSON session persistence.

Implemented endpoints:

```text
GET  /health
POST /context/scan
GET  /context
PUT  /context
POST /sql/validate
POST /sessions
GET  /sessions/{session_id}
POST /sessions/{session_id}/messages
POST /sessions/{session_id}/approve-intent
POST /sessions/{session_id}/export
POST /exports
GET  /exports/{export_id}/download
```

Current verification:

```bash
.venv/bin/python -m pytest -q
.venv/bin/python -m compileall -q app tests
```

Last known result: `42 passed`.

## Current Flow

The backend can already support this non-model debug flow:

1. Configure `DATABASE_URL` for a read-only Postgres user.
2. Call `POST /context/scan` to write schema metadata.
3. Optionally edit `PUT /context` to update context and policy.
4. Call `POST /sessions`.
5. Call `POST /sessions/{session_id}/messages`.
6. Call `POST /sessions/{session_id}/approve-intent` with a CSV intent.
7. Call `POST /sessions/{session_id}/export` with SQL.
8. Download the generated CSV from `GET /exports/{export_id}/download`.

The model is not connected yet. SQL can currently be submitted through debug/API calls only.

## Safety Already In Place

- The model layer does not exist yet and therefore has no database access.
- SQL validation happens before export execution.
- SQL must parse as one Postgres statement.
- SQL must be `SELECT`.
- SQL must include an integer `LIMIT`.
- Policy can block schemas, tables, columns, and functions.
- Default blocked function includes `pg_sleep`.
- Query execution uses psycopg with read-only transaction and local timeouts.
- Export enforces row and byte limits.
- Export checks that result rows contain the approved CSV intent columns.
- CSV writer escapes formula-like string cells starting with `=`, `+`, `-`, `@`, tab, or carriage return.
- Final CSV is served by export id only.

## Important Local State

During smoke testing, these files were created:

```text
data/context/context.md
data/context/schema.json
data/context/policy.json
data/sessions/*.json
```

The current `data/context/policy.json` may contain test values such as `private_notes` and `max_row_count: 10`. Treat these as local smoke-test data, not product defaults.

The directory is not currently a Git repository.

## Next Step

Build the model harness.

Recommended scope:

1. Add a `model_provider.py` module around LiteLLM SDK.
2. Add Pydantic models for model outputs:
   - clarification response.
   - CSV intent proposal.
   - SQL proposal.
   - SQL repair proposal.
3. Add prompt builders that include:
   - `context.md`.
   - `schema.json`.
   - `policy.json`.
   - conversation messages.
   - the approved CSV intent when generating SQL.
4. Add endpoints or session service functions for:
   - generating the next assistant message or CSV intent proposal.
   - generating SQL only after `approved_intent` exists.
   - attempting limited repair after structured SQL validation errors.
5. Keep raw rows and final CSV contents out of model inputs by default.

Do not add a worker, queue, scheduling, frontend dashboard shell, LangChain, or LlamaIndex for this step.

## Left For V0

- LiteLLM provider configuration.
- Model prompt construction.
- Pydantic parsing of model outputs.
- Limited SQL repair loop.
- SSE or polling decision for progress/events.
- React/Vite frontend.
- OpenAPI-generated frontend types.
- Integration test against a real or containerized Postgres database.
- Better audit/debug trace storage.
- Decision on export expiry.
- Decision on whether SQL can be shown or edited in Advanced mode.
