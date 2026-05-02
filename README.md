# CSV Chat

A small local app for generating CSV exports from a Postgres database through a constrained chat flow.

The model helps interpret the user's request and propose SQL. The app owns the database connection, SQL guardrails, read-only execution limits, CSV writing, and final download.

## Docs

- `AGENTS.md`: working rules for coding agents.
- `CONTEXT.md`: canonical product vocabulary.
- `docs/architecture.md`: canonical V0 product, stack, safety, and API shape.
- `docs/decisions.md`: resolved V0 decisions and revisit triggers.
- `docs/implementation-status.md`: current status, next step, and new-session handoff.
- `docs/example-requests.md`: sample user requests for prompt and flow testing.

## Shape

```text
Browser or API client
  -> FastAPI app
      -> editable context files
      -> LiteLLM model provider adapter
      -> Postgres schema/read tools
      -> SQL guard
      -> CSV writer
```

There is no separate worker, queue, scheduler, or approval workflow in this version.

## Flow

1. Scan Postgres metadata.
2. Write `data/context/schema.json` and `data/context/context.md`.
3. User asks for a CSV.
4. Model asks for clarification only when needed.
5. Model proposes a user-facing CSV plan.
6. User approves the CSV intent once.
7. App asks the model for SQL.
8. App validates the SQL, including output fields against the approved CSV intent.
9. If needed, the app gives structured validation errors back to the model for a limited repair loop.
10. App executes with read-only settings and limits.
11. App validates and writes the CSV.
12. App returns a download link.

## Local Setup

Backend:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[test]'
.venv/bin/python -m pytest -q
```

Run the API:

```bash
.venv/bin/python -m uvicorn app.main:app --reload
```

Create a local `.env` first:

```bash
cp .env.example .env
```

Then edit `.env`:

```bash
DATABASE_URL=postgresql://readonly:password@localhost:5432/appdb
WORKER_LLM_PROVIDER=openrouter
WORKER_OPENROUTER_MODEL=nvidia/nemotron-3-super-120b-a12b:free
OPENROUTER_API_KEY=...
MODEL_TEMPERATURE=0
```

`DATABASE_URL` should point to a read-only Postgres user. The real `.env` file is ignored by git.

Frontend:

```bash
pnpm install
pnpm test
pnpm build
pnpm dev
```

The Vite dev server proxies API calls to `http://127.0.0.1:8000`.

The frontend uses official shadcn/ui primitives. The app should stay compact, centered, dark by default, and chat-first. Workflow controls should appear only when useful.

On WSL, use native Linux Node and pnpm. Avoid the Windows `node.exe`/npm shims from `/mnt/c/...`; package install scripts can fail on UNC paths. On Fedora WSL, this works:

```bash
sudo dnf install -y nodejs pnpm
```

## Current Status

The current handoff and next steps live in `docs/implementation-status.md`.

As of the latest update, the backend model harness, bounded SQL preparation/repair loop, compact shadcn-based React/Vite chat frontend, and first real end-to-end local Postgres demo are implemented and tested. A repeatable Postgres smoke script is available at `tools/postgres_smoke.py`.
