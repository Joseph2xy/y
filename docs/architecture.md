# Architecture

Canonical V0 product and technical shape. Resolved trade-offs live in `docs/decisions.md`; current implementation status lives in `docs/implementation-status.md`; product vocabulary lives in `CONTEXT.md`.

## Goal

Build a local/customer-installed app where a user chats naturally to generate a safe, validated CSV from a connected Postgres database.

The model helps interpret the request and propose SQL. The application owns credentials, validation, execution, CSV writing, and download.

## Flow

1. Admin connects read-only Postgres credentials.
2. App scans schema and metadata.
3. App writes editable context files.
4. User asks for a CSV in chat.
5. Model asks clarification only when needed.
6. Model proposes a user-facing CSV plan.
7. User approves the CSV plan once.
8. Model proposes SQL internally.
9. App validates SQL, including output names against the approved intent.
10. App gives validation errors to the model for up to two repair attempts if needed.
11. App executes validated SQL with read-only limits.
12. App validates result columns against the approved intent.
13. App escapes formula-like CSV cells.
14. App writes the CSV and returns a download.

## Shape

```text
React/Vite frontend
  -> FastAPI backend
      -> LiteLLM SDK model adapter
      -> context.md + schema.json + policy.json
      -> Postgres via psycopg
      -> SQLGlot guard
      -> CSV writer
      -> local export files
```

There is no worker, queue, scheduler, or separate execution service in V0. The backend process is the execution boundary.

Frontend and backend stay in one repo for V0.

## Frontend

Purpose:

- chat with the user
- scan/setup context
- show the CSV plan for approval
- run SQL preparation/export actions
- provide the CSV download
- hide SQL and validation details behind read-only Advanced UI

Stack:

- React + TypeScript + Vite
- TanStack Query
- OpenAPI-generated API types
- Tailwind CSS
- shadcn/ui selectively
- Vitest + React Testing Library
- Playwright later

UX constraints:

- Keep the app compact, centered, dark by default, and chat-first.
- Show setup/export/debug controls only when useful.
- Do not add a dashboard shell or upload panel in V0.
- Use plain user-facing language: CSV, CSV plan, CSV intent.
- Keep SQL/table/column jargon in Advanced/debug surfaces.

## Backend

Purpose:

- store runtime settings
- scan schema/context
- manage chat/export sessions
- call the configured model provider
- validate SQL
- execute read-only SQL
- validate and write CSVs
- keep enough debug trace information to inspect failures

Stack:

- Python + FastAPI
- Pydantic
- psycopg v3
- SQLGlot
- Python `csv` stdlib
- pytest

State starts as filesystem JSON. Move to SQLite only after querying sessions, exports, audit history, or debug traces becomes a real need.

## Model Provider

Use LiteLLM SDK inside the backend for V0. Do not run LiteLLM proxy.

Provider setup is API-key-first:

- OpenRouter is the first-class default.
- Custom OpenAI-compatible base URLs cover local/internal endpoints.
- More API-key providers can be added later.
- Account/subscription-style integrations can come later after the local flow is stable.

Model outputs must be parsed into Pydantic models before the app acts on them.

Model suitability is judged by app behavior, not a benchmark name. Candidate models should be tested against clear requests, under-specified requests, invalid/gibberish requests, SQL validation failures, and repair loops.

## Context

Context exists because raw database schema is too ambiguous for a useful nontechnical chat experience.

Files:

```text
data/context/context.md
data/context/schema.json
data/context/policy.json
```

- `context.md`: editable Markdown business/database context for the model.
- `schema.json`: structured schema metadata.
- `policy.json`: explicit blocked schemas/tables/columns/functions plus execution/export limits.

For V0, context setup stays file-based. The app scans the database, prepares useful starter Markdown, and lets admins tweak it directly. Generated context may include relationship hints, common filter fields, and representative values where useful for model precision. Explicit policy blocks define exclusions.

If the configured model provider is external, generated context may leave the machine when sent to the provider. Credentials must never be included in context. V0 does not manage provider-side logging or retention.

## SQL Guard

Model-generated SQL is untrusted. Use model-generated SQL plus app validation for V0; do not add a structured query compiler unless evidence shows validation/repair is insufficient.

Minimum checks:

- single Postgres statement
- `SELECT` only
- no writes, DDL, COPY, EXECUTE, or unsafe commands
- no blocked schemas/tables/columns/functions
- required integer `LIMIT`
- selected output fields match the approved CSV intent
- parseable under Postgres dialect

Repair attempts are driven only by server-computed validation errors and are bounded to two attempts in V0.

## Execution

Database execution uses:

- read-only database credentials
- read-only transaction
- statement timeout
- lock timeout
- row limit
- max export byte limit

The model never receives credentials, directly connects to the database, directly executes SQL, or receives final CSV contents by default.

## CSV Output

The final CSV is the product artifact.

Responsibilities:

- verify output columns match the approved intent
- validate basic values where possible
- enforce row and byte limits
- escape formula-like string cells
- write a local CSV file
- provide a download endpoint

There is no special export retention workflow in V0. Once the CSV is ready, the user downloads it to their chosen location.

Formula-like string cells start with:

```text
=
+
-
@
tab
carriage return
```

## Non-Goals For V0

- Hosted SaaS
- Scheduling
- Approval workflows beyond one CSV-plan approval
- Worker/queue/scheduler
- Redis/Celery
- SSE/WebSockets
- Multiple database support
- Local model management
- Uploaded example CSVs
- Editable SQL
- LiteLLM proxy
- LangChain/LlamaIndex
- Structured query compiler
