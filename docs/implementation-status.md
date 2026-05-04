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

Local tester onboarding was simplified on 2026-05-03. The root README now focuses on first-run/everyday local use, `tools/setup_local.sh` creates the venv, installs dependencies, and copies `.env.example` without overwriting existing secrets, and detailed reference material moved to `docs/local-user-guide.md`, `docs/troubleshooting.md`, and `docs/development.md`. Windows guidance is WSL-first for now; native Windows PowerShell setup is explicitly not first-class yet. Context lifecycle is now explicit: first-run setup creates context only when missing; schema context stores sanitized database source metadata and scan time; setup status warns when current `DATABASE_URL` differs from the context source; users can rescan from the setup screen or `pnpm rescan:context`.

The frontend was reset from first principles on 2026-05-03. The normal ready state is now a minimal centered chat canvas using shadcn defaults and selected prompt-kit primitives. The old full-width workspace/timeline layout was removed. Setup remains only as a fallback when readiness checks fail. SQL and debug traces are hidden behind a read-only Advanced dialog.

The chat UI was tightened further on 2026-05-03 after reviewing Prompt Kit. Custom chat bubbles, loading/status text, scroll-to-latest behavior, system notices, and Advanced code rendering now use Prompt Kit primitives where they improve the UX. Markdown and Shiki-backed code highlighting are lazy-loaded so the normal chat bundle stays below the Vite warning threshold.

The ready-state screen now uses Prompt Kit's block composition as its base: a full-height conversation shell, centered max-width message rows, Prompt Kit composer, and CSV-specific approval/export surfaces inside the conversation. Generic Prompt Kit sidebar/history/full-chat blocks were not adopted because they imply a broader chatbot product and conflict with the narrow V0 single-session CSV flow.

The frontend was then reworked into an Artifact Split layout on 2026-05-03. Chat remains the starting point and left-side input surface, while the right-side persistent CSV artifact panel holds the current CSV plan, clarification state, approval action, validation/safety status, export summary, download action, and read-only Advanced dialog. The normal user path is now chat request -> review artifact -> approve CSV plan -> create CSV -> download, with SQL and validation internals still hidden by default. The header now includes a persisted light/dark mode toggle using the existing shadcn theme tokens.

The shadcn preset was switched on 2026-05-03 from `b2fA` to `b1Ymqvgiu`: Nova style, neutral base, blue theme/chart tokens, lucide icons, Inter font, inherited heading font, default radius, and subtle default menus. Existing shadcn UI components were reinstalled through the CLI with `init --preset b1Ymqvgiu --force --reinstall`.

The ready-state header now includes a shadcn settings dialog. It keeps setup/change controls out of the normal CSV flow while making database/context status, a database connection test, context rescans, and model-provider changes available from chat. Database credentials still come from the backend `.env` file in V0; the dialog explicitly says database credentials are not browser-editable, shows the current context source, and points users to update `.env` and rescan. Model provider settings remain editable in Settings and are saved locally by the backend.

Review hardening on 2026-05-03 fixed context recovery and validation gaps. Context scans now recover from malformed generated `schema.json`/`policy.json` without manual file deletion, and rescans refresh autogenerated `context.md` when it still matches the previous generated schema text while preserving edited notes. CSV intents now reject duplicate output column names, SQL preparation/export validate declared `source_hint` columns when present, the frontend no longer claims broad semantic plan matching, and failed SQL preparation exposes a retry action.

Follow-up narrowing on 2026-05-03 removed the unused public `/sessions/{session_id}/clarify`, `/sessions/{session_id}/propose-sql`, and `/sql/validate` endpoints from the HTTP/OpenAPI surface. Clarification happens through `/sessions/{session_id}/propose-intent` with `intent: null`, and SQL generation, validation, and repair stay on the approval-gated `/sessions/{session_id}/prepare-sql` path. SQL prompts now explicitly tell the model to satisfy any approved `source_hint` by selecting that `table.column` and aliasing it to the approved CSV column name.

