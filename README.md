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
      -> model harness
      -> Postgres schema/read tools
      -> SQL guard
      -> CSV writer
```

There is no separate worker, queue, scheduler, or approval workflow in this version.

## Flow

1. Scan Postgres metadata.
2. Write `data/context/schema.json` and `data/context/context.md`.
3. User asks for a CSV.
4. Model proposes a CSV intent.
5. User approves the intent.
6. App asks the model for an export query.
7. App validates the query, including output fields against the approved CSV intent.
8. If needed, the app gives structured validation errors back to the model for a limited repair loop.
9. App executes with read-only settings and limits.
10. App validates and writes the CSV.

## Local Setup

Backend:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[test]'
.venv/bin/python -m pytest -q
```

Run the API:

```bash
DATABASE_URL='postgresql://readonly:password@localhost:5432/appdb' \
.venv/bin/python -m uvicorn app.main:app --reload
```

`DATABASE_URL` should point to a read-only Postgres user.

Model endpoints can be configured in the app with an OpenRouter API key, or through environment variables:

```bash
MODEL_NAME='openrouter/openai/gpt-4o-mini'
MODEL_API_KEY='...'
# Optional:
MODEL_BASE_URL='https://openrouter.ai/api/v1'
MODEL_TEMPERATURE='0'
```

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
