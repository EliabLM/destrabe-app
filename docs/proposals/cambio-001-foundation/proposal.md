# Change Proposal — Cambio-001: Foundation del monorepo destrabe

**Change ID:** `cambio-001-foundation`
**Etapa SDD:** Propose
**Estado:** Aprobado para spec
**Fecha:** Julio 2026
**Branch:** `develop`
**Basado en:** `docs/proposals/cambio-001-foundation/exploration.md`

## Intent

Establecer la base mínima de proyecto que desbloquea el desarrollo de las features del Demo de destrabe. Sin esta base no existe `package.json`, ni tooling, ni paquete compartido, ni esqueleto de backend sobre el cual aplicar TDD. Al terminar el cambio: `npm install && npm test && npm run dev` funcionan end-to-end en el backend (con un `/health` verde) y `@destrabe/shared` es consumible desde el backend.

## Context

Proyecto greenfield (fase Demo < 1 mes). La spec técnica (`docs/architecture/spec-tecnica-destrabe-app.md` v1.0.0) ya fijó el stack. Esta propuesta cubre **exclusivamente lo que la spec no detalla** para arrancar: workspaces, runner de tests, TS/lint, build del shared, y esqueleto del backend.

## Scope

### In scope

- **Root tooling:**
  - `package.json` raíz con `workspaces: ["backend","shared"]` y scripts root (`dev`, `build`, `test`, `lint`, `format`).
  - `tsconfig.base.json` con `strict` y config compartida.
  - `eslint.config.js` (flat v9) + `typescript-eslint` + integración Prettier.
  - `.prettierrc` + `.prettierignore`.
  - `vitest.config.ts` (cobertura mínima 80%).
- **`@destrabe/shared` skeleton:**
  - `package.json` (name `@destrabe/shared`, `exports` map).
  - `tsconfig.json` (extiende base, project reference).
  - `src/index.ts` barrel, `src/types/index.ts`, `src/schemas/index.ts`.
  - Build con `tsc` → `dist/`.
  - Un tipo y un schema Zod mínimo de ejemplo (ej. enum `ServiceStatus` + su schema) para validar consumo cross-paquete.
- **`backend/` skeleton:**
  - `package.json` (depende de `@destrabe/shared`).
  - `tsconfig.json` (extiende base, project reference).
  - `src/app.ts` (Express app + `GET /health`).
  - `src/routes/health.routes.ts`.
  - `src/lib/env.ts` (validación Zod de `process.env`).
  - `src/lib/prisma.ts` (cliente placeholder).
  - `src/middleware/errorHandler.ts`.
  - `.env.example` (basado en spec §9).
  - `prisma/schema.prisma` mínimo (`datasource` + `generator`, sin modelos).
  - `vitest.config.ts` propio si hace falta.
- **Testing TDD:** tests del `/health`, de `env.ts` (caso válido/rechazo) y del schema de ejemplo en shared.

### Out of scope (cambios posteriores)

- `app/` (React Native + Expo) → cambio mobile.
- `frontend/` (admin web) → cambio admin.
- Prisma schema con modelos (User, Service, Quote, Payment, etc.) → cambio de data model.
- Better Auth, OTP, endpoints de auth → cambio de auth.
- Socket.io namespaces, BullMQ workers → cambio de realtime/jobs.
- Docker Compose prod, Caddyfile, CI/CD workflow → cambio de infra.
- Integraciones Mapbox, Plivo, FCM, Mercado Pago, Resend.

## Approach

Sigue las recomendaciones de la exploration. Resumen ejecutivo:

1. **Workspaces npm** con `["backend","shared"]` (no `app`/`frontend` aún).
2. **Vitest** como runner para backend+shared (TS nativo, watch, cobertura 80%).
3. **TS base + project references** para type-safety cross-paquete.
4. **ESLint v9 flat + Prettier** compartidos.
5. **`@destrabe/shared`** con barrel `src/index.ts`, build `tsc`, `exports` map.
6. **Backend** Express mínimo con `/health`, env validation Zod, prisma client placeholder, error handler. Sin lógica de negocio.
7. **TDD estricto:** cada pieza con test primero (health, env, schema shared).

La implementación se descompone en etapa `tasks` (tras spec y design).

## Risks & mitigations

- **Dos runners de test** (Vitest ahora + Jest futuro en RN): documentar en `docs/testing/` que Vitext=Node, Jest=RN.
- **npm workspaces con carpetas sin `package.json`:** solo listar `backend`+`shared`.
- **Prisma schema sin modelos:** no correr `prisma migrate`; el cliente es placeholder, `/health` no toca DB.
- **Better Auth ausente:** el foundation no depende de auth; el env validation tipa vars que se usarán después.

## Dependencies / prerequisites

- Node 20 LTS instalado.
- PostgreSQL y Redis **NO** requeridos para este cambio (el backend levanta sin conectar a DB).

## Open questions (asumir defaults salvo objeción)

- **Prettier:** single quotes, semicolons SI, 2 spaces, trailing comma es5. (default propuesto)
- **Cobertura:** 80% global backend+shared. (default propuesto)

## Next

Etapa `spec`: escribir delta specs en `docs/specs/cambio-001-foundation/` con requisitos (functional + non-functional) y escenarios (Gherkin). Luego `design` y `tasks`.