Intent clarification was tightened on 2026-05-03 without adding backend natural-language filtering. The model-facing intent prompt and `CSVIntentProposal` schema now explicitly require `intent: null` for greetings, capability questions, generic CSV requests, and vague/useful/everything/all-data requests unless the user has provided enough detail for an approvable CSV plan. `tools/model_eval.py` now includes those unclear-message scenarios, and the deterministic mock OpenAI-compatible server returns clarification for them so the browser flow can be checked locally.

The chat/artifact split was tightened after hands-on UI review. Assistant/model responses now stay in the left conversation, including messages that accompany a real CSV plan; the right artifact panel shows only the durable CSV plan state and approval/export controls. Assistant avatars were removed, chat/composer text now uses normal foreground colors, and the compact safety status block avoids clipped headings in the narrow artifact panel.

Export row limits moved out of the CSV plan UI and into Settings -> Safety. The normal plan no longer asks users to approve a technical "Max rows" field. Settings edits `policy.max_row_count` through the existing context API, and intent generation treats that policy value as the default row cap unless the user asks for a smaller limit.

CSV intent guidance was tightened so ID-like fields, including foreign-key IDs such as `account_id`, are excluded by default unless the user explicitly asks for identifiers. This remains model guidance plus user approval rather than hidden app-side proposal rewriting. Intent column labels should be user-facing where possible, such as "Creation date" instead of raw database names like `created_at`, while `source_hint` preserves the database mapping for validation and SQL generation.

SQL validation now checks generated SQL table references against the scanned schema context. Missing-table cases such as SQL against `public.customers` when the scanned database has no such table are rejected before execution and fed into the bounded repair loop instead of surfacing as export-time Postgres errors. CTE names remain allowed.

Complex calibration on 2026-05-04 added disposable SaaS/product-analytics and marketplace/ecommerce schemas with harder realistic prompts. The first quota-limited run completed one SaaS export and exposed an overly strict source-hint validation case for grouped exports: selected expressions such as `date_trunc('month', i.issued_date)` and `sum(i.total_amount)` did not satisfy approved source hints like `invoices.issued_date` and `invoices.total_amount` when SQL used table aliases. SQL validation now resolves table aliases in selected expressions while preserving the approved-source boundary and rejecting aliases named to spoof an approved source table.

Follow-up calibration discussion on 2026-05-04 clarified that V0 should support useful derived CSV columns without building a full SQL lineage engine yet. SQL validation now allows `COUNT(*)` aggregates while still rejecting `SELECT *`/`table.*`, and CSV intent parsing keeps `source_hint` to concrete `table.column`/`schema.table.column` references while treating formulas, counts, filters, or prose hints as derived/unknown sources. SQL prompts now tell the model to keep formulas in descriptions/derived fields and avoid hiding source-hinted output columns behind CTE aliases when practical. A SaaS-only rerun showed the previous churn-risk and feature-usage failures now export on first SQL attempt. Remaining calibration findings: the model sometimes asks clarifications for concrete-but-ambiguous requests, CTE-derived source hints such as latest health snapshot CSM still fail validation without lineage support, and an exact-label export reached execution but returned unquoted/lowercased labels for `Account`/`Plan`.

## Implemented

Backend:

- `app/main.py`: FastAPI routes.
- `app/models.py`: Pydantic API/domain/model-output models.
- `app/context_store.py`: local context, schema, and policy files.
- `app/schema_scan.py`: Postgres schema scan with table/column metadata, primary keys, foreign-key relationship hints, and conservative representative values for safe-looking filter fields.
- `app/sql_guard.py`: SQLGlot validation, including read-only shape, limits, blocked objects, approved output/source hints, and scanned-schema table references.
- `app/db.py`: read-only psycopg execution.
- `app/csv_writer.py`: CSV writing and formula-like cell escaping.
- `app/export_service.py`: validation, execution, limits, and CSV output.
- `app/session_store.py`: filesystem JSON session persistence.
- `app/model_provider.py`: LiteLLM SDK wrapper.
- `app/prompt_builder.py`: prompts for intent, SQL, and repair.
- `app/session_model_service.py`: approval-gated model orchestration.
- `app/provider_settings.py`: local provider settings with OpenRouter defaults.
- `.env` loading at API startup for local database configuration.
- Session debug traces: persisted prompt, model output, SQL validation, repair, and export execution traces in session JSON for read-only Advanced inspection.

