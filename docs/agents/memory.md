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

## Next Step

- Improve debug trace persistence for prompts, model outputs, SQL validation attempts, and repair attempts without adding a database or dashboard.
