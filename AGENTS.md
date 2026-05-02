# AGENTS.md

## Project Goal

Build a small local/customer-installed app that feels like talking to Codex, but constrained to one job: generating a validated CSV from a connected database.

The user chats naturally, the app inspects database schema/context, proposes what the CSV will contain, gets one user approval, generates SQL, validates it, runs it safely, and returns a CSV download.

## Working Principles

- For current implementation status, next steps, and new-session handoff context, read `docs/implementation-status.md` first. Treat the other docs as steadier reference material that should be updated at milestones, not after every small change.
- Do not overengineer.
- Every layer must justify its existence.
- Prefer popular open-source libraries when they solve a real problem.
- Do not reinvent provider routing, SQL parsing, DB drivers, CSV writing, or frontend state tooling.
- Keep the app narrow: chat -> database/schema/context -> validated CSV.
- Treat the model as useful but untrusted.
- The model may propose SQL, but the app must validate and execute it.
- Do not add a separate worker, queue, scheduler, approval workflow, or agent platform unless evidence shows it is needed.

## Preferred Stack

Frontend:

- React
- TypeScript
- Vite
- TanStack Query for server state
- OpenAPI-generated API types
- Tailwind CSS
- shadcn/ui selectively
- React Hook Form only when forms become nontrivial
- Vitest + React Testing Library
- Playwright later

Backend/export engine:

- Python
- FastAPI
- Pydantic
- psycopg v3 for Postgres
- SQLGlot for SQL validation
- Python csv stdlib for CSV writing
- pytest

Model provider layer:

- LiteLLM SDK first.
- Users should be able to choose API-key-based providers.
- Start with OpenRouter and custom OpenAI-compatible base URLs; keep room for more API-key providers and later account/subscription integrations.
- Do not use Pi, LangChain, or LlamaIndex initially unless a concrete need appears.

## Product Flow

1. Connect to Postgres with read-only credentials.
2. Scan schema and metadata.
3. Generate editable local context files.
4. User starts a chat and describes the CSV.
5. Model asks clarification only when needed.
6. Model proposes a user-facing CSV intent.
7. User approves the CSV intent once.
8. Model proposes SQL.
9. App validates SQL.
10. If invalid, app gives the model structured validation errors for limited repair.
11. App executes validated SQL with read-only limits.
12. App validates result columns and basic values against the approved intent.
13. App escapes formula-like CSV cells.
14. App writes the CSV and returns a download.

## Safety Rules

- Never let the model access database credentials.
- Never let the model execute SQL directly.
- Never execute SQL before user approval of the CSV intent.
- Never execute SQL before app validation passes.
- Never send database credentials or final CSV contents back to the model by default.
- Generated context may include representative database values unless blocked by policy.
- Use read-only DB credentials.
- Use read-only transactions, statement timeout, lock timeout, row limits, and export-size limits together.
- SQL must be hidden by default and shown only in read-only Advanced/debug views.
- Never expose a final CSV when validation fails.

## UX Language

- Use plain user-facing language.
- Prefer "CSV" and "CSV plan" or "CSV intent".
- Avoid SQL/table/column jargon in normal user-facing copy.
- Avoid the word "contract" in user-facing copy.
- SQL and validation details belong in read-only Advanced/debug views.

## Non-Goals For V0

- Hosted SaaS.
- Scheduling.
- Approval workflows.
- Separate background queue.
- Redis/Celery.
- SSE or WebSockets unless request/response progress proves insufficient.
- Multiple database support.
- Local model management.
- Uploaded example CSVs.
- Editable SQL.
- LiteLLM proxy.
- Complex semantic/query compiler unless raw SQL validation proves insufficient.

## Agent skills

This is a solo direct-to-main project. Do not assume issues, pull requests, triage labels, or a formal tracker unless the user says that workflow has changed.

Single-context repo. Read `CONTEXT.md`, `docs/implementation-status.md`, `docs/architecture.md`, `docs/decisions.md`, and relevant ADRs when they exist.

Keep a lightweight section-by-section memory of completed steps and the next step in `docs/agents/memory.md`.
