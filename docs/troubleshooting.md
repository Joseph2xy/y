# Troubleshooting

## `pnpm check:setup` Says Database Is Not Configured

For demo data, start and seed the local WSL Postgres server:

```bash
pnpm db:start
pnpm db:seed
pnpm db:urls
```

Then copy one printed `DATABASE_URL` value into `.env`.

For real data from Windows pgAdmin, create a pgAdmin backup and import it into the local WSL Postgres server:

```bash
pnpm db:import /mnt/c/Users/YOU/Downloads/app.backup app_copy
```

The import command writes a working `DATABASE_URL` to `.env` by default.

For advanced/manual setup, edit `.env` and set:

```text
DATABASE_URL=postgresql://readonly:password@localhost:5432/appdb
```

Restart `pnpm dev:app` after changing `.env`.

## Importing A Windows pgAdmin Backup

The recommended Windows path is to import a local copy into WSL Postgres instead of connecting from WSL to Windows Postgres over TCP.

In pgAdmin on Windows:

1. Right-click the database.
2. Choose Backup.
3. Prefer custom format, which usually creates a `.backup` file.
4. Save it under your Windows user folder, such as Downloads.

In WSL:

```bash
pnpm db:import /mnt/c/Users/YOU/Downloads/app.backup app_copy
pnpm db:test-url
pnpm rescan:context
```

Use letters, numbers, and underscores for the local database name. The command creates or replaces that local database, restores the backup, creates a read-only CSV Chat user, and updates `.env`.

If the import fails because of missing roles or ownership statements, create a custom-format pgAdmin backup and import that file. CSV Chat runs `pg_restore` with `--no-owner --no-acl` for custom-format backups.

If the import fails because an extension is missing, install the matching Postgres extension package in WSL or remove that extension from the copied database if it is not needed for CSV exports.

## Database Connection Fails

If `pnpm check:setup` reports `configured=True`, `.env` has a `DATABASE_URL`, but the app cannot connect to it. For example, `Connection refused` on `127.0.0.1:5432` usually means Postgres is not running there, is listening on a different port, or the database is outside WSL.

Run the focused database URL check:

```bash
pnpm db:test-url
```

For a broader local setup check, run:

```bash
pnpm run doctor
```

If you are using the built-in local test databases, start them and check status:

```bash
pnpm db:start
pnpm db:status
```

Check:

- the database host and port are reachable from this machine or WSL
- the username and password are correct
- the database name exists
- the user can connect and read schema metadata
- the user is read-only for normal tables

Use a read-only database user. Do not use an admin account.

## Advanced: Windows pgAdmin Database From WSL

If the database is open in pgAdmin on Windows and this app is running in WSL, `localhost` inside `.env` usually points to WSL, not Windows.

Find the Windows host IP from WSL:

```bash
ip route | awk '/default/ {print $3}'
```

Use that IP in `.env`:

```text
DATABASE_URL=postgresql://readonly:password@WINDOWS_HOST_IP:5432/appdb
```

Then run:

```bash
pnpm db:test-url
```

If it times out:

- allow inbound TCP `5432` in Windows Firewall
- set Postgres `listen_addresses = '*'`
- add a `pg_hba.conf` rule for the WSL subnet, such as `172.16.0.0/12`
- restart PostgreSQL on Windows

If it reports `no pg_hba.conf entry`, the network path works but Postgres access rules still need to allow that WSL host/user/database.

## Local Test Databases Are Missing

The built-in local test databases live inside one persistent Postgres cluster under:

```text
~/.local/share/csv-chat-pg
```

If `pnpm db:status` shows the server is running but no `csv_chat_*` databases are listed, seed them:

```bash
pnpm db:seed
```

This drops and recreates the disposable local test databases. It does not affect external databases.

If the server is stopped:

```bash
pnpm db:start
```

If you need to stop it:

```bash
pnpm db:stop
```

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
