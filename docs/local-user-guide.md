# Local User Guide

This guide is for someone cloning the repo to try or use CSV Chat locally.

## What You Need

- Linux, or Windows with WSL
- Python 3.11 or newer
- Node.js and pnpm
- Postgres access through a read-only database user
- an OpenRouter API key, or a custom OpenAI-compatible model endpoint

For Windows, use WSL and run the app from the Linux filesystem. Avoid running the repo from `/mnt/c/...`; Node package scripts can fail there.

## First-Time Setup

Run:

```bash
./tools/setup_local.sh
```

The script:

- creates `.venv` if needed
- installs Python dependencies
- installs frontend dependencies
- copies `.env.example` to `.env` if `.env` does not already exist

It does not install system packages and does not overwrite an existing `.env`.

Edit `.env`:

```text
DATABASE_URL=postgresql://readonly:password@localhost:5432/appdb
WORKER_LLM_PROVIDER=openrouter
WORKER_OPENROUTER_MODEL=openrouter/openai/gpt-4o-mini
OPENROUTER_API_KEY=your-api-key
MODEL_TEMPERATURE=0
```

Use a read-only Postgres user. Do not use an admin database account.

## Check Setup

Run:

```bash
pnpm check:setup
```

The check covers:

- database configuration and connection
- model provider configuration
- generated database context

If context is missing but the database and provider are configured, start the app and it will prepare context automatically. You can also run `pnpm dev:app` and use the setup screen.

This automatic generation only happens when the context files are missing. Once context exists, the app assumes it is local editable state and does not replace it on startup.

The app stores the database name, host, port, and scan time in `schema.json`. It does not store database credentials there.

## Run The App

Run:

```bash
pnpm dev:app
```

Open:

```text
http://127.0.0.1:5173
```

The backend API runs on:

```text
http://127.0.0.1:8000
```

## Everyday Startup

After the first setup:

```bash
pnpm check:setup
pnpm dev:app
```

## Changing Database Or Provider

To change the database:

1. Stop the app if it is running.
2. Edit `DATABASE_URL` in `.env`.
3. Run `pnpm check:setup`.
4. If the app reports that context was scanned from a different database, rescan from the setup screen or run:

```bash
pnpm rescan:context
```

5. Review:

```text
data/context/context.md
data/context/policy.json
```

6. Start the app again:

```bash
pnpm dev:app
```

`pnpm rescan:context` updates `data/context/schema.json` from the current `DATABASE_URL`. It preserves `policy.json`. It also preserves `context.md` if you have edited it, because that file may contain your own business notes.

If you want a completely fresh generated context for the new database, delete the old context files first:

```bash
rm -f data/context/context.md data/context/schema.json data/context/policy.json
```

Then run:

```bash
pnpm dev:app
```

The setup screen will regenerate context from the new database.

To change the provider, either edit `.env` or use the setup screen when provider setup is incomplete. Provider settings saved through the app live at:

```text
data/settings/model_provider.json
```

API responses never return the saved API key.

## Local Data

CSV Chat writes local runtime data under `data/`:

```text
data/context/context.md
data/context/schema.json
data/context/policy.json
data/settings/model_provider.json
data/sessions/*.json
data/exports/*.csv
```

These files are ignored by git. Delete old sessions or exports when you no longer need them.

## Model Provider Boundary

The model provider receives the chat request and generated database context. It does not receive database credentials. Final CSV contents are not sent back to the model by default.

If your provider is external, generated context may leave your machine. Review `data/context/context.md` and `data/context/policy.json` before using sensitive databases.
