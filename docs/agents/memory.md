# Agent Memory

Update this file at the end of each section of work.

## Previously Done

- Reviewed current app state and fixed the session state transition so adding a user message keeps the session in `drafting_intent` until a CSV plan is proposed.
- Ran the first end-to-end local demo path against real local Postgres using a deterministic local mock OpenAI-compatible model server.
- Fixed Postgres read-only query timeout setup so `SET LOCAL statement_timeout` and `SET LOCAL lock_timeout` work during export execution.
- Adjusted the compact frontend workflow layout so CSV plan approval, SQL preparation, export execution, and download controls are visible and clickable.
- Added `tools/mock_openai_server.py` for repeatable local demos without external model credentials.
- Configured agent skill docs for GitHub Issues, default triage labels, single-context domain docs, and this memory file.
- Updated agent workflow docs to reflect that this is a solo direct-to-main project with no expected issues or pull requests.

## Next Step

- Add OpenAPI-generated frontend types after confirming no immediate endpoint shape changes are needed.
