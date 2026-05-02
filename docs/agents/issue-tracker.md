# Issue Tracker: Solo Direct-to-Main

This is currently a solo project. The user is the only person working on it, and the normal workflow is to make changes locally and push directly to `main`.

Do not assume:

- GitHub Issues are being used.
- Pull requests are expected.
- A formal feature/project workflow exists.
- Work needs to be converted into tickets before implementation.

The GitHub remote exists as the place code is pushed, not as an active issue tracker.

## Working Convention

- Prefer direct implementation in the working tree when the user asks for a change.
- Keep `docs/implementation-status.md` current for handoff and next-step context.
- Keep `docs/agents/memory.md` updated at the end of each completed work section.
- If a task needs decomposition, write a concise local plan in the conversation or the memory file rather than creating issues.
- Only create GitHub issues, PRDs, or pull requests if the user explicitly asks for them or later says the workflow has changed.

## If a Skill Expects an Issue Tracker

Treat the current conversation, `docs/implementation-status.md`, and `docs/agents/memory.md` as the source of truth. Ask the user before creating any external tracker artifact.
