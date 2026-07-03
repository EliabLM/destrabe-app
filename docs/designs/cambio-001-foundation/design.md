# Design — Cambio-001: Foundation del monorepo destrabe

**Change ID:** `cambio-001-foundation`
**Etapa SDD:** Design
**Basado en:** `docs/specs/cambio-001-foundation/spec.md`
**Branch:** `develop`

> Diseño técnico concreto. La implementación (con código) ocurre en `apply` con TDD: tests primero. Aquí se define QUÉ archivos y configs existen y CÓMO fluye el server.

## 1. File tree objetivo (solo lo que crea este cambio)

```
destrabe-app/
├── package.json                 # root: workspaces + scripts
├── tsconfig.base.json           # config TS base
├── eslint.config.js             # flat ESLint v9
├── .prettierrc
├── .prettierignore
├── vitest.config.ts             # coverage 80%
│
├── shared/                      # @destrabe/shared
│   ├── package.json             # name, exports, build script
│   ├── tsconfig.json            # extiende base + composite
│   ├── src/
│   │   ├── index.ts             # barrel
│   │   ├── types/
│   │   │   ├── index.ts
│   │   │   └── service.ts       # ServiceStatus enum (de spec §6)
│   │   └── schemas/
│   │       ├── index.ts
│   │       └── service.schema.ts# serviceStatusSchema (Zod)
│   └── __tests__/
│       └── serviceStatus.schema.test.ts
│
└── backend/
    ├── package.json             # depende de @destrabe/shared
    ├── tsconfig.json            # extiende base + reference a shared
    ├── vitest.config.ts
    ├── .env.example             # de spec §9 (subset)
    ├── prisma/
    │   └── schema.prisma        # datasource + generator, sin modelos
    ├── src/
    │   ├── app.ts               # Express app factory + /health + middlewares
    │   ├── server.ts            # bootstrap: lee env, app.listen (separado para tests)
    │   ├── routes/
    │   │   ├── index.ts         # monta /health
    │   │   └── health.routes.ts # GET /health -> {status:"ok"}
    │   ├── lib/
    │   │   ├── env.ts           # Zod validation de process.env
    │   │   └── prisma.ts        # new PrismaClient() placeholder
    │   └── middleware/
    │       ├── notFound.ts      # 404 {error, code:"NOT_FOUND"}
    │       └── errorHandler.ts  # 500 {error, code:"INTERNAL_ERROR"}
    └── __tests__/
        ├── health.route.test.ts
        ├── env.test.ts
        ├── errorHandler.test.ts
        └── notFound.test.ts
```

## 2. Dependencias objetivo

> Versiones aproximadas; se fijan exactas en `apply` con `npm install`.

**Root (devDependencies):**

- `typescript` ^5.6, `eslint` ^9.15, `typescript-eslint` ^8.16, `prettier` ^3.4, `vitest` ^2.1, `tsx` ^4.19, `@types/node` ^20

**shared:**

- `zod` ^3.23 (peer)
- build: `tsc` (sin deps extra)

**backend:**

- `express` ^4.21 _(estable; Express 5 disponible pero 4.x tiene ecosistema de middlewares más maduro)_
- `@prisma/client` ^5.22, `prisma` ^5.22 (dev)
- `zod` ^3.23
- `@destrabe/shared` `*` (workspace)
- dev: `@types/express` ^4.17, `@types/supertest` ^6, `supertest` ^7.0, `tsx`, `vitest`, `typescript`

## 3. Configs clave

### `tsconfig.base.json`

- `strict: true`, `esModuleInterop: true`, `skipLibCheck: true`
- `moduleResolution: bundler`, `module: ESNext`, `target: ES2022`
- `composite: true` (para project references)
- `forceConsistentCasingInFileNames: true`

### `shared/tsconfig.json` y `backend/tsconfig.json`

- `extends: ../tsconfig.base.json`
- `references` cruzados (backend referencia a shared)
- `outDir: ./dist` (shared), backend sin outDir en dev (tsx) — `tsc --noEmit` para typecheck

### `eslint.config.js` (flat v9)

- `typescript-eslint` recommended
- ignores: `**/dist/**`, `**/node_modules/**`, `**/.eslintignore` no existe en flat
- regla extra: `no-unused-vars` off (usa `@typescript-eslint/no-unused-vars`)

### `.prettierrc`

