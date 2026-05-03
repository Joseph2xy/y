# Agent Memory

Update this file at the end of each section of work.

## Previously Done

- Reviewed current app state and fixed the session state transition so adding a user message keeps the session in `drafting_intent` until a CSV plan is proposed.
- Ran the first end-to-end local demo path against real local Postgres using a deterministic local mock OpenAI-compatible model server.
- Fixed Postgres read-only query timeout setup so `SET LOCAL statement_timeout` and `SET LOCAL lock_timeout` work during export execution.
- Adjusted the compact frontend workflow layout so CSV plan approval, SQL preparation, export execution, and download controls are visible and clickable.
- Added `tools/mock_openai_server.py` for repeatable local demos without external model credentials.
- Added `CONTEXT.md` as the canonical product glossary.
- Consolidated resolved documentation questions into `docs/decisions.md`.
- Removed unused issue-tracker and triage-label agent docs.
- Implemented richer context setup: schema scans now include primary keys, foreign-key relationship hints, conservative representative filter values, and generated editable Markdown when the default context has not been customized.
- Added `tools/model_eval.py` and pytest coverage for behavior-based model flow evals covering clear requests, joins, aggregates, vague/gibberish requests, blocked sensitive-field requests, and SQL repair.
- Added persisted session debug traces for model prompts, model outputs, SQL validation attempts, repair attempts, and export execution, exposed through the read-only Advanced UI.
- Reviewed the trace changes with CodeRabbit (`0 issues`) and a manual pass; fixed failed model calls so they also persist prompt/error traces. Verified with `106 passed`, compileall, model evals, frontend tests, and `pnpm build`.
- Added lightweight setup readiness/bootstrap flow: backend reports database/provider/context readiness, checks the configured database connection, bootstraps context scanning when configuration exists, and the frontend shows setup UI only when something is missing. Verified with `112 passed`, compileall, model evals, frontend tests/build, and Postgres smoke.
- Added simple `.env` support for local database/model configuration, plus `.env.example`, gitignore coverage, README setup instructions, and setup-screen copy aligned with `.env`.
- Reviewed backend `app/*.py` and tests for AGENTS/docs alignment; tightened SQL policy conversion so built-in unsafe blocked functions remain blocked even when `policy.json` customizes `blocked_functions`. Verified with `113 passed` and compileall.
- Reviewed docs and repo hygiene against AGENTS/docs; tightened README flow/model-provider wording, confirmed generated runtime/build files are ignored, and found no tracked ignored artifacts beyond `data/exports/.gitkeep`.
- Rechecked app state against docs and current LiteLLM/SQLGlot/psycopg/FastAPI docs before real-provider testing; fixed provider-missing tests so local `.env`/OpenRouter fallback credentials do not mask missing-provider assertions. Verified with `116 passed`, compileall, frontend tests, and frontend build.
- Exposed custom OpenAI-compatible provider setup in the first-run provider panel and documented the matching `.env` variables.
- Confirmed the configured OpenRouter provider works from `.env`; a real model-provider app flow proposed a CSV plan, prepared valid SQL in one attempt, exported 3 rows, and returned a download URL without printing CSV contents.
- Ran four real-provider calibration scenarios against the small customer/account schema. Three concrete requests exported successfully with first-attempt SQL validation. A vague request initially returned clarification-shaped model output that failed the strict CSV intent schema; fixed `CSVIntentProposal` to allow `intent: null` plus questions, keep the session in drafting state, and show clarification in the UI.
- Added `tools/realistic_calibration.py` for real-provider calibration against a disposable five-table retail/support Postgres schema without printing credentials or CSV contents.
- Ran realistic-schema calibration with four concrete requests and one vague request. Shipped Q1 orders, March revenue by product category, open high-priority support tickets, and active West-region accessory buyers all exported with valid SQL on the first attempt. The vague sales request returned focused clarification questions. No prompt or context tuning was needed from this pass.
- Added local development hardening: `tools/dev.py` plus `pnpm dev:app` runs the FastAPI backend and Vite frontend together, and `tools/check_setup.py` plus `pnpm check:setup` reports database/provider/context readiness from the terminal. Updated README setup flow and verified with `120 passed`, compileall, `pnpm test`, `pnpm build`, and `pnpm check:setup`.
- Added `tools/finance_calibration.py` for real-provider calibration against a disposable five-table finance/invoicing Postgres schema.
- Ran finance calibration. Unpaid invoices, recognized revenue by month, and March payments exported with valid SQL on the first attempt. The overdue-invoices request exposed a model-output shape issue where an assumption list item was an object; fixed `CSVIntent` list fields to coerce simple object-shaped model mistakes into strings. The rerun produced a reasonable overdue-invoices CSV plan, but SQL preparation and the final vague-finance clarification were blocked by the configured OpenRouter free-model daily rate limit. Verified with `121 passed` and compileall.
- Cleaned repo hygiene: removed ignored build/cache/runtime artifacts and old generated session/export files, deleted stale docs `docs/agents/domain.md` and `docs/dependency-audit.md`, and updated README/implementation status to reflect the smaller active doc set.
- Added `docs/flow.excalidraw`, an editable lane diagram explaining the app process, boundaries, and safety flow from setup through CSV download.
- Remade and polished `docs/flow.excalidraw` as a cleaner four-lane 13-step flow after the first version proved too dense. Verified readability with agent-browser against a temporary local render and kept the source as valid Excalidraw JSON.
- Simplified local tester onboarding. The root README now focuses on first-run and everyday use; added `tools/setup_local.sh` for Linux/WSL setup without overwriting `.env`; improved `.env.example`; added `docs/local-user-guide.md`, `docs/troubleshooting.md`, and `docs/development.md`; and made `pnpm check:setup` print concrete next actions. Windows support is WSL-first for now. Verified the focused check setup tests, `bash -n tools/setup_local.sh`, and `pnpm check:setup`.
- Made context lifecycle explicit for testers. First-run setup creates context only when files are missing; changing `DATABASE_URL` later requires `pnpm rescan:context` or deleting context files for a fresh regenerate. Added `tools/rescan_context.py`, the `pnpm rescan:context` script, docs, and focused test coverage.
- Added context freshness tracking. Schema context now stores sanitized database source metadata and scan time; setup status warns when the current `DATABASE_URL` differs from the context source; `pnpm check:setup` prints current/scanned database labels; and the setup UI shows a rescan panel with a button when context is stale.
- Reworked the main chat UX so sending a request automatically asks for a CSV plan, approving the plan automatically prepares/validates the export, and the normal path shows one next action instead of separate propose/prepare/run pipeline controls. Added friendlier provider quota and malformed-model-output error messages while keeping raw details in Advanced traces.
- Split setup diagnostics for missing database configuration vs configured-but-unreachable database. `setup_status` now returns `connect_database` when `DATABASE_URL` exists but the connection fails; `pnpm check:setup`, the setup UI, troubleshooting docs, and focused tests now point users toward starting Postgres or fixing host/port/credentials.
- Reworked the frontend into a prompt-kit/shadcn chat workspace. The normal screen now uses an auto-scrolling conversation area, prompt suggestions, a prompt-kit composer, assistant-side CSV plan/export cards, and read-only Advanced details. Verified desktop/mobile browser screenshots, fixed mobile horizontal overflow, and avoided pulling prompt-kit markdown/Shiki payload because this V0 chat does not render markdown.
- Reset the frontend UX from first principles. Reinstalled/reset shadcn defaults, kept only useful prompt-kit primitives, replaced `src/App.tsx` with one centered chat canvas, moved SQL/debug details into an Advanced dialog, kept setup as fallback-only, removed unused markdown/message UI and dependencies, updated frontend tests, and verified `pnpm test`, `pnpm build`, plus desktop/mobile browser screenshots.
- Revisited Prompt Kit after reviewing its component list. Replaced custom chat bubbles with Prompt Kit `Message`, added scroll-to-latest, progress `Steps`, `ThinkingBar` loading states, `SystemMessage` notices, and Prompt Kit code blocks in Advanced/setup code surfaces. Added lazy-loaded Markdown and narrowed lazy Shiki highlighting to SQL/JSON/shell so `pnpm build` stays below the main-bundle warning threshold. Verified `pnpm test` and `pnpm build`.
- Rebuilt the ready-state chat screen around Prompt Kit block composition rather than layering primitives into the old centered screen. Moved Prompt Kit primitives from `src/components/ui` to `src/components/prompt-kit`, kept shadcn UI files for shadcn components only, switched to a full-height conversation shell with centered message rows and anchored composer, and intentionally skipped generic sidebar/history/full-chat blocks because they widen the product beyond the V0 CSV flow. Verified `pnpm test` and `pnpm build`.
- Reworked the frontend into an Artifact Split layout after deciding chat should remain the entry point but the CSV plan should be a persistent artifact. `src/App.tsx` now has a left conversation pane using Prompt Kit chat/composer primitives and a right CSV artifact panel using shadcn cards, badges, dialogs, fields, and buttons for plan review, clarification, approval, safety/validation status, export, download, and Advanced details. Verified with `pnpm test`, `pnpm build`, and an agent-browser Vite check against mocked setup/session endpoints.
- Added a persisted light/dark mode header toggle using the existing shadcn theme variables and lucide icons. Verified with `pnpm test` (`8 passed`) and `pnpm build`.
- Switched the shadcn preset to `b1Ymqvgiu` using `pnpm dlx shadcn@latest init --preset b1Ymqvgiu --force --reinstall`, which moved the design tokens to the blue theme/chart palette and Inter font while keeping Nova/Base UI/lucide/default radius. Removed the stale Geist font dependency/import after the CLI added Inter. Verified with `pnpm test` (`8 passed`), `pnpm build`, and `pnpm dlx shadcn@latest preset resolve --json`.

