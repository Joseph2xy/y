# CSV Chat

CSV Chat is a local app that turns a plain-language request into a validated CSV download from Postgres.

The app scans database context, proposes a CSV plan for you to approve, generates SQL internally, validates it, runs it with read-only limits, and writes the CSV. The model never receives database credentials and never executes SQL directly.

## Quick Start

Use Linux or Windows with WSL. On Windows, keep the repo inside the WSL filesystem, such as `~/code/csv-chat`, not under `/mnt/c/...`.

You need:

- Python 3.11 or newer
- Node.js 20.19 or newer. pnpm is activated through Corepack during setup.
- an OpenCode Zen free model, an OpenAI API key, an OpenRouter API key, or a custom OpenAI-compatible model endpoint
- PostgreSQL tools in WSL when you are ready to use local demo data or import a real pgAdmin backup

Run setup:

```bash
./tools/setup_local.sh
```

Run the setup script as your normal WSL user, not with `sudo`.

For a first run, use the built-in local demo database so you can verify the app before connecting real data:

```bash
pnpm db:start
pnpm db:seed
pnpm db:urls
```

Copy one printed `DATABASE_URL=...` line into `.env`, then check it:

```bash
pnpm db:test-url
```

For real data from Postgres on Windows, use pgAdmin to create a backup, then import that backup into CSV Chat's local WSL Postgres:

```bash
pnpm db:import /mnt/c/Users/YOU/Downloads/app.backup app_copy
```

`pnpm db:import` starts the local WSL Postgres server if needed, creates or replaces `app_copy`, restores the backup, creates a read-only CSV Chat user, writes the working `DATABASE_URL` to `.env`, and prints the next commands. It supports pgAdmin custom-format backups such as `.backup` or `.dump`; plain `.sql` dumps are also accepted, but custom-format backups are more reliable.

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
pnpm run doctor
```

If setup is not ready, these commands print the next required action.

## Everyday Use

After setup is complete:

```bash
pnpm dev:app
```

Open `http://127.0.0.1:5173`.

Database credentials stay in `.env`. For Windows users, the recommended real-data path is to import a pgAdmin backup into the local WSL Postgres server with `pnpm db:import`; this avoids Windows Firewall, WSL host IP, `listen_addresses`, and `pg_hba.conf` setup. Model provider settings are edited in the app and saved locally under `data/settings/model_provider.json`.

## Database Changes

First run creates the local context files when they are missing. After that, the app treats those files as local editable state.

If you change `DATABASE_URL` to a different database, the app will warn that context was scanned from a different database and ask for a rescan. You can rescan from the setup screen or run:

```bash
pnpm rescan:context
```

This updates `data/context/schema.json` from the new database and preserves your existing `policy.json`. It also preserves `context.md` if you have edited it, because that file may contain your own business notes. Review `context.md` after switching databases and remove old notes that no longer apply.

## Local Test Databases

For local manual testing, you can run a persistent Postgres test cluster under `~/.local/share/csv-chat-pg`. This is the easiest way to prove the app works before connecting your own database.

```bash
pnpm db:start
pnpm db:seed
pnpm db:status
pnpm db:urls
```

`pnpm db:start` initializes and starts the local Postgres server if needed. `pnpm db:seed` drops and recreates the disposable CSV Chat test databases:

- `csv_chat_demo`: small accounts/customers smoke-test database.
- `csv_chat_retail_calibration`: retail orders, products, customers, and support tickets.
- `csv_chat_finance_calibration`: customers, invoices, invoice lines, payments, and refunds.
- `csv_chat_saas_complex_calibration`: SaaS accounts, subscriptions, invoices, usage, feature events, support, and health snapshots.
- `csv_chat_marketplace_complex_calibration`: marketplace sellers, buyers, products, orders, shipments, returns, refunds, and reviews.

Copy one of the `DATABASE_URL` values from `pnpm db:urls` into `.env`, then run:

```bash
pnpm rescan:context
pnpm dev:app
```

Stop the local server with:

```bash
pnpm db:stop
```

## Import A Windows pgAdmin Database

The simplest Windows path is to work from a local WSL copy of your database:

1. In pgAdmin on Windows, right-click the database.
2. Choose Backup.
3. Use the custom format when available, and save the file somewhere under your Windows user folder, such as Downloads.
4. In WSL, import it:

```bash
pnpm db:import /mnt/c/Users/YOU/Downloads/app.backup app_copy
```

Replace `YOU` with your Windows username and `app_copy` with the local database name you want. Use letters, numbers, and underscores for the local database name.

After import:

```bash
pnpm db:test-url
pnpm rescan:context
pnpm dev:app
```

This local copy is what CSV Chat reads. It is not a live connection to the Windows Postgres server. Re-run `pnpm db:import ...` when you need a fresh copy.

## Advanced: Windows pgAdmin Database From WSL

If the database is open in pgAdmin on Windows and this app is running in WSL, gather the connection details in pgAdmin:

1. In pgAdmin, right-click the server and open Properties.
2. Note the host, port, and username.
3. Use the target database name from the Databases list.
4. Use a read-only user when possible.

In WSL, find the Windows host IP:

```bash
ip route | awk '/default/ {print $3}'
```

Use that IP in `.env` instead of `localhost`:

```text
DATABASE_URL=postgresql://readonly:password@WINDOWS_HOST_IP:5432/appdb
```

Then test:

```bash
pnpm db:test-url
```

If the test times out, allow inbound TCP `5432` in Windows Firewall and make sure Windows Postgres is listening for non-localhost connections. In Postgres, that usually means `listen_addresses = '*'` plus a `pg_hba.conf` rule for the WSL subnet.

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

- [Troubleshooting](docs/troubleshooting.md)
- [Development guide](docs/development.md)
- [Current implementation status](docs/implementation-status.md)
- [Calibration notes](docs/calibration-notes.md)
