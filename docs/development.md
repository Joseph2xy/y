# Development

This guide is for contributors working on CSV Chat.

## Project Shape

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

There is no worker, queue, scheduler, or separate execution service in V0.

## Commands

Install dependencies:

```bash
./tools/setup_local.sh
```

Run backend and frontend together:

```bash
pnpm dev:app
```

Run separately:

```bash
.venv/bin/python -m uvicorn app.main:app --reload
pnpm dev
```

The Vite dev server proxies API calls to `http://127.0.0.1:8000`.

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

Run the local setup check:

```bash
pnpm check:setup
```

Rescan context after changing `DATABASE_URL`:

```bash
pnpm rescan:context
```

The rescan updates `schema.json`, including sanitized database source metadata, preserves `policy.json`, and preserves edited `context.md` notes.

Optional local Postgres smoke test:

```bash
.venv/bin/python tools/postgres_smoke.py
```

On this Fedora WSL machine, local peer auth has worked with:

```bash
.venv/bin/python tools/postgres_smoke.py --admin-url 'postgresql:///postgres'
```

Optional real-provider calibration:

```bash
.venv/bin/python tools/realistic_calibration.py
.venv/bin/python tools/finance_calibration.py
```

Do not print secrets, database credentials, or final CSV contents from calibration scripts.

## API Types

Regenerate frontend API types after changing FastAPI response/request models:

```bash
pnpm generate:api-types
```

This writes:

```text
.openapi/openapi.json
src/api-types.ts
```

`.openapi/` is ignored by git.

## Reference Docs

- `AGENTS.md`: working rules for coding agents
- `CONTEXT.md`: product vocabulary
- `docs/architecture.md`: V0 architecture and safety shape
- `docs/decisions.md`: resolved V0 decisions
- `docs/implementation-status.md`: current status and next handoff
- `docs/example-requests.md`: behavior examples
- `docs/flow.excalidraw`: editable process diagram
- `docs/agents/memory.md`: lightweight agent memory