Frontend:

- `src/`: Artifact Split React/Vite workspace using Prompt Kit chat primitives for the left-side conversation/composer and shadcn components for the right-side CSV artifact panel, readiness-gated setup fallback, settings dialog, export-safety settings, approval/export actions, safety status, and read-only Advanced debug trace dialog.
- `src/api-types.ts`: generated OpenAPI TypeScript types.
- `src/types.ts`: frontend-friendly aliases.
- `src/components/ui/` and `src/components/prompt-kit/`: reset shadcn/ui defaults plus selected Prompt Kit components for chat input, messages, suggestions, scrolling, notices, markdown, and read-only code rendering.

Setup/readiness:

- `GET /setup/status`: reports whether the database connection, model provider configuration, and generated context are ready.
- `POST /setup/bootstrap`: runs missing automatic setup work when configuration is present; currently scans the configured database and generates context files.
- `pnpm check:setup`: reports setup readiness and prints the next user action when setup is incomplete.
- `pnpm rescan:context`: rescans the current `DATABASE_URL`, updates `schema.json` with sanitized source metadata, preserves `policy.json`, and preserves edited `context.md` notes.
- Normal frontend entry goes directly to chat when setup is ready.
- The frontend shows a compact setup-needed panel only when database configuration, model provider configuration, or generated context is missing.
- The frontend shows a context-rescan panel when existing context was scanned from a different database than the current `DATABASE_URL`.
- The setup-needed provider panel can save either OpenRouter settings or a custom OpenAI-compatible base URL.
- Manual provider settings, export row-limit settings, and database scan controls are no longer part of the normal chat surface.

Tools:

- `tools/setup_local.sh`: Linux/WSL first-run helper that creates `.venv`, installs Python/frontend dependencies, and copies `.env.example` to `.env` only when missing.
- `tools/rescan_context.py`: CLI helper for explicitly regenerating schema context after changing `DATABASE_URL`.
- `tools/export_openapi.py`: exports OpenAPI schema.
- `tools/check_setup.py`: prints setup readiness, gives a concrete next step, and exits nonzero when database, provider, or context setup is incomplete.
- `tools/dev.py`: starts backend and frontend dev servers together and shuts both down on exit.
- `tools/api_client.py`: shared HTTPX ASGI test/tool client for driving the FastAPI app without the hanging sync TestClient path in this Python 3.14 environment.
- `tools/calibration.py`: shared scenario runner and disposable Postgres provisioning helpers used by real-provider calibration scripts.
- `tools/finance_calibration.py`: provisions a disposable realistic finance/invoicing Postgres schema and drives real-provider calibration without printing credentials or CSV contents.
- `tools/mock_openai_server.py`: deterministic local model server for demos.
- `tools/postgres_smoke.py`: provisions a disposable local Postgres demo DB and drives scan -> chat -> plan -> approval -> SQL prep -> export -> download.
- `tools/model_eval.py`: behavior-based model flow evals for clear requests, joins, aggregates, clarification/rejection cases, and SQL repair.
- `tools/realistic_calibration.py`: provisions a disposable realistic retail/support Postgres schema and drives real-provider calibration without printing credentials or CSV contents.
- `tools/complex_calibration.py`: provisions disposable SaaS/product-analytics and marketplace/ecommerce Postgres schemas, runs broader real-provider calibration prompts through the normal app flow, and reports plan/clarification, approval, SQL validation, export summary, trace steps, and suspicious notes without printing credentials or CSV contents.

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

Run:

```bash
.venv/bin/python -m pytest -q
.venv/bin/python -m compileall -q app tests tools
pnpm generate:api-types
.venv/bin/python tools/model_eval.py
pnpm test
pnpm build
```

Last documented full backend suite: `133 passed` on 2026-05-03 after scanned-schema table validation, row-limit settings, and chat/artifact UI refinements.

