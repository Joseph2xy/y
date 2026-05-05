# Development

This guide is for contributors working on CSV Chat.

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

## Local Test Databases

For manual development, use the persistent local Postgres cluster:

```bash
pnpm db:start
pnpm db:seed
pnpm db:status
pnpm db:urls
```

The cluster lives under `~/.local/share/csv-chat-pg` and survives restarts. `pnpm db:seed` drops and recreates the disposable local test databases:

- `csv_chat_demo`: small accounts/customers smoke-test database.
- `csv_chat_retail_calibration`: retail orders, products, customers, and support tickets.
- `csv_chat_finance_calibration`: customers, invoices, invoice lines, payments, and refunds.
- `csv_chat_saas_complex_calibration`: SaaS accounts, subscriptions, invoices, usage, feature events, support, and health snapshots.
- `csv_chat_marketplace_complex_calibration`: marketplace sellers, buyers, products, orders, shipments, returns, refunds, and reviews.

Copy a `DATABASE_URL` from `pnpm db:urls` into `.env`, then run:

```bash
pnpm rescan:context
pnpm dev:app
```

Stop the local server with:

```bash
pnpm db:stop
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

Run the local setup check:

```bash
pnpm check:setup
```

Rescan context after changing `DATABASE_URL`:

```bash
pnpm rescan:context
```

The rescan updates `schema.json`, including sanitized database source metadata, preserves `policy.json`, and preserves edited `context.md` notes.

Optional local Postgres smoke test, after `pnpm db:start`:

```bash
.venv/bin/python tools/postgres_smoke.py --admin-url 'postgresql://postgres@127.0.0.1:5432/postgres'
```

Optional real-provider calibration:

```bash
.venv/bin/python tools/realistic_calibration.py
.venv/bin/python tools/finance_calibration.py
.venv/bin/python tools/complex_calibration.py
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
