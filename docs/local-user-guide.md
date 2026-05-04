# Local User Guide

This guide is for someone trying CSV Chat locally for the first time.

## Before You Start

Use Linux or Windows with WSL.

You need:

- Python 3.11 or newer
- Node.js and pnpm
- Postgres access through a read-only database user
- an OpenAI API key, an OpenRouter API key, or a custom OpenAI-compatible model endpoint

On Windows, run everything inside WSL and keep the repo in the Linux filesystem, such as `~/code/csv-chat`. Avoid `/mnt/c/...`.

## Setup Checklist

1. Install dependencies:

```bash
./tools/setup_local.sh
```

The script:

- creates `.venv` if needed
- installs Python dependencies
- installs frontend dependencies
- copies `.env.example` to `.env` if `.env` does not already exist

It does not install system packages and does not overwrite an existing `.env`.

2. Edit `.env`:

```text
DATABASE_URL=postgresql://readonly:password@localhost:5432/appdb
```

Use a read-only Postgres user. Do not use an admin database account.

3. Start the app:

```bash
pnpm dev:app
```

4. Open:

```text
http://127.0.0.1:5173
```

5. Open Settings and save your model provider.

6. Use the setup screen to prepare database context.

7. Ask for a CSV in chat, review the CSV plan, approve it, and download the export.

## Check Setup

Run this any time you are not sure what is missing:

```bash
pnpm check:setup
```

The check reports whether these are ready:

- database configuration and connection
- model provider configuration
- generated database context

If something is missing, it prints the next action.

Context generation only happens when context files are missing or when you explicitly rescan. Once context exists, the app treats it as local editable state and does not replace it on startup.

The app stores the database name, host, port, and scan time in `schema.json`. It does not store database credentials there.

## Everyday Startup

After the first setup:

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

## Changing Database

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

6. Start the app:

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

## Changing Provider

Use Settings -> Model Provider.

Provider settings saved through the app live at:

```text
data/settings/model_provider.json
```

API responses never return the saved API key.

## Settings

The app Settings tab is split by responsibility:

- Database shows connection/context status, lets you test the current connection, and lets you rescan context. `DATABASE_URL` stays in the backend `.env` file for V0.
- Model Provider can save OpenAI, OpenRouter, or custom OpenAI-compatible provider settings locally.

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
