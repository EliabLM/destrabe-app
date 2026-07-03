# Tasks — Cambio-001: Foundation del monorepo destrabe

**Change ID:** `cambio-001-foundation`
**Etapa SDD:** Tasks
**Basado en:** `docs/designs/cambio-001-foundation/design.md`
**Branch:** `develop`

> Tareas ordenadas para `apply`. TDD estricto: dentro de cada tarea con código, **test primero → impl → green → refactor**. Cada tarea mapea a requisitos de la spec.

---

## T1 — Root tooling setup _(no TDD — es infra de configs)_

**Crea:**

- `package.json` (raíz): `workspaces: ["backend","shared"]`, scripts `dev`, `build`, `test`, `lint`, `format`.
- `tsconfig.base.json` (strict, moduleResolution bundler, composite).
- `.prettierrc` (singleQuote, semi, tabWidth 2, trailingComma all) + `.prettierignore`.
- `eslint.config.js` (flat v9 + typescript-eslint, ignores dist/node_modules).
- `vitest.config.ts` (coverage v8, thresholds 80%, include `**/src/**`).

**Acción:** `npm install` (deps root: typescript, eslint, typescript-eslint, prettier, vitest, tsx, @types/node).

**Acepta (REQ-006 parcial):** `npm run lint` y `npm run format` corren sin error sobre el repo (aún sin código fuente).

---

## T2 — @destrabe/shared: types + schema Zod _(TDD)_

**Test primero:** `shared/__tests__/serviceStatus.schema.test.ts`

- parse `'PENDING'` → `'PENDING'` (REQ-002)
- parse `'INVALID'` → lanza `ZodError` (REQ-002)

**Luego impl:**

- `shared/src/types/service.ts` → `enum ServiceStatus { PENDING, QUOTED, ACTIVE, COMPLETED, CANCELLED }` (spec §6)
- `shared/src/schemas/service.schema.ts` → `serviceStatusSchema = z.enum([...])` derivado del enum
- `shared/src/index.ts` → barrel re-export
- `shared/src/types/index.ts`, `shared/src/schemas/index.ts` → barrels
- `shared/package.json` (name `@destrabe/shared`, `exports` map types+import, `scripts.build: tsc`)
- `shared/tsconfig.json` (extends base, composite, outDir dist)

**Acción:** `npm run build -w @destrabe/shared` → genera `shared/dist/`.

**Acepta (REQ-002):** tests green; `dist/` tiene `.js` + `.d.ts`.

---

## T3 — backend: env validation (Zod) _(TDD)_

**Test primero:** `backend/__tests__/env.test.ts`

- envs válidos → `env.PORT` number, `env.NODE_ENV` (REQ-004)
- `NODE_ENV` ausente → default `'development'` (REQ-004)
- `PORT=abc` → lanza error que menciona `PORT` (REQ-004)

**Luego impl:**

- `backend/src/lib/env.ts` → `z.object({ NODE_ENV: z.enum([...]).default('development'), PORT: z.coerce.number().int().positive(), ... })`, parse con side-effect fail-fast.
- `backend/package.json` (deps: express, zod, @destrabe/shared `*`, @prisma/client, prisma; dev: tsx, vitest, supertest, typescript, @types/express, @types/supertest, @types/node).
- `backend/tsconfig.json` (extends base, references shared).
- `backend/.env.example` (subset spec §9: DATABASE_URL, REDIS_URL, NODE_ENV, PORT).
- `backend/vitest.config.ts`.

**Acepta (REQ-004):** env tests green.

---

## T4 — backend: Express app + /health + notFound + errorHandler _(TDD)_

**Tests primero (supertest sobre `createApp()`):**

- `backend/__tests__/health.route.test.ts` → `GET /health` 200 `{status:"ok"}` (REQ-003)
- `backend/__tests__/notFound.test.ts` → `GET /no-existe` 404 `{error, code:"NOT_FOUND"}` (REQ-003)
- `backend/__tests__/errorHandler.test.ts` → ruta que lanza → 500 `{error, code:"INTERNAL_ERROR"}` (REQ-005)

**Luego impl:**

- `backend/src/app.ts` → `createApp()` factory (express + json + routes + notFound + errorHandler).
- `backend/src/routes/health.routes.ts` → `GET /health`.
- `backend/src/routes/index.ts` → monta router.
- `backend/src/middleware/notFound.ts`.
- `backend/src/middleware/errorHandler.ts`.

**Acepta (REQ-003, REQ-005):** tests HTTP green.

---

## T5 — backend: server.ts entry + prisma placeholder _(ligero, sin TDD estricto)_

**Crea:**

- `backend/src/server.ts` → importa `createApp()`, lee `env.PORT`, `app.listen(PORT)`. Mantiene delgado.
- `backend/src/lib/prisma.ts` → `export const prisma = new PrismaClient()` (no se invoca en /health).
- `backend/prisma/schema.prisma` → `generator client` + `datasource db` (url `env("DATABASE_URL")`), sin modelos.

**Acepta (REQ-008):** `npm run dev -w backend` levanta sin DB/Redis; `GET /health` 200.

---

## T6 — Integración workspaces + cobertura _(verificación)_

**Acción:**

- backend importa `@destrabe/shared` (resolución workspace, REQ-001).
- `npm test` (todos) → green + coverage ≥ 80% en lines/branches/functions/statements (REQ-007).
- `npm run lint` green, `npm run build` (tsc -b project references) green (REQ-006).

**Acepta (REQ-001, REQ-006, REQ-007):** todo verde.

---

## T7 — Docs de testing _(documentación)_

- `docs/testing/estrategia.md` → Vitest = lado Node (backend+shared), Jest+expo = lado RN (futuro); TDD red-green-refactor; cobertura 80%; convención de nombres `*.test.ts` en `__tests__/`.
- Actualizar `README.md` raíz con comandos de setup por capa (install/build/test/dev).

**Acepta:** docs coherentes con lo implementado.

---

## Orden de ejecución (apply)

`T1 → T2 → T3 → T4 → T5 → T6 → T7`

Commit strategy (conventional + work-unit): un commit por tarea (o por par test+impl dentro de T2–T4). Ej: `chore(workspace): bootstrap root tooling`, `feat(shared): add ServiceStatus schema`, `feat(backend): add env validation`, etc.

## Next

Etapa `apply`: ejecutar T1→T7 con TDD estricto (tests primero), luego `verify`.
