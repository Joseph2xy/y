# Troubleshooting

## `pnpm check:setup` Says Database Is Not Configured

Edit `.env` and set:

```text
DATABASE_URL=postgresql://readonly:password@localhost:5432/appdb
```

Restart `pnpm dev:app` after changing `.env`.

## Database Connection Fails

If `pnpm check:setup` reports `configured=True`, `.env` has a `DATABASE_URL`, but the app cannot connect to it. For example, `Connection refused` on `127.0.0.1:5432` usually means Postgres is not running there, is listening on a different port, or the database is outside WSL.

Check:

- the database host and port are reachable from this machine or WSL
- the username and password are correct
- the database name exists
- the user can connect and read schema metadata
- the user is read-only for normal tables

Use a read-only database user. Do not use an admin account.

## Model Provider Is Not Configured

For OpenRouter, set:

```text
WORKER_LLM_PROVIDER=openrouter
WORKER_OPENROUTER_MODEL=openrouter/openai/gpt-4o-mini
OPENROUTER_API_KEY=your-api-key
MODEL_TEMPERATURE=0
```

For a custom OpenAI-compatible endpoint, set:

```text
MODEL_NAME=openai/gpt-4.1-mini
MODEL_API_KEY=your-api-key
MODEL_BASE_URL=http://127.0.0.1:4010/v1
MODEL_TEMPERATURE=0
```

## Context Is Not Ready

Context is generated from the connected database. If the database and provider are ready, run:

```bash
pnpm dev:app
```

Then open `http://127.0.0.1:5173` and let the setup screen prepare the app.

## I Changed `DATABASE_URL`

The app stores sanitized scan metadata in `data/context/schema.json`: database name, host, port, and scan time. It does not store database credentials there.

After changing `DATABASE_URL`, run:

```bash
pnpm check:setup
```

If the app reports that context was scanned from a different database, use the setup screen's rescan button or run:

```bash
pnpm rescan:context
```

This updates `data/context/schema.json` from the new database and preserves your existing `context.md` and `policy.json`.

Review `data/context/context.md` after the rescan. If it contains notes for the old database, edit or remove them.

For a completely fresh generated context, delete the old files:

```bash
rm -f data/context/context.md data/context/schema.json data/context/policy.json
```

Then run `pnpm dev:app` and let setup prepare context again.

## Windows Notes

Use WSL for now. Keep the repo in the WSL filesystem, such as:

```text
~/code/csv-chat
```

Avoid running from:

```text
/mnt/c/...
```

Native Windows PowerShell setup is not first-class yet.

## Port Already In Use

`pnpm dev:app` starts:

- backend: `http://127.0.0.1:8000`
- frontend: `http://127.0.0.1:5173`

Stop the process using the port, or run backend/frontend separately with custom ports.

## Reset Local Runtime Data

To remove generated sessions and exports:

```bash
rm -f data/sessions/*.json data/exports/*.csv
```

Keep `data/exports/.gitkeep`.

To regenerate database context, remove:

```bash
rm -f data/context/context.md data/context/schema.json data/context/policy.json
```

Then run the app setup again.
