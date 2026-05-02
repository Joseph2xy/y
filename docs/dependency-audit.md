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
- shadcn/ui base components with Base UI primitives.
- shadcn preset `b1YnRGLNA`: nova style, zinc base, blue theme, Inter font, lucide icons.

Backend:

- FastAPI remains on current `0.x` through `fastapi>=0.115,<1`.
- Pydantic remains on `2.x` through `pydantic>=2.10,<3`.
- LiteLLM remains on `1.x` through `litellm>=1.60,<2`.
- psycopg remains on `3.x` through `psycopg[binary]>=3.2,<4`.
- SQLGlot moved from `>=26,<27` to `>=30,<31`.
- Uvicorn remains on current `0.x` through `uvicorn[standard]>=0.34,<1`.

## Decisions

- Keep the existing React/Vite frontend instead of restarting the whole project. The backend architecture is still aligned with the product goal, and the frontend could be migrated cleanly.
- Remove the community `shadcn-chat` registry files. The chat surface now composes official shadcn primitives from `src/components/ui`.
- Use Tailwind CSS 4's CSS-first setup and remove `tailwind.config.js` and `postcss.config.js`.
- Keep dark mode as the default by setting the root HTML class.
- Keep broad backend semver ranges for stable major lines, but move SQLGlot to the current major because SQL validation is part of the trust boundary.

## Verification

```bash
.venv/bin/python -m pytest -q
.venv/bin/python -m compileall -q app tests
pnpm test
pnpm build
pnpm dlx shadcn@latest info --json
pnpm outdated --format json
```

`pnpm outdated --format json` returned `{}` after the frontend upgrade.
