# CSV Chat

A small local app for generating CSV exports from a Postgres database through a constrained chat flow.

The model helps interpret the user's request and propose SQL. The app owns the database connection, SQL guardrails, read-only execution limits, CSV writing, and final download.

## Docs

- `AGENTS.md`: working rules for coding agents.
- `docs/architecture.md`: canonical V0 product, stack, safety, and API shape.
- `docs/implementation-status.md`: current status, next step, and new-session handoff.
- `docs/example-requests.md`: sample user requests for prompt and flow testing.
- `docs/open-questions.md`: decisions to make with evidence during implementation.

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

Model endpoints also use:

```bash
MODEL_NAME='openai/gpt-4.1-mini'
MODEL_API_KEY='...'
# Optional:
MODEL_BASE_URL='https://...'
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

On WSL, use native Linux Node and pnpm. Avoid the Windows `node.exe`/npm shims from `/mnt/c/...`; package install scripts can fail on UNC paths. On Fedora WSL, this works:

```bash
sudo dnf install -y nodejs pnpm
```

## Current Status

The current handoff and next steps live in `docs/implementation-status.md`.

As of the latest update, the backend model harness, bounded SQL preparation/repair loop, and first minimal React/Vite frontend are implemented and tested. The next milestone is a real end-to-end local demo against Postgres and a configured model provider.
