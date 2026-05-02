# Implementation Status

Primary new-session handoff. Keep this current as implementation changes. Durable product decisions live in `docs/decisions.md`; product vocabulary lives in `CONTEXT.md`.

## Current State

The app has a working local V0 vertical slice:

1. Scan a Postgres database.
2. Generate local context files.
3. Chat about the desired CSV.
4. Propose a user-facing CSV plan.
5. Require one user approval.
6. Generate SQL through the model provider.
7. Validate SQL and attempt up to two bounded repairs.
8. Execute safely with read-only limits.
9. Write a formula-escaped CSV.
10. Return a download link.

The first real local Postgres demo succeeded on 2026-05-02 using the deterministic mock OpenAI-compatible model server and downloaded a CSV with the expected 3 active 2026 customer rows.

A real OpenRouter provider check succeeded on 2026-05-02 using `.env` provider settings. The app flow proposed a CSV plan, prepared valid SQL in one attempt, exported 3 rows, and returned a download URL.

A four-scenario real-provider calibration pass on 2026-05-02 covered a filtered customer export, an aggregate by account plan, a joined Starter-plan export, and a vague request. The three concrete requests exported successfully with valid SQL on the first attempt. The vague request initially exposed a schema/UX gap where clarification-shaped model output surfaced as a validation error; the app now allows `POST /sessions/{session_id}/propose-intent` to return a clarification message/questions with no CSV intent and keeps the session in drafting state.

A realistic retail/support schema calibration pass on 2026-05-02 used a seeded five-table Postgres schema with customers, products, orders, order items, and support tickets. Four concrete requests exported successfully with first-attempt valid SQL: shipped Q1 orders, March revenue by product category, open high-priority support tickets, and active West-region accessory buyers. A vague sales request returned clarification questions instead of a CSV intent. No prompt/context/code tuning was needed from this pass.

Local development hardening now includes `pnpm dev:app` to run the FastAPI backend and Vite frontend together, plus `pnpm check:setup` to report database, model-provider, and context readiness without opening the browser.

A finance/invoicing schema calibration pass on 2026-05-02 used a seeded five-table Postgres schema with customers, invoices, invoice lines, payments, and refunds. Three concrete requests exported successfully with first-attempt valid SQL: unpaid invoices, recognized revenue by month, and March payments. The overdue-invoices request produced a reasonable CSV plan after model-output list coercion was added, but SQL preparation was blocked by the configured OpenRouter free-model daily rate limit. The vague finance request was also blocked by the same provider rate limit before clarification could be evaluated.

Repo hygiene cleanup on 2026-05-02 removed ignored build/cache/runtime artifacts from the working tree and deleted stale docs that duplicated current handoff material (`docs/agents/domain.md`, `docs/dependency-audit.md`). The active docs are now README, AGENTS, CONTEXT, architecture, decisions, implementation status, example requests, the editable Excalidraw flow diagram, and agent memory.

## Implemented

Backend:

- `app/main.py`: FastAPI routes.
- `app/models.py`: Pydantic API/domain/model-output models.
- `app/context_store.py`: local context, schema, and policy files.
- `app/schema_scan.py`: Postgres schema scan with table/column metadata, primary keys, foreign-key relationship hints, and conservative representative values for safe-looking filter fields.
- `app/sql_guard.py`: SQLGlot validation.
- `app/db.py`: read-only psycopg execution.
- `app/csv_writer.py`: CSV writing and formula-like cell escaping.
- `app/export_service.py`: validation, execution, limits, and CSV output.
- `app/session_store.py`: filesystem JSON session persistence.
- `app/model_provider.py`: LiteLLM SDK wrapper.
- `app/prompt_builder.py`: prompts for intent, SQL, and repair.
- `app/session_model_service.py`: approval-gated model orchestration.
- `app/provider_settings.py`: local provider settings with OpenRouter defaults.
- `.env` loading at API startup for local database/model configuration.
- Session debug traces: persisted prompt, model output, SQL validation, repair, and export execution traces in session JSON for read-only Advanced inspection.

Frontend:

- `src/`: compact React/Vite chat-first workflow with readiness-gated setup fallback and read-only Advanced debug trace inspection.
- `src/api-types.ts`: generated OpenAPI TypeScript types.
- `src/types.ts`: frontend-friendly aliases.
- `src/components/ui/`: official shadcn/ui primitives.

Setup/readiness:

- `GET /setup/status`: reports whether the database connection, model provider configuration, and generated context are ready.
- `POST /setup/bootstrap`: runs missing automatic setup work when configuration is present; currently scans the configured database and generates context files.
- Normal frontend entry goes directly to chat when setup is ready.
- The frontend shows a compact setup-needed panel only when database configuration, model provider configuration, or generated context is missing.
- The setup-needed provider panel can save either OpenRouter settings or a custom OpenAI-compatible base URL.
- Manual provider settings and database scan controls are no longer part of the normal chat surface.

Tools:

