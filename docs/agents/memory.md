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
- Do not add a query compiler or broad semantic layer unless calibration shows the raw-SQL validation approach is not enough.

## Recently Completed

- Added complex calibration for disposable SaaS/product-analytics and marketplace/ecommerce schemas.
- Fixed source-hint validation for table aliases in selected expressions, including aggregates and date expressions.
- Allowed `COUNT(*)` for count columns while continuing to reject `SELECT *` and `table.*`.
- Sanitized model-provided `source_hint` values so formula/count/prose hints become derived/unknown instead of invalid direct sources.
- Made approved CSV labels the final export headers and rewrote query result rows by position during export.
- Updated SQL/repair prompts to require output count/order rather than exact SQL alias text.
- Cleaned docs so `docs/implementation-status.md` is the current handoff and this file stays concise.
- Calibrated OpenCode Zen free models through the app's `/zen/v1` adapter; `big-pickle` is the current recommended free model.
- Ran a banking-adjacent disposable-schema calibration with `big-pickle`: 9/10 clean in the full run, then the flagged open-card-dispute scenario passed on focused rerun.
- Added `tools/local_db.py` and `pnpm db:*` commands for a persistent local Postgres test cluster under `~/.local/share/csv-chat-pg`.

## Last Verification

On 2026-05-04 before OpenCode Zen calibration:

```text
.venv/bin/python -m pytest -q -> 145 passed
.venv/bin/python -m compileall -q app tests tools -> passed
.venv/bin/python tools/model_eval.py -> passed
```

Frontend was not rerun for the approved-header backend change. Last documented frontend verification was `pnpm test` and `pnpm build` passing on 2026-05-03.

On 2026-05-05 for local DB helper:

```text
pnpm db:start -> initialized persistent local cluster and started Postgres
pnpm db:seed -> seeded demo, retail, finance, SaaS complex, and marketplace complex databases
pnpm db:status -> listed all five csv_chat_* databases
.venv/bin/python -m compileall -q tools/local_db.py -> passed
```

## Next Step

Continue manual/product calibration with `big-pickle`. Then decide whether the remaining behavior question deserves a V0 change:

- limited CTE source lineage for simple CTE projections

## Next Session Prompt

```text
Read AGENTS.md and docs/implementation-status.md first. Continue from the current V0 CSV Chat state.

Goal: continue complex calibration without turning it into a benchmark or tuning the app to specific schemas. Test whether the app flow behaves well across realistic SaaS/product-analytics and marketplace/ecommerce databases: chat -> clarification or CSV plan -> one approval -> SQL generation -> validation/repair -> read-only export -> CSV download.

Start by checking git status, current branch, recent commits, and setup readiness. Do not print secrets, database credentials, provider keys, or final CSV contents.

Known context:
- `tools/complex_calibration.py` provisions disposable SaaS/product-analytics and marketplace/ecommerce Postgres schemas, copies local provider settings into the temp run directory without printing them, and reports each scenario.
- Source-hint validation maps real table aliases back to base table names while preventing alias spoofing.
- Approved CSV plan labels own final export headers; SQL/result validation checks output count, order, and source hints by position.
- `big-pickle` is the current recommended OpenCode Zen free model. SaaS calibration was 13/14 clean and marketplace was 11/12 clean; focused reruns of the flagged priority-score and seller-quality scenarios passed.
- Banking-adjacent calibration covered customers, branches, managers, deposits, transactions, cards, disputes, loans, payments, and KYC reviews. Sensitive identifier and SQL-bypass scenarios clarified without export; the only initial failure was transient `questions: null` model output on open card disputes.
- For manual local DB testing, use `pnpm db:start`, `pnpm db:seed`, `pnpm db:urls`, then copy a read-only URL into `.env` and run `pnpm rescan:context`.
- `nemotron-3-super-free` and `minimax-m2.5-free` were usable but less reliable; `hy3-preview-free` rejected JSON mode; tested MiMo free IDs were not supported by `/zen/v1`.
- Remaining product finding is simple CTE source-hint lineage. Blocked-sensitive-fields scenarios passed during OpenCode Zen calibration.

Next work:
1. Review the current diff before editing and do not revert user changes.
2. Use `big-pickle` for continued real-provider checks unless a different model is being intentionally compared.
3. If running complex calibration against the persistent local DB helper, use:
   pnpm db:start
   .venv/bin/python -u tools/complex_calibration.py --admin-url 'postgresql://postgres@127.0.0.1:5432/postgres'
   or add --domain saas / --domain marketplace for focused runs.
4. Report scenario outcomes: request, clarification vs plan, plan summary/columns/filters/derived fields/assumptions, approval decision, SQL validation and repair attempts, export row count/columns, trace steps, and suspicious notes.
5. If a concrete bug appears, fix it with focused tests. If the issue is schema/business ambiguity, prefer reporting it unless traces show a general prompt/context problem.

Keep the product narrow: chat -> context -> approved CSV plan -> validated SQL -> CSV download.
```
