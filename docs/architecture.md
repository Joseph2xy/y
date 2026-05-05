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
9. App validates SQL, including output count/order, approved source hints, read-only limits, policy blocks, and scanned-schema table references.
10. App gives validation errors to the model for up to two repair attempts if needed.
11. App executes validated SQL with read-only limits.
12. App maps result values by position to the approved CSV headers.
13. App escapes formula-like CSV cells.
14. App writes the CSV and returns a download.
15. User may save the completed CSV plan for future reruns without chat.

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

## Frontend

Purpose:

- chat with the user
- scan/setup context
- show the CSV plan for approval
- run SQL preparation/export actions
- provide the CSV download
- hide SQL and validation details behind read-only Advanced UI
- keep technical safety settings, such as default row limits, in Settings rather than the CSV-plan approval artifact

Stack:

- React + TypeScript + Vite
- TanStack Query
- OpenAPI-generated API types
- Tailwind CSS
- shadcn/ui selectively
- Vitest + React Testing Library
- Playwright later


## Backend

Purpose:

- store runtime settings
- scan schema/context
- manage chat/export sessions
- call the configured model provider
- validate SQL against safety policy, approved output shape, source hints, and scanned schema context
- execute read-only SQL
- validate and write CSVs
- persist and rerun saved CSV plans after successful exports
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

The app also uses the scanned schema during SQL validation so generated SQL cannot reference tables outside the known context.

## SQL Guard

Model-generated SQL is untrusted. Use model-generated SQL plus app validation for V0; do not add a structured query compiler unless evidence shows validation/repair is insufficient.

Minimum checks:

- single Postgres statement
- `SELECT` only
- no writes, DDL, COPY, EXECUTE, or unsafe commands
- no blocked schemas/tables/columns/functions
- required integer `LIMIT`
- selected output count and order match the approved CSV intent
- selected source hints match approved `source_hint` values by output position when present
- referenced tables are present in the scanned schema context, with CTE names allowed
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

## Windows Real-Data Setup

For WSL-local development and early Windows users, the preferred real-data path is to import a pgAdmin/Postgres backup into the app-managed local WSL Postgres cluster. CSV Chat then connects to `127.0.0.1` inside WSL through a generated read-only user.

This keeps the happy path away from Windows Firewall, WSL gateway IPs, Windows Postgres `listen_addresses`, and `pg_hba.conf` changes. Direct WSL-to-Windows Postgres connections remain an advanced fallback for users who need a live connection to an existing Windows server.

## CSV Output

The final CSV is the product artifact.

Responsibilities:

- write approved intent column labels as the CSV headers
- map result values by position to the approved headers
- verify the query result has the same column count as the approved intent
- validate basic values where possible
- enforce row and byte limits
- escape formula-like string cells
- write a local CSV file
- provide a download endpoint

There is no special export retention workflow in V0. Once the CSV is ready, the user downloads it to their chosen location.

## Saved CSVs

Saved CSVs let a user rerun the same approved CSV later without going through chat. A saved item stores the user-facing name, optional description, approved CSV intent, validated SQL, row limit, schema fingerprint, and last-run metadata.

Saved CSVs are tied to the database context they were created from. A rerun is blocked when the current scanned context fingerprint is missing or differs from the saved fingerprint, so a saved item does not silently run against another database. Matching reruns reuse the saved SQL but still validate it against the current policy, approved intent shape, source hints, and scanned schema before read-only execution. SQL remains hidden in normal UX and visible only in read-only details/Advanced.

State remains filesystem JSON for V0:

```text
data/saved_csv_plans/*.json
```

There is no scheduling, editable SQL, parameter system, sharing, or separate approval workflow for Saved CSVs in V0.

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
