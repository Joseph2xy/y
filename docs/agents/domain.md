# Domain Docs

This is a single-context repo for a local app that turns a chat request into a validated CSV export from Postgres.

## Before Exploring

Read these first when a skill needs domain context:

- `CONTEXT.md` for canonical product vocabulary and relationships.
- `docs/implementation-status.md` for current implementation status, next steps, and handoff context.
- `AGENTS.md` for project goal, stack, product flow, safety rules, UX language, and non-goals.
- `docs/architecture.md` for steadier architecture and product reference.
- `docs/decisions.md` for resolved V0 decisions and evidence triggers.
- `docs/agents/memory.md` for the latest section-by-section memory.

If `docs/adr/` exists later, read ADRs when relevant. If it does not exist, proceed silently.

## Layout

Current layout:

```text
/
├── CONTEXT.md
├── AGENTS.md
├── docs/
│   ├── architecture.md
│   ├── decisions.md
│   ├── implementation-status.md
│   └── agents/
│       ├── domain.md
│       └── memory.md
└── app/, src/, tests/
```

Potential future layout:

```text
/
├── docs/adr/
└── app/, src/, tests/
```

## Vocabulary

Use `CONTEXT.md` as the canonical glossary. In short:

- Say `CSV`, `CSV plan`, or `CSV intent` in user-facing contexts.
- Avoid normal-user SQL/table/column jargon unless the UI is explicitly Advanced/debug.
- Treat the model as useful but untrusted.
- Keep the app narrow: chat -> database/schema/context -> validated CSV.

If a new domain term or architectural decision becomes durable, update the appropriate domain docs at a milestone rather than after every small code change.
