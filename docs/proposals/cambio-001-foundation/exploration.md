# Exploration — Cambio-001: Foundation del monorepo destrabe

**Change ID:** `cambio-001-foundation`
**Etapa SDD:** Explore
**Fecha:** Julio 2026
**Branch:** `develop`

## Current State

Greenfield. El repo solo tiene scaffolding de carpetas vacías (con `.gitkeep`), `README.md`, `.gitignore` y la spec técnica en `docs/architecture/spec-tecnica-destrabe-app.md`. No existe `package.json` raíz ni de paquetes, ni tooling, ni código. Commit base `9bf10fe` en `main` y `develop`.

La spec ya decidió el stack completo (Node 20, Express+TS, Prisma+Postgres/PostGIS, Socket.io, Better Auth, BullMQ+Redis, Zod, RN+Expo, Zustand, Axios, Mapbox, Plivo, FCM, Mercado Pago, Resend, npm workspaces). **Esta exploración no re-decide eso**: cubre solo lo que la spec NO especifica para poder arrancar.

## Affected Areas

- `package.json` (raíz) — definir workspaces y scripts root.
- `tsconfig.base.json` (raíz) — config TS base compartida.
- `eslint.config.js` (raíz) — flat config ESLint v9.
- `.prettierrc` + `.prettierignore` (raíz) — formatting.
- `vitest.config.ts` (raíz o por paquete) — runner de tests backend/shared.
- `shared/` — paquete `@destrabe/shared` (package.json, tsconfig, `src/{types,schemas,index.ts}`).
- `backend/` — esqueleto Express (package.json, tsconfig, `src/app.ts`, `src/routes/health.routes.ts`, `src/lib/{env,prisma}.ts`, `src/middleware/errorHandler.ts`, `.env.example`, `prisma/schema.prisma` mínimo).
- `app/`, `frontend/` — NO tocados en este cambio (defer).

## Approaches

| Decisión                     | Opción A                                         | Opción B                                            | Recomendación                                                                                                    |
| ---------------------------- | ------------------------------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Test runner (backend/shared) | Vitest (ESM nativo, TS sin config, watch rápido) | Jest (maduro, pero requiere ts-jest/swc, más lento) | **Vitest** — mejor DX para TDD en TS/Node                                                                        |
| Test runner (app/ RN)        | Jest + jest-expo (estándar Expo)                 | Vitest (soporte RN pobre)                           | **Jest+expo** — diferido al cambio de mobile                                                                     |
| Workspace layout             | `[backend, shared]` ahora                        | `[app, frontend, backend, shared]` ahora            | **Solo backend+shared** — npm exige `package.json` en cada workspace; app/frontend sin init rompen `npm install` |
| TS config                    | base + project references                        | config simple por paquete                           | **base + references** — type-check incremental y type safety cross-paquete                                       |
| ESLint                       | Flat config v9 (`eslint.config.js`)              | Legacy `.eslintrc`                                  | **Flat v9** — presente/futuro                                                                                    |
| Build de `shared`            | `tsc` (simple, sin deps extra)                   | `tsup` (dual ESM/CJS, más rápido)                   | **tsc** — suficiente para backend (CJS) y RN (Metro); defer dual-package                                         |
| Scope del cambio             | root tooling + shared + backend skeleton         | incluir también `app/` móvil                        | **Solo root+shared+backend** — cambio reviewable; mobile es otro cambio                                          |

## Recommendation

**Scope del cambio-001:** root tooling + `@destrabe/shared` skeleton + `backend/` skeleton. **Deferred:** `app/` (mobile), `frontend/` (admin), Prisma schema completo, Better Auth, BullMQ, sockets — esos son cambios posteriores.

Decisiones concretas:

1. **npm workspaces** = `["backend", "shared"]`. Root `package.json` con `workspaces` y scripts root (`dev`, `build`, `test`, `lint`, `format`).
2. **Vitest** para backend y shared. `vitest.config.ts` con soporte TS nativo. Cobertura mínima 80% (TDD estricto).
3. **`tsconfig.base.json`** raíz con `strict`, `moduleResolution` adecuada, **project references** en backend y shared.
4. **ESLint v9 flat config** raíz + `typescript-eslint` + integración Prettier. `.prettierrc` (convención a definir en spec).
5. **`@destrabe/shared`**: `src/index.ts` barrel, `src/types/`, `src/schemas/`. Build con `tsc`. `exports` map en `package.json`.
6. **backend skeleton**: `src/app.ts` (Express), `src/routes/health.routes.ts` (`GET /health` → `{status:"ok"}`), `src/lib/env.ts` (Zod validation de env), `src/lib/prisma.ts` (cliente placeholder), `src/middleware/errorHandler.ts`. `.env.example` (basado en spec §9). `prisma/schema.prisma` mínimo (datasource + generator, sin modelos aún).
7. **Env validation**: Zod schema en `backend/src/lib/env.ts` validando `NODE_ENV`, `PORT`, `DATABASE_URL`, etc.
8. **Scripts**: root `npm run test` corre Vitest en backend+shared; `npm run lint`/`format` cross-paquete.

## Risks

- **Dos runners de test** (Vitest + Jest) en el monorepo: overhead cognitivo. Mitigación: cada runner scoped a su dominio (Vitest=Node, Jest=RN), documentado en `docs/testing/`.
- **npm workspaces exige `package.json`** en cada workspace listado: listar `app/`/`frontend` antes de init rompe `npm install`. Mitigación: solo listar `backend`+`shared` ahora.
- **Prisma schema mínimo** puede generar migración vacía prematura: dejar schema con solo `datasource`+`generator`, sin modelos, hasta el cambio de features.
- **Better Auth / Mapbox prebuild** quedan fuera del foundation: confirmar que no se necesitan para arrancar (correcto, van en sus cambios).

## Ready for Proposal

**Yes.** El scope está claro y las decisiones técnicas están tomadas. Próximo paso: etapa `propose` para formalizar el change proposal (intent, scope, approach) en `docs/proposals/cambio-001-foundation/proposal.md`.
