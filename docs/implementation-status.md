# Implementation Status

Primary new-session handoff. Keep this file current as implementation changes. Durable architecture lives in `docs/architecture.md`; durable decisions live in `docs/decisions.md`; product vocabulary lives in `CONTEXT.md`.

## Current State

The app has a working local V0 vertical slice:

1. Scan a Postgres database.
2. Generate editable local context files.
3. Chat about the desired CSV.
4. Propose a user-facing CSV plan, or ask clarification when the request is too vague.
5. Require one user approval of the CSV plan.
6. Generate SQL through the configured model provider.
7. Validate SQL and attempt up to two bounded repairs.
8. Execute safely with read-only limits.
9. Write a formula-escaped CSV using approved CSV plan labels as headers.
10. End the chat-driven run and return a download link.

The normal ready-state UI is an Artifact Split layout: chat on the left, durable CSV plan/export state on the right, and SQL/debug details hidden in read-only Advanced. Once the user approves the CSV plan, the chat pane is hidden for that run and the centered artifact shows export progress. Once validation passes, the app creates the CSV automatically. Once an export is created, the completed artifact shows Download CSV and Start over actions. Settings handles database/context status, database connection testing, context rescans, model-provider setup, and export row limits.

Backend state is still filesystem JSON under `data/`. There is no worker, queue, scheduler, SQLite store, SSE/WebSocket progress, editable SQL, or multi-database support in V0.

## Recent Changes

- CSV-plan approval now ends the chat phase for a run in V0. The UI hides chat immediately, shows export progress in the artifact panel, creates the CSV automatically after validation passes, then offers Download CSV and Start over.
- Markdown docs were pruned: dated calibration reports and duplicated first-run guide content were removed from the active docs set. README is now the primary user setup guide; troubleshooting and development docs hold focused support material.
- Approved CSV plan labels now own final CSV headers. SQL/result validation checks explicit output count and order, and direct `source_hint` values are validated by output position when present. This supports custom labels and derived columns such as averages without requiring exact SQL alias casing.
- SQL validation allows derived/count expressions such as `COUNT(*)` while still rejecting `SELECT *`/`table.*`.
- CSV intent parsing keeps `source_hint` only for concrete `table.column` or `schema.table.column` references; formulas, counts, filters, and prose hints are treated as derived/unknown sources.
- SQL validation resolves real table aliases in selected expressions, so aggregate/date expressions can satisfy approved source hints while aliases named to spoof a source table are rejected.
- SQL table references are validated against the scanned schema context before execution. CTE names remain allowed.
- The model-facing intent prompt clarifies that greetings, capability questions, generic CSV requests, and vague/useful/everything/all-data requests should return clarification rather than a default CSV plan.
- ID-like fields, including foreign-key IDs, are excluded by model guidance unless the user explicitly asks for identifiers.
- Docs were cleaned so this file is the concise current handoff, `docs/agents/memory.md` is lightweight agent memory, and durable behavior lives in `docs/architecture.md` and `docs/decisions.md`.

## Implemented Surface

Backend modules:

- `app/main.py`: FastAPI routes.
- `app/models.py`: Pydantic API/domain/model-output models.
- `app/context_store.py`: local context, schema, and policy files.
- `app/schema_scan.py`: Postgres schema scan with table/column metadata, primary keys, foreign-key relationship hints, and conservative representative filter values.
- `app/sql_guard.py`: SQLGlot validation for read-only shape, limits, blocked objects, approved output count/order, source hints, and scanned-schema table references.
- `app/db.py`: read-only psycopg execution.
- `app/csv_writer.py`: CSV writing and formula-like cell escaping.
- `app/export_service.py`: validation, execution, limits, approved-header mapping, and CSV output.
- `app/session_store.py`: filesystem JSON session persistence.
- `app/model_provider.py`: LiteLLM SDK wrapper.
- `app/prompt_builder.py`: prompts for intent, SQL, and repair.
- `app/session_model_service.py`: approval-gated model orchestration.
- `app/provider_settings.py`: local model-provider settings.

Frontend:

- `src/`: React/Vite Artifact Split app using Prompt Kit chat primitives and shadcn components.
- `src/api-types.ts`: generated OpenAPI TypeScript types.
- `src/components/ui/` and `src/components/prompt-kit/`: shadcn UI components plus selected Prompt Kit components.

