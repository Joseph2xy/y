# Open Questions

These should be decided with evidence, not guessed too early.

## Product

- Should users be allowed to edit SQL in Advanced mode before execution? Current implementation allows viewing SQL only after the user opens Advanced; editing is not implemented.
- Should the app support uploaded example CSVs in V0?
- Should context setup include admin-written synonyms and common joins from day one?
- How many SQL repair attempts are useful before returning to the CSV intent? Current implementation uses two server-side repair attempts as a starting point.
- Should exports expire automatically in V0?

## Safety

- Are low-cardinality profile stats allowed to be sent to the model?
- Are redacted sample values allowed, or is metadata-only context required?
- What sensitivity policy is needed beyond blocked fields?
- Should provider logs be disabled or controlled per provider?

## Model Providers

- Is LiteLLM SDK enough, or do we need LiteLLM proxy?
- Which providers must work in the first demo?
- Should local OpenAI-compatible models be first-class in V0?
- What model quality threshold is acceptable for SQL generation and repair?

## Architecture

- Filesystem JSON or SQLite for the first implementation? Current implementation uses filesystem JSON.
- Is SSE needed immediately, or can request/response plus polling work for V0?
- When does a separate background job become justified?
- Should the frontend and backend live in one repo from day one? Current implementation keeps both in this repo.

## Query Strategy

- Start with model-generated SQL plus validation.
- Add a structured query plan/compiler only if model SQL proves too unreliable or too hard to validate.

Evidence that may justify a query compiler:

- repeated unsafe SQL repair failures.
- frequent mismatch between approved intent and selected fields.
- too many ambiguous joins.
- need for reusable metrics and business definitions.
- audit requirements that demand more structure than raw SQL.
