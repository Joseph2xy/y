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

## Next Step

- Expose or document the custom OpenAI-compatible provider/base URL path before relying on the setup UI for non-OpenRouter real-provider testing; then connect a real model provider and review generated context from one or two realistic schemas.