- `tools/export_openapi.py`: exports OpenAPI schema.
- `tools/check_setup.py`: prints setup readiness and exits nonzero when database, provider, or context setup is incomplete.
- `tools/dev.py`: starts backend and frontend dev servers together and shuts both down on exit.
- `tools/finance_calibration.py`: provisions a disposable realistic finance/invoicing Postgres schema and drives real-provider calibration without printing credentials or CSV contents.
- `tools/mock_openai_server.py`: deterministic local model server for demos.
- `tools/postgres_smoke.py`: provisions a disposable local Postgres demo DB and drives scan -> chat -> plan -> approval -> SQL prep -> export -> download.
- `tools/model_eval.py`: behavior-based model flow evals for clear requests, joins, aggregates, clarification/rejection cases, and SQL repair.
- `tools/realistic_calibration.py`: provisions a disposable realistic retail/support Postgres schema and drives real-provider calibration without printing credentials or CSV contents.

## API Surface

```text
GET  /health
GET  /setup/status
POST /setup/bootstrap
POST /context/scan
GET  /context
PUT  /context
GET  /settings/model-provider
PUT  /settings/model-provider
POST /sql/validate
POST /sessions
GET  /sessions/{session_id}
POST /sessions/{session_id}/messages
POST /sessions/{session_id}/clarify
POST /sessions/{session_id}/propose-intent
POST /sessions/{session_id}/approve-intent
POST /sessions/{session_id}/propose-sql
POST /sessions/{session_id}/prepare-sql
POST /sessions/{session_id}/export
GET  /exports/{export_id}/download
```

## Verification

Run:

```bash
.venv/bin/python -m pytest -q
.venv/bin/python -m compileall -q app tests tools
pnpm generate:api-types
.venv/bin/python tools/model_eval.py
pnpm test
pnpm build
```

Last documented full backend suite: `121 passed` on 2026-05-02.

Last documented model eval verification: `.venv/bin/python tools/model_eval.py` passed on 2026-05-02.

Last documented frontend verification: `pnpm test` passed with `5 passed`; `pnpm build` passed on 2026-05-02.

Optional local Postgres smoke test:

```bash
.venv/bin/python tools/postgres_smoke.py
```

On this Fedora WSL machine, local peer auth worked with:

```bash
.venv/bin/python tools/postgres_smoke.py --admin-url 'postgresql:///postgres'
```

Optional real-provider realistic calibration:

```bash
.venv/bin/python tools/realistic_calibration.py
.venv/bin/python tools/finance_calibration.py
```

## Provider Configuration

Local setup can use a root `.env` file copied from `.env.example`. The real `.env` file is ignored by git.

Provider settings can also be stored locally under `data/settings/model_provider.json`, which is ignored by git. API responses report only `api_key_configured`, never the saved key.

Defaults:

- provider: `openrouter`
- model: `openrouter/openai/gpt-4o-mini`
- temperature: `0`

Environment fallback:

- `DATABASE_URL`
- `MODEL_NAME` or `LITELLM_MODEL`
- `MODEL_API_KEY` or `LITELLM_API_KEY`
- `WORKER_LLM_PROVIDER=openrouter`, `WORKER_OPENROUTER_MODEL`, and `OPENROUTER_API_KEY`
- `MODEL_BASE_URL` or `LITELLM_API_BASE` for custom OpenAI-compatible endpoints
- `MODEL_TEMPERATURE`

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

Keep `data/exports/.gitkeep`.

Ignored generated artifacts such as `.openapi/`, `dist/`, `__pycache__/`, `.pytest_cache/`, and old session/export files can be deleted at any time and regenerated by the normal commands.

## Safety In Place

- The model has no database credentials or direct database access.
- Context scans respect explicit policy blocks for schemas, tables, and columns.
- Representative context values are limited to safe-looking low-cardinality/filter fields and skip obvious sensitive names.
- Model responses are parsed into Pydantic models before use.
- CSV intent text-list fields tolerate simple object-shaped model mistakes by coercing them to strings instead of failing the whole plan.
- SQL generation and repair require an approved CSV intent.
- SQL validation happens before export execution.
- SQL must be one Postgres `SELECT` statement with integer `LIMIT`.
- `SELECT ... INTO` is rejected.
- Policy can block schemas, tables, columns, and functions.
- Default blocked functions include `pg_sleep` and `set_config`.
- Query execution uses read-only transactions and local timeouts.
- Export enforces row and byte limits.
- Export columns must match the approved CSV intent.
- CSV cells that look formula-like are escaped.
- SQL and validation traces stay behind read-only Advanced UI.
- Debug traces are stored with the local session and are cleared when a new user request resets the session plan.

## Next Work

1. Re-run the remaining finance calibration scenarios after provider quota resets or with a paid/non-free provider: overdue-invoices SQL/export and vague-finance clarification.
2. Review generated context and persisted debug traces from any new runs, then tune only obvious noisy/missing hints.
3. Add an optional real-provider calibration mode for `tools/model_eval.py` once provider credentials and target models are stable enough for repeatable runs.
4. Keep `tools/postgres_smoke.py` passing as the API flow changes; consider a containerized CI-friendly version only after the smoke path stabilizes.
5. Use persisted debug traces during future realistic-schema runs to identify prompt/context/validation issues before broadening the product surface.
6. Consider a small packaged/local install path only after the dev runner and setup checker prove insufficient.
7. Current evidence does not justify adding a query compiler, worker, queue, or broader setup surface.

For a copy-pasteable continuation prompt, see `docs/agents/memory.md`.

## Defer

- Workers, queues, schedulers, dashboards, SSE/WebSockets, SQLite, uploaded CSV examples, editable SQL, LiteLLM proxy, LangChain/LlamaIndex, and a structured query compiler.