Last documented onboarding check update: `tests/test_check_setup.py` passed, `bash -n tools/setup_local.sh` passed, and `pnpm check:setup` reported ready on 2026-05-03.

Last documented model eval verification: `.venv/bin/python tools/model_eval.py` passed on 2026-05-04 after complex calibration and source-hint alias validation updates.

Last documented focused calibration rerun: `.venv/bin/python tools/complex_calibration.py --domain saas` ran on 2026-05-04 against a temporary local Postgres instance until provider quota was hit. Churn-risk and feature-usage scenarios exported successfully after `COUNT(*)` and source-hint sanitization changes; friendly-labels still failed on CTE source-hint lineage; exact-labels failed at export due returned column labels not matching `Account`/`Plan`; blocked-sensitive-fields was not evaluated because the provider hit quota.

Last documented frontend verification: `pnpm test` passed with `10 passed`; `pnpm build` passed on 2026-05-03 after row-limit Settings, chat/artifact message placement, and safety-status UI updates.

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
.venv/bin/python tools/complex_calibration.py
```

If local Postgres requires an explicit admin TCP role on this machine:

```bash
.venv/bin/python tools/complex_calibration.py --admin-url 'postgresql://Joseph@127.0.0.1:5432/postgres'
```

## Provider Configuration

Local setup can use a root `.env` file copied from `.env.example`. The real `.env` file is ignored by git.

Provider settings are stored locally under `data/settings/model_provider.json`, which is ignored by git. API responses report only `api_key_configured`, never the saved key. The app does not fall back to model provider values in `.env`.

Defaults:

- provider: `openrouter`
- model: `openrouter/openai/gpt-4o-mini`
- temperature: `0`

Environment:

- `DATABASE_URL`

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
- CSV intent column names must be unique.
- CSV intent prompts exclude ID-like fields by default unless the user asks for identifiers, and prefer user-facing CSV labels while preserving `source_hint`.
- SQL generation and repair require an approved CSV intent.
- SQL validation happens before export execution.
- SQL must be one Postgres `SELECT` statement with integer `LIMIT`.
- `SELECT ... INTO` is rejected.
- Policy can block schemas, tables, columns, and functions.
- Default blocked functions include `pg_sleep` and `set_config`.
- SQL table references are checked against the scanned schema context before execution.
- Query execution uses read-only transactions and local timeouts.
- Export enforces row and byte limits.
- Export columns must match the approved CSV intent.
- Export SQL must select from approved intent source hints when the plan includes them.
- Source-hint validation resolves real table aliases in selected expressions, including aggregate and date expressions, so `sum(i.total_amount)` can satisfy an approved `invoices.total_amount` hint when `i` aliases `invoices`; aliases named after the approved table do not spoof that boundary.
- CSV cells that look formula-like are escaped.
- SQL and validation traces stay behind read-only Advanced UI.
- Debug traces are stored with the local session and are cleared when a new user request resets the session plan.

## Next Work

1. Re-run the remaining finance calibration scenarios after provider quota resets or with a paid/non-free provider: overdue-invoices SQL/export and vague-finance clarification.
2. Ask a tester to follow the README from a fresh Linux/WSL clone and record any friction before adding Docker, native Windows scripts, or installers.
3. Review generated context and persisted debug traces from any new runs, then tune only obvious noisy/missing hints.
4. Add an optional real-provider calibration mode for `tools/model_eval.py` once provider credentials and target models are stable enough for repeatable runs.
5. Keep `tools/postgres_smoke.py` passing as the API flow changes; consider a containerized CI-friendly version only after the smoke path stabilizes.
6. Use persisted debug traces during future realistic-schema runs to identify prompt/context/validation issues before broadening the product surface.
7. Current evidence does not justify adding a query compiler, worker, queue, scheduler, Docker path, native installer, or broader setup surface.

For a copy-pasteable continuation prompt, see `docs/agents/memory.md`.

## Defer

- Workers, queues, schedulers, dashboards, SSE/WebSockets, SQLite, uploaded CSV examples, editable SQL, LiteLLM proxy, LangChain/LlamaIndex, and a structured query compiler.
