# Decisions

Resolved V0 product and architecture decisions. Revisit these only with evidence from the running app, smoke tests, model evaluations, or real user workflows.

## Product

- **Advanced is read-only.** SQL and validation details can be inspected in Advanced, but users cannot edit SQL in V0.
- **No uploaded example CSVs.** They introduce a second source of output-shape truth before the core database-driven flow is proven.
- **Context setup is file-based.** The app scans the database, generates editable Markdown context, and lets admins tweak that file directly. Synonyms and common joins belong in those notes, not in a structured management feature.
- **Two SQL repair attempts.** Keep two bounded server-side repair attempts after initial SQL validation failure.
- **No export expiry workflow.** Once the CSV is ready, the user downloads it to their chosen location.

## Safety

- **Generated context may include database hints and representative values.** This improves model precision. Explicit policy blocks define exclusions.
- **Policy stays explicit.** V0 supports blocked schemas, tables, columns, functions, and execution/export limits. No sensitivity classifier or redaction layer.
- **No provider-log controls.** The app makes the model-provider boundary clear and supports custom/local providers where practical.

## Model Providers

- **LiteLLM SDK only.** Do not run LiteLLM proxy in V0. Revisit the adapter if direct SDKs become simpler or LiteLLM creates maintenance drag.
- **API-key-first.** OpenRouter is the first-class default. Custom OpenAI-compatible base URLs cover local/internal endpoints. More API-key providers and account/subscription integrations can come later.
- **Quality is behavior-based.** A usable model must make the app behave correctly across clear, under-specified, invalid/gibberish, approval, SQL validation, and repair scenarios. Use `docs/example-requests.md` and smoke tests to evaluate models.

## Architecture

- **Request/response for V0.** Defer polling, SSE, or WebSockets until export execution is slow enough to need live progress.
- **Filesystem JSON for V0.** Defer SQLite until sessions, exports, audit history, or debug traces need reliable querying.
- **No worker/queue/scheduler.** Revisit only if exports regularly exceed normal request timing, in-flight work must survive restarts, concurrent exports need coordination, or progress/cancellation becomes a real product requirement.
- **One repo.** Keep frontend and backend together unless packaging, release ownership, or deployment targets make separation useful.
- **Model-generated SQL plus validation.** Do not add a structured query plan/compiler unless model SQL proves too unreliable or too hard to validate.

Evidence that may justify a query compiler:

- repeated unsafe SQL repair failures
- frequent mismatch between approved intent and selected fields
- too many ambiguous joins
- need for reusable metrics and business definitions
- audit requirements that demand more structure than raw SQL
