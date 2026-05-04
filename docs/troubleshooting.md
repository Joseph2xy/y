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

Run `pnpm dev:app`, open Settings, and save OpenCode Zen, OpenAI, OpenRouter, or custom OpenAI-compatible provider settings.

Provider settings are stored locally under:

```text
data/settings/model_provider.json
```

The app does not fall back to model provider values in `.env`. If this file is missing or has no saved API key, setup reports that the model provider is not configured.

OpenCode Zen free models can be saved without an API key.

## Model Provider Says Rate Limit Or Quota Exceeded

The app reached the provider, but the selected account or model cannot serve another request right now.

For OpenRouter free models, this can look like:

```text
429 RateLimitError
Rate limit exceeded: free-models-per-day
```

Fix options:

- wait for the quota reset
- choose another model in Settings
- add provider credits or use a paid model
- use a custom OpenAI-compatible endpoint that has capacity

After changing provider settings, try the request again.

## Context Is Not Ready

Context is generated from the connected database. If the database and provider are ready, run:

```bash
pnpm dev:app
```

Then open `http://127.0.0.1:5173` and let the setup screen prepare the app.

## I Changed `DATABASE_URL`

After changing `DATABASE_URL`, run:

```bash
pnpm check:setup
```

If the app reports that context was scanned from a different database, use the setup screen's rescan button or run:

```bash
pnpm rescan:context
```

This updates `data/context/schema.json` from the new database and preserves your existing `context.md` and `policy.json`.

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
