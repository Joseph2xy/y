# Agent Memory

Lightweight working memory for coding agents. Keep this short; detailed current status belongs in `docs/implementation-status.md`.

## Current Focus

The app is a local V0 CSV Chat product: chat -> context -> approved CSV plan -> validated SQL -> read-only execution -> CSV download.

Recent direction from product discussion:

- Keep V0 dynamic enough for custom labels and derived columns.
- Approved CSV plan labels own final CSV headers.
- SQL/query results must match the approved plan by output count and order.
- Direct `source_hint` values are validated by output position when present.
- Derived columns can have no direct source hint.
- CSV-plan approval is terminal for chat in the current V0 run: hide chat immediately, show artifact progress, create the CSV automatically after validation passes, keep the artifact/download visible, and use Start over for changes or another CSV.
- Do not add a query compiler or broad semantic layer unless calibration shows the raw-SQL validation approach is not enough.

## Recently Completed

- Pruned active Markdown docs by removing the duplicated first-run guide and dated calibration report.
- Updated doc references so README, troubleshooting, development, implementation status, architecture, decisions, examples, and memory each have a distinct job.
- Fixed source-hint validation for table aliases in selected expressions, including aggregates and date expressions.
- Allowed `COUNT(*)` for count columns while continuing to reject `SELECT *` and `table.*`.
- Sanitized model-provided `source_hint` values so formula/count/prose hints become derived/unknown instead of invalid direct sources.
- Made approved CSV labels the final export headers and rewrote query result rows by position during export.
- Updated SQL/repair prompts to require output count/order rather than exact SQL alias text.
- Added `tools/local_db.py` and `pnpm db:*` commands for a persistent local Postgres test cluster under `~/.local/share/csv-chat-pg`.
- Removed the old Postgres smoke script and mock OpenAI-compatible server after moving demo database seeding into `tools/local_db.py`.
- Removed the post-export summary card, removed the manual post-validation Create CSV action, and made approval hide chat immediately while the artifact shows progress through Download CSV plus Start over actions.
- Hardened `tools/setup_local.sh` for fresh WSL setup: it now rejects `sudo`, checks Node 20.19+, and uses Corepack to activate the pnpm version pinned by `package.json`.
- Added `pnpm run doctor` and `pnpm db:test-url` for plain-language local setup and database URL diagnosis, and made rescan/setup database failures avoid raw tracebacks.
- Added `pnpm db:import` as the preferred Windows real-data path: export a pgAdmin/Postgres backup, import it into the local WSL Postgres cluster, create a read-only CSV Chat user, write `.env`, then rescan context.

## Last Verification

Last documented verification on 2026-05-05:

```text
.venv/bin/python -m pytest -q -> 151 passed
.venv/bin/python -m compileall -q app tests tools -> passed
bash -n tools/setup_local.sh -> passed
pnpm db:import --help -> passed
pnpm test -> 13 passed
pnpm build -> passed
```

## Next Step

Decide whether the remaining behavior question deserves a V0 change:

- limited CTE source lineage for simple CTE projections
