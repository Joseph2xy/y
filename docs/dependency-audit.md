# Dependency Audit

Last reviewed: 2026-05-02.

## Outcome

The app is aligned to the current V0 stack without changing the product architecture.

Frontend:

- React 19.2.
- Vite 8.
- TypeScript 6.
- Tailwind CSS 4 through `@tailwindcss/vite`.
- Vitest 4.
- TanStack Query 5.
- Testing Library packages are on their latest published releases.
- pnpm package manager metadata is pinned to 10.33.2.
- shadcn/ui base components with Base UI primitives.
- shadcn preset `b1YnRGLNA`: nova style, zinc base, blue theme, Inter font, lucide icons.

Backend:

- Hatchling build backend is constrained to current `>=1.29.0`.
- FastAPI remains on current `0.x` through `fastapi>=0.136.1,<1`.
- Pydantic remains on `2.12.5+` because latest LiteLLM 1.83.7 pins `pydantic==2.12.5`; attempting `pydantic>=2.13.3` makes pip resolution fail.
- LiteLLM remains on `1.x` through `litellm>=1.83.7,<2`.
- psycopg remains on `3.x` through `psycopg[binary]>=3.3.4,<4`.
- SQLGlot remains on current `30.x` through `sqlglot>=30.6.0,<31`.
- Uvicorn remains on current `0.x` through `uvicorn[standard]>=0.46.0,<1`.
- Test dependencies use current `httpx>=0.28.1,<1` and `pytest>=9.0.3,<10`.

## Decisions

- Keep the existing React/Vite frontend instead of restarting the whole project. The backend architecture is still aligned with the product goal, and the frontend could be migrated cleanly.
- Remove the community `shadcn-chat` registry files. The chat surface now composes official shadcn primitives from `src/components/ui`.
- Use Tailwind CSS 4's CSS-first setup and remove `tailwind.config.js` and `postcss.config.js`.
- Keep dark mode as the default by setting the root HTML class.
- Keep backend semver ranges within stable major lines, but raise lower bounds to the current resolved versions.
- Do not force transitive dependency upgrades past LiteLLM's strict pins. As of LiteLLM 1.83.7, those pins keep Pydantic and several LiteLLM internals below their standalone latest releases.
- Avoid LiteLLM 1.82.7 and 1.82.8. Public security reports identified those PyPI versions as compromised, and they are not selected by the current resolver.

## Verification

```bash
.venv/bin/python -m pytest -q
.venv/bin/python -m compileall -q app tests
pnpm test
pnpm build
pnpm dlx shadcn@latest info --json
pnpm outdated --format json
.venv/bin/python -m pip list --outdated --format=json
```

`pnpm outdated --format table` returned no frontend packages after the upgrade.

`pip list --outdated` still reports LiteLLM-pinned transitive packages (`click`, `importlib_metadata`, `jsonschema`, `openai`, `pydantic`, `pydantic_core`, `python-dotenv`, `tokenizers`, and `typer`). These are intentionally left to LiteLLM's resolver constraints rather than overridden.