## Next Step

- Ask a tester to follow the README from a fresh Linux/WSL clone and record any setup friction. Re-test the Artifact Split chat flow end-to-end with a stable provider/model, including approve -> prepare -> create -> download. Also re-run the remaining finance calibration scenarios after provider quota resets or with a paid/non-free provider: overdue-invoices SQL/export and vague-finance clarification.

## Next Session Prompt

Use this prompt to continue:

```text
Read AGENTS.md and docs/implementation-status.md first. Continue from the current V0 CSV Chat state.

Goal for this session: test the documented local onboarding path from a fresh Linux/WSL clone if possible, record any setup friction, and re-test the Artifact Split chat flow with a stable provider/model. Also re-run the remaining finance calibration scenarios after provider quota resets or with a paid/non-free provider: overdue-invoices SQL/export and vague-finance clarification.

Start by checking git status and setup readiness. Do not print secrets, database credentials, or final CSV contents. Use the configured .env provider/database if available.

For another calibration pass, run 3-5 realistic CSV requests through the actual API flow:
1. create session
2. add user request
3. propose CSV plan
4. approve only if the plan is reasonable
5. prepare SQL
6. export if SQL validation passes
7. inspect persisted debug traces

Report for each request: request text, whether the model proposed a plan or clarification, planned columns/filters, SQL validation result and repair attempts, export row count/columns, and any mismatch or suspicious behavior.

If a concrete bug appears, fix it with focused changes and tests. If the issue is schema/business ambiguity, tune data/context/context.md or prompt wording only when the traces show a specific confusion. Keep the product narrow: chat -> context -> approved CSV plan -> validated SQL -> CSV download.

If local-install friction comes up, start from `README.md`, `tools/setup_local.sh`, `pnpm check:setup`, and `pnpm dev:app` before adding anything broader.

Before final response, run relevant verification: pytest, frontend tests/build when frontend/API types changed, compileall, and model_eval if prompt/model-flow behavior changed. End with conclusions and recommended next actions.
```
