# Architecture

This is the canonical product and technical shape for V0.

## Goal

Build a local/customer-installed app where a user chats naturally to generate a safe, validated CSV from a connected Postgres database.

The model helps interpret the request and propose SQL. The application owns credentials, validation, execution, CSV writing, and download.

## Product Flow

1. Admin connects read-only Postgres credentials.
2. App scans schema and metadata.
3. App writes editable local context files.
4. User asks for a CSV in chat.
5. Model asks clarification only when needed.
6. Model proposes a user-facing CSV intent.
7. User approves the CSV intent once.
8. Model proposes SQL internally.
9. App validates SQL.
10. If invalid, app gives structured validation errors to the model for limited repair.
11. App executes validated SQL with read-only limits.
12. App validates result columns and basic values against the approved intent.
13. App escapes formula-like CSV cells.
14. App writes the CSV and returns a download.

## CSV Intent

The one user-approved object should be understandable without SQL:

- Summary.
- Row meaning.
- Columns.
- Filters.
- Derived or aggregate fields.
- Assumptions.
- Maximum row count.

Normal users approve the CSV intent, not raw SQL. SQL belongs in Advanced/debug views.

## Target Shape

```text
React/Vite frontend
  -> FastAPI backend
      -> LiteLLM model adapter
      -> context.md + schema.json + policy.json
      -> Postgres via psycopg
      -> SQLGlot guard
      -> CSV writer
      -> local export files
```

There is no separate worker process in V0. The backend is the execution boundary.

## Frontend

Exists because the user needs to chat, review the proposed CSV intent, approve it, see progress, and download the result.

Chosen stack:

- React + TypeScript + Vite.
- TanStack Query for REST server state.
- Native EventSource for SSE streaming.
- Tailwind CSS.
- shadcn/ui selectively.
- OpenAPI-generated API types.
- Vitest + React Testing Library.
- Playwright later.

Primary views:

- setup/context view.
- chat/export session.
- CSV intent approval card.
- progress/status area.
- download result.
- Advanced/debug disclosure.

Do not build a dashboard shell until the app has enough repeated workflows to justify it.

## Backend / Export Engine

Exists because the browser and model must not hold DB credentials or execute SQL directly.

Responsibilities:

- Store runtime settings.
- Scan schema.
- Manage chat/export sessions.
- Call model provider.
- Validate SQL.
- Execute read-only SQL.
- Validate and write CSV.
- Keep logs/audit/debug information.

Chosen stack:

- Python + FastAPI.
- Pydantic for request/response and model-output validation.
- pytest for tests.

## Model Provider Layer

Exists because users should be able to choose providers with API keys.

Chosen approach:

- LiteLLM SDK inside the Python backend first.
- Do not run LiteLLM proxy initially.
- Add LiteLLM proxy later only if provider routing, budgets, organization-level settings, observability, or key isolation justify it.

Provider config should support:

- provider or model identifier.
- API key.
- optional base URL.
- optional provider-specific settings.

Support OpenAI, Anthropic, Google/Gemini, Mistral, Groq, OpenRouter, Ollama/local OpenAI-compatible servers, and custom OpenAI-compatible base URLs where practical.

Model outputs must be parsed into Pydantic models before the app acts on them.

## Context Layer

Exists because raw database schema is too ambiguous for a useful nontechnical chat experience.

Files:

```text
data/context/context.md
data/context/schema.json
data/context/policy.json
```

`context.md` is readable/editable by admins and useful to the model.

`schema.json` is structured schema metadata for the app and model.

`policy.json` contains blocked schemas/tables/columns, sensitivity notes, and limits.

## SQL Guard

Exists because model-generated SQL is untrusted.

Minimum checks:

- single statement.
- SELECT only.
- no writes, DDL, COPY, execute, unsafe commands.
- blocked schemas/tables/columns/functions.
- required LIMIT.
- selected output fields match the approved CSV intent.
- SQL parses under Postgres dialect.

Use SQLGlot for parsing and AST inspection.

## Database Execution

Exists because the final CSV must come from the real database, under controlled conditions.

Use:

- psycopg v3.
- read-only database credentials.
- read-only transaction.
- statement timeout.
- lock timeout.
- row limit.
- max export byte limit.

## CSV Writer

Exists because the final artifact is the product and has its own safety requirements.

Responsibilities:

- verify output columns match approved intent.
- validate basic types where possible.
- enforce max rows and max bytes.
- escape formula-like cells.
- write local CSV file.
- provide download endpoint.

Formula-like string cells start with:

```text
=
+
-
@
tab
carriage return
```

## Trust Boundary

The backend/export engine is trusted. The model is not.

The model can read prepared schema/context, ask clarifying questions, propose a CSV intent, propose SQL, and repair SQL after structured validation errors.

The model must not receive database credentials, directly connect to the database, directly execute SQL, receive raw database rows by default, or receive final CSV contents by default.

## UX Language

- Use plain user-facing language.
- Prefer "CSV" and "CSV plan" or "CSV intent".
- Avoid SQL/table/column jargon in normal user-facing copy.
- Avoid the word "contract" in user-facing copy.
- SQL and validation details belong in Advanced/debug views.

## Suggested API Surface

```text
GET  /health

POST /context/scan
GET  /context
PUT  /context

POST /sessions
GET  /sessions/{session_id}
POST /sessions/{session_id}/messages
GET  /sessions/{session_id}/events

POST /sessions/{session_id}/approve-intent
GET  /exports/{export_id}/download
```

The exact API can change, but keep it small.

## State

Start with filesystem JSON or SQLite.

Use SQLite once sessions, exports, audit events, and debug traces need reliable querying.

Do not add Redis, Celery, or a job queue until export execution is clearly too slow or unreliable inside the API process.

## Non-Goals For V0

- Hosted SaaS.
- Scheduling.
- Approval workflows.
- Separate background queue.
- Redis/Celery.
- WebSockets unless SSE is insufficient.
- Multiple database support.
- Local model management.
- Complex semantic/query compiler unless raw SQL validation proves insufficient.
