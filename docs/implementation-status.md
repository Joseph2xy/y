# Implementation Status

This file is the primary handoff context for starting a new implementation session.

Keep this file current as work progresses. The other Markdown files are steadier reference docs and should be updated only when a milestone or durable decision changes them.

## What Exists

The project currently has a tested FastAPI backend and a minimal React/Vite frontend.

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
- `app/model_provider.py`: LiteLLM SDK wrapper that parses model JSON into Pydantic models.
- `app/prompt_builder.py`: prompt builders for CSV intent, SQL generation, and SQL repair.
- `app/session_model_service.py`: session-level model orchestration helpers with approval gating and limited SQL repair.
- `src/`: React/Vite frontend for the chat/session flow, database scan action, CSV plan approval, SQL preparation, export, and Advanced/debug traces.
- `src/api-types.ts`: generated OpenAPI TypeScript schema types.
- `src/types.ts`: small frontend-friendly aliases over generated API schema types.
- `src/components/ui/`: shadcn/ui primitives installed through the shadcn CLI.
- `tools/mock_openai_server.py`: tiny local OpenAI-compatible mock model server for deterministic local demos when external model credentials are not configured.
- `tools/export_openapi.py`: emits the FastAPI OpenAPI schema for frontend type generation.

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
POST /sessions/{session_id}/clarify
POST /sessions/{session_id}/propose-intent
POST /sessions/{session_id}/approve-intent
POST /sessions/{session_id}/propose-sql
POST /sessions/{session_id}/prepare-sql
POST /sessions/{session_id}/export
GET  /exports/{export_id}/download
```

Current verification:

```bash
.venv/bin/python -m pytest -q
.venv/bin/python -m compileall -q app tests
pnpm generate:api-types
pnpm test
pnpm build
```

Last known focused backend review result: `48 passed` on 2026-05-01.
Last known full-suite result: `89 passed` on 2026-05-02 with pytest 9, FastAPI 0.136, LiteLLM 1.83, psycopg 3.3, and SQLGlot 30.6.
Last known frontend result: `pnpm test` passed with `2 passed`; `pnpm build` passed on 2026-05-02 with Vite 8, Tailwind CSS 4, TypeScript 6, Vitest 4, React 19.2, and current Testing Library packages.

Frontend visual review:

```bash
pnpm dev
agent-browser open http://localhost:5174
agent-browser screenshot /tmp/csv-chat-shadcn-v4-dark.png
```

The Vite port may be `5173`, `5174`, or another nearby port depending on what is already running.

Latest end-to-end local demo result on 2026-05-02:

- Fedora WSL local Postgres was installed and initialized.
- Demo database: `csv_chat_demo`.
- Read-only demo user: `csv_chat_readonly`.
- Demo API env:
  - `DATABASE_URL='postgresql://csv_chat_readonly:readonly@127.0.0.1:5432/csv_chat_demo'`
  - `MODEL_NAME='openai/demo-model'`
  - `MODEL_API_KEY='demo-key'`
  - `MODEL_BASE_URL='http://127.0.0.1:4010'`
- Mock model server command: `.venv/bin/python tools/mock_openai_server.py`.
- API command: `.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`.
- Frontend command: `pnpm dev`.
- Browser demo completed: scan context -> send request -> propose CSV plan -> approve -> prepare SQL -> export -> download.
- Screenshot: `/tmp/csv-chat-e2e.png`.
- Downloaded CSV had 3 rows for active 2026 customers.

## Current Flow

The backend can already support this debug/API flow:

1. Configure `DATABASE_URL` for a read-only Postgres user.
2. Call `POST /context/scan` to write schema metadata.
3. Optionally edit `PUT /context` to update context and policy.
4. Call `POST /sessions`.
5. Call `POST /sessions/{session_id}/messages`.
6. Either:
   - call `POST /sessions/{session_id}/clarify`, or
   - call `POST /sessions/{session_id}/propose-intent`.
7. Call `POST /sessions/{session_id}/approve-intent` with a CSV intent.
8. Either:
   - call `POST /sessions/{session_id}/propose-sql`, then validate with `POST /sql/validate`, or
   - call `POST /sessions/{session_id}/prepare-sql` to propose, validate, and attempt limited server-side repair in one debug/API step.
9. Call `POST /sessions/{session_id}/export` with validated SQL.
10. Download the generated CSV from `GET /exports/{export_id}/download`.

Model endpoints use LiteLLM provider configuration from environment variables:

- `MODEL_NAME` or `LITELLM_MODEL`.
- `MODEL_API_KEY` or `LITELLM_API_KEY`.
- `MODEL_BASE_URL` or `LITELLM_API_BASE`.
- `MODEL_TEMPERATURE`, default `0`.

The frontend currently calls the explicit debug-friendly endpoints. SQL and validation attempts stay hidden unless the user opens the Advanced panel.

Current frontend UX:

- Dark mode by default.
- Minimal centered single-column chat flow.
- Initial state shows only the header/status, a compact three-step indicator, a plain prompt, the composer, and a small `Scan database` action.
- Sending a message creates a session automatically if needed.
- `Propose CSV plan` appears only after there is a message/session.
- CSV plan, export controls, and Advanced/debug details appear centered below the composer only when relevant.
- No dashboard shell, sidebar/right rail, upload panel, prompt suggestion cards, or always-visible export/debug section.

## Safety Already In Place

- The model layer has no database access.
- Model responses are parsed into Pydantic models before service code uses them.
- SQL generation and SQL repair require an approved CSV intent.
- `POST /sessions/{session_id}/prepare-sql` validates model SQL and attempts up to two repairs without executing SQL.
- There is no standalone export endpoint; exports must use the session-approved CSV intent.
- SQL validation for preparation and export checks output names against the approved CSV intent fields.
- SQL validation happens before export execution.
- SQL must parse as one Postgres statement.
- SQL must be `SELECT`.
- `SELECT ... INTO` is rejected.
- SQL must include an integer `LIMIT`.
- Policy can block schemas, tables, columns, and functions.
- Default blocked functions include `pg_sleep` and `set_config`.
- Query execution uses psycopg with read-only transaction and local timeouts.
- Export enforces row and byte limits.
- Export checks that result rows contain the approved CSV intent columns.
- CSV writer escapes formula-like string cells starting with `=`, `+`, `-`, `@`, tab, carriage return, or leading whitespace followed by a formula prefix.
- Final CSV is served by export id only.

## Important Local State

During smoke testing, these files were created:

```text
data/context/context.md
data/context/schema.json
data/context/policy.json
data/sessions/*.json
```

Local smoke-test data may appear under `data/context/`, `data/sessions/`, and `data/exports/*.csv`. These paths are ignored and can be cleaned between runs. Keep `data/exports/.gitkeep`.

Frontend local state:

- Native Linux Node and pnpm were installed in Fedora WSL with `sudo dnf install -y nodejs pnpm`.
- Avoid Windows Node/npm shims from `/mnt/c/...`; package install scripts can fail on UNC paths.
- `packageManager` is pinned to `pnpm@10.33.2`.
- `vitest` is pinned at `^3.2.4` so frontend test tooling uses the same Vite major version as the app.
- shadcn is configured with `components.json`, `@/` import aliases, Tailwind v4 theme tokens, and Vite/Vitest alias config.
- The frontend was migrated to the shadcn preset `b1YnRGLNA` on 2026-05-02: nova style, zinc base, blue theme, Inter font, lucide icons.
- The community `shadcn-chat` registry components were removed. Keep the chat surface composed from official shadcn primitives in `src/components/ui` unless a concrete need appears.
- See `docs/dependency-audit.md` for the latest dependency and framework review.
- Latest dependency refresh on 2026-05-02 raised direct backend/frontend tooling lower bounds to current resolved versions. Pydantic is intentionally held at `>=2.12.5` because LiteLLM 1.83.7 pins `pydantic==2.12.5`; do not force Pydantic 2.13 until LiteLLM relaxes that pin.
- `agent-browser install` and `agent-browser install --with-deps` were run so browser screenshots work in this Fedora WSL environment. This installed managed Chrome plus Linux browser dependencies.
- CodeRabbit CLI is installed at `/home/Joseph/.local/bin/coderabbit` and authenticated for agent review.

Git sync:

- The directory is a Git repository.
- Current branch: `main`.
- Tracking branch: `origin/main`.
- Remote: `https://github.com/Joseph2xy/y.git`.
- Last checked local state: worktree has the session-status cleanup, Postgres timeout fix, local demo mock server, frontend workflow layout adjustments, tests, and this handoff update.

## Next Step

The first end-to-end local demo path works.

Recommended next scope:

1. Add an integration test or scripted smoke test for the local Postgres demo path.
2. Decide whether request/response is enough for V0 progress or whether SSE is needed.
3. Improve audit/debug trace persistence if the demo reveals a need.
4. Keep SQL and validation traces behind Advanced/debug UI.

Do not add a worker, queue, scheduling, frontend dashboard shell, LangChain, or LlamaIndex for this step.

## Left For V0

- SSE or polling decision for progress/events.
- Integration test against a real or containerized Postgres database.
- Better audit/debug trace storage.
- Decision on export expiry.
- Decision on whether SQL can be shown or edited in Advanced mode.
- Decide whether uploaded example CSVs belong in V0. They are not implemented now.