```json
{ "singleQuote": true, "semi": true, "tabWidth": 2, "trailingComma": "all" }
```

### `vitest.config.ts` (root)

- `coverage`: provider `v8`, thresholds `lines/branches/functions/statements >= 80`
- `include`: `shared/src/**/*.ts`, `backend/src/**/*.ts`
- `exclude`: `**/dist/**`, `**/__tests__/**` (de cobertura)

## 4. Server flow (`backend/src/app.ts` + `server.ts`)

```
server.ts  ──import app──►  app.ts (factory: createApp())
                              │
                              ├─ express()
                              ├─ express.json()
                              ├─ mount router(health) → GET /health
                              ├─ mount notFound  → 404 {error,code:"NOT_FOUND"}
                              └─ mount errorHandler → 500 {error,code:"INTERNAL_ERROR"}
server.ts:  env.PORT → app.listen(PORT)
```

- **Separación app/server:** `app.ts` exporta `createApp()` (sin `listen`) para que los tests usen `supertest` sin abrir puertos. `server.ts` es el entry de `npm run dev` (usa `tsx`).

## 5. Env validation flow (`backend/src/lib/env.ts`)

```
process.env ──► z.object({ NODE_ENV: z.enum([...]).default("development"),
                           PORT: z.coerce.number().int().positive() })
            ──► parse() ──► env (tipado)  |  throw ZodError (mensaje con PORT/NODE_ENV)
```

- Importar `env` tiene side-effect de validar (fail-fast al arranque).
- `.env.example` incluye subset de spec §9: `DATABASE_URL`, `REDIS_URL`, `NODE_ENV`, `PORT` (las necesarias para foundation; el resto se agrega en sus cambios).

## 6. @destrabe/shared flow

- `src/types/service.ts`: `export enum ServiceStatus { PENDING='PENDING', QUOTED='QUOTED', ACTIVE='ACTIVE', COMPLETED='COMPLETED', CANCELLED='CANCELLED' }` (de spec §6).
- `src/schemas/service.schema.ts`: `export const serviceStatusSchema = z.enum(['PENDING','QUOTED','ACTIVE','COMPLETED','CANCELLED'])` (deriva de los valores del enum, no duplicar literales a mano en la medida de lo posible).
- `src/index.ts`: re-exporta tipos y schemas.
- `package.json` `exports`: `{ ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }`.
- Build: `tsc` → `dist/`. Backend consume la versión compilada (no el source) para aislar.

## 7. Build & test flow

```
npm install              # instala + links workspaces
npm run build            # tsc -b (project references): shared primero, luego backend typecheck
npm test                 # vitest run (todos los tests) + coverage
npm run dev -w backend   # tsx watch src/server.ts
npm run lint             # eslint flat
npm run format           # prettier --write .
```

## 8. Test strategy (TDD)

- Runner: Vitest (backend + shared). HTTP tests con `supertest` contra `createApp()`.
- Orden TDD por archivo: **test → impl → green → refactor**.
- Cobertura 80% medido sobre `src/` (excluye `__tests__`, `dist`, `server.ts` entry puede excluirse del threshold o cubrirse con test de listen).
- `server.ts` se mantiene delgado para que casi toda la lógica viva en `app.ts`/routes/lib (testeable).

## 9. Tradeoffs

- **Express 4 vs 5:** 4.21 por madurez de middlewares; migrar a 5 en un cambio posterior si hace falta.
- **Vitest + (futuro) Jest en RN:** dos runners; aceptado, scoped por dominio (documentar en `docs/testing/`).
- **`server.ts` separado de `app.ts`:** un archivo más, pero habilita testing con supertest sin abrir puerto. Vale la pena.
- **shared compilado vs source:** backend consume `dist/` de shared; requiere `npm run build` de shared antes de `dev` de backend. Alternativa: que backend apunte a `src/index.ts` directo (vía `exports` condicional `development`). → decisión: apuntar backend a `dist/` y documentar el paso de build; si molesta en DX, se agrega exports condicional en otro cambio.

## 10. Prisma placeholder

- `prisma/schema.prisma`: solo `generator client` + `datasource db` (url de env). Sin modelos.
- `lib/prisma.ts`: `export const prisma = new PrismaClient()`. No se invoca en `/health`.
- No se corre `prisma migrate` en este cambio.

## Next

Etapa `tasks`: descomponer este design en tareas ordenadas de implementación (cada una con su test asociado) para ejecutar en `apply`.
