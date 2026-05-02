# Domain Docs

This is a single-context repo for a local app that turns a chat request into a validated CSV export from Postgres.

## Before Exploring

Read these first when a skill needs domain context:

- `docs/implementation-status.md` for current implementation status, next steps, and handoff context.
- `AGENTS.md` for project goal, stack, product flow, safety rules, UX language, and non-goals.
- `docs/architecture.md` for steadier architecture and product reference.
- `docs/open-questions.md` for undecided product and architecture questions.
- `docs/agents/memory.md` for the latest section-by-section memory.

If `CONTEXT.md` or `docs/adr/` exists later, read them when relevant. If they do not exist, proceed silently.

## Layout

Current layout:

```text
/
├── AGENTS.md
├── docs/
│   ├── architecture.md
│   ├── implementation-status.md
│   ├── open-questions.md
│   └── agents/
│       ├── domain.md
│       ├── issue-tracker.md
│       ├── memory.md
│       └── triage-labels.md
└── app/, src/, tests/
```

Potential future layout:

```text
/
├── CONTEXT.md
├── docs/adr/
└── app/, src/, tests/
```

## Vocabulary

Use the repo's existing product language:

- Say `CSV`, `CSV plan`, or `CSV intent` in user-facing contexts.
- Avoid normal-user SQL/table/column jargon unless the UI is explicitly Advanced/debug.
- Treat the model as useful but untrusted.
- Keep the app narrow: chat -> database/schema/context -> validated CSV.

If a new domain term or architectural decision becomes durable, update the appropriate domain docs at a milestone rather than after every small code change.