Tools:

- `tools/setup_local.sh`: Linux/WSL first-run helper.
- `tools/local_db.py`: persistent local Postgres test-cluster helper with demo, retail, finance, SaaS complex, and marketplace complex databases.
- `tools/dev.py`: starts backend and frontend together.
- `tools/check_setup.py`: reports database, provider, and context readiness.
- `tools/rescan_context.py`: regenerates schema context after changing `DATABASE_URL`.
- `tools/export_openapi.py`: exports OpenAPI schema.
- `tools/model_eval.py`: deterministic behavior evals for the model flow.
- `tools/calibration.py`: shared calibration harness.
- `tools/realistic_calibration.py`, `tools/finance_calibration.py`, `tools/complex_calibration.py`: disposable-schema real-provider calibration scripts.

## API Surface

```text
GET  /health
GET  /setup/status
POST /setup/bootstrap
POST /context/scan
GET  /context
PUT  /context
POST /settings/database/test
GET  /settings/model-provider
PUT  /settings/model-provider
POST /sessions
GET  /sessions/{session_id}
POST /sessions/{session_id}/messages
POST /sessions/{session_id}/propose-intent
POST /sessions/{session_id}/approve-intent
POST /sessions/{session_id}/prepare-sql
POST /sessions/{session_id}/export
GET  /exports/{export_id}/download
```

## Verification

Run the full local verification set:

```bash
.venv/bin/python -m pytest -q
.venv/bin/python -m compileall -q app tests tools
pnpm generate:api-types
.venv/bin/python tools/model_eval.py
pnpm test
pnpm build
```

Last documented backend/model-flow verification:

```text
.venv/bin/python -m pytest -q -> 145 passed
.venv/bin/python -m compileall -q app tests tools -> passed
.venv/bin/python tools/model_eval.py -> passed
```

Last documented frontend verification on 2026-05-03:

```text
pnpm test -> 10 passed
pnpm build -> passed
```

Local manual database helper verification on 2026-05-05:

```text
pnpm db:start -> initialized ~/.local/share/csv-chat-pg and started Postgres on 127.0.0.1:5432
pnpm db:seed -> seeded demo, retail, finance, SaaS complex, and marketplace complex databases
pnpm db:status -> listed all five csv_chat_* databases
.venv/bin/python -m compileall -q tools/local_db.py -> passed
```

## Calibration Notes

The current calibration tooling covers deterministic model-flow checks, persistent local Postgres test databases, and disposable realistic schemas for retail, finance, SaaS/product analytics, and marketplace ecommerce. Concrete requests to try live in `docs/example-requests.md`; observed run notes live in `docs/calibration-notes.md`.

Known remaining findings:

- Simple CTE-derived source hints, such as latest health snapshot CSM, can still fail without CTE lineage support.
- Free or experimental model endpoints can produce invalid JSON/schema mismatches or read timeouts even when simple probes pass.

## Provider Configuration

The root `.env` file is for backend database configuration:

```text
DATABASE_URL=postgresql://readonly:password@localhost:5432/appdb
```

For local manual testing, run `pnpm db:start`, `pnpm db:seed`, and `pnpm db:urls`, then copy one of the generated read-only `DATABASE_URL` values into `.env`. The persistent local test cluster lives under `~/.local/share/csv-chat-pg`; seeded databases are disposable and may be recreated with `pnpm db:seed`.

Model provider settings are saved through app Settings under:

```text
data/settings/model_provider.json
```

API responses report only whether an API key is configured. The app does not fall back to model-provider values in `.env`.

## Local Generated Data

Ignored runtime data may appear under:

```text
data/context/context.md
data/context/schema.json
data/context/policy.json
data/sessions/*.json
data/exports/*.csv
data/settings/model_provider.json
.env
```

Ignored generated artifacts such as `.openapi/`, `dist/`, `__pycache__/`, `.pytest_cache/`, and old session/export files can be deleted and regenerated.

## Next Work

1. Decide whether simple CTE source lineage is worth adding for V0.
2. Continue broader Artifact Split end-to-end testing and fresh-clone local onboarding testing.
3. Keep docs current at milestones, with `docs/implementation-status.md` as the concise handoff and durable details in architecture/decisions.
