# CSV Chat

CSV Chat is a local app for generating a validated CSV from a Postgres database.

You describe the CSV in plain language. The app scans your database context, proposes a CSV plan for approval, generates SQL internally, validates it, runs it with read-only limits, and gives you a CSV download.

The model never receives database credentials and never executes SQL directly.

## Recommended Setup

Linux or Windows with WSL.

Prerequisites:

- Python 3.11 or newer
- Node.js and pnpm
- access to a Postgres database through a read-only user
- an OpenRouter API key, or a custom OpenAI-compatible model endpoint

For Windows, install WSL and run these commands inside the Linux shell. Keep the repo inside the WSL filesystem, such as `~/code/csv-chat`, instead of under `/mnt/c/...`.

## First Run

Install dependencies and create `.env` if it does not exist:

```bash
./tools/setup_local.sh
```

Edit `.env` with your database and model provider settings:

```text
DATABASE_URL=postgresql://readonly:password@localhost:5432/appdb
WORKER_LLM_PROVIDER=openrouter
WORKER_OPENROUTER_MODEL=openrouter/openai/gpt-4o-mini
OPENROUTER_API_KEY=your-api-key
MODEL_TEMPERATURE=0
```

Check whether the app is ready:

```bash
pnpm check:setup
```

Start the app:

```bash
pnpm dev:app
```

Open:

```text
http://127.0.0.1:5173
```

The backend runs on `http://127.0.0.1:8000`.

## Everyday Use

After setup is complete:

```bash
pnpm check:setup
pnpm dev:app
```

If setup is not ready, `pnpm check:setup` prints the next required action.

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
