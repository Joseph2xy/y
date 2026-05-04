# CSV Chat

CSV Chat is a local app that turns a plain-language request into a validated CSV download from Postgres.

The app scans database context, proposes a CSV plan for you to approve, generates SQL internally, validates it, runs it with read-only limits, and writes the CSV. The model never receives database credentials and never executes SQL directly.

## Quick Start

Use Linux or Windows with WSL. On Windows, keep the repo inside the WSL filesystem, such as `~/code/csv-chat`, not under `/mnt/c/...`.

You need:

- Python 3.11 or newer
- Node.js and pnpm
- a Postgres database and a read-only database user
- an OpenAI API key, an OpenRouter API key, or a custom OpenAI-compatible model endpoint

Run setup:

```bash
./tools/setup_local.sh
```

Edit `.env` and set your read-only database URL:

```text
DATABASE_URL=postgresql://readonly:password@localhost:5432/appdb
```

Start the app:

```bash
pnpm dev:app
```

Open:

```text
http://127.0.0.1:5173
```

In the app:

1. Open Settings.
2. Save your model provider.
3. Use the setup screen to scan the database and prepare context.
4. Start a chat and ask for a CSV.

To check readiness at any time:

```bash
pnpm check:setup
```

If setup is not ready, the command prints the next required action.

## Everyday Use

After setup is complete:

```bash
pnpm dev:app
```

Open `http://127.0.0.1:5173`.

Database credentials stay in `.env`. Model provider settings are edited in the app and saved locally under `data/settings/model_provider.json`.

## Database Changes

First run creates the local context files when they are missing. After that, the app treats those files as local editable state.

If you change `DATABASE_URL` to a different database, the app will warn that context was scanned from a different database and ask for a rescan. You can rescan from the setup screen or run:

```bash
pnpm rescan:context
```

This updates `data/context/schema.json` from the new database and preserves your existing `policy.json`. It also preserves `context.md` if you have edited it, because that file may contain your own business notes. Review `context.md` after switching databases and remove old notes that no longer apply.

## Local Files

These files are local runtime data and are ignored by git:

```text
.env
data/context/context.md
data/context/schema.json
data/context/policy.json
data/settings/model_provider.json
data/sessions/*.json
data/exports/*.csv
```

`context.md` and `policy.json` are local editable context and safety files. CSV exports are written under `data/exports/`.

## More Help

- [Local user guide](docs/local-user-guide.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Development guide](docs/development.md)
- [Current implementation status](docs/implementation-status.md)
