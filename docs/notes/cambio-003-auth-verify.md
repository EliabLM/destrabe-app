# Verify Report — Cambio-003: Better Auth (OTP + Identity)

**Change ID:** `cambio-003-auth`
**Etapa SDD:** Verify
**Branch:** `feature/cambio-003-auth`
**Verificador:** sdd-verify executor (Standard TDD mode, repo-local)
**Fecha:** 2026-07-03
**TDD mode:** Standard (NO strict TDD)
**Veredicto final:** **FAIL** (2 CRITICAL — gate commands exit non-zero)

---

## 1. Completeness table

| Artefacto     | Estado    | Notas                                                             |
| ------------- | --------- | ----------------------------------------------------------------- |
| proposal      | done      | `docs/proposals/cambio-003-auth/proposal.md` leído                |
| specs         | done      | `docs/specs/cambio-003-auth/spec.md` — 10 REQs (REQ-001..REQ-010) |
| design        | done      | `docs/designs/cambio-003-auth/design.md` leído                    |
| tasks         | done      | 12/12 tareas completadas (`docs/tasks/cambio-003-auth/tasks.md`)  |
| applyProgress | done      | Commits hasta `a23aaea` (T1..T12)                                 |
| verifyReport  | this file |                                                                   |

## 2. Task completion (correctness)

| Task | Descripción                                           | Estado | Commit    |
| ---- | ----------------------------------------------------- | ------ | --------- |
| T1   | Instalar deps + ampliar env globals                   | [x]    | `75bdd42` |
| T2   | Plivo client (TDD)                                    | [x]    | `c950a18` |
| T3   | Schema Better Auth: User/Session/Account/Verification | [x]    | `3dc99c6` |
| T4   | Migración add_auth_identity                           | [x]    | `348fc7a` |
| T5   | auth.ts config (TDD)                                  | [x]    | `ef75d4a` |
| T6   | Montar handlers en app.ts/router                      | [x]    | `59997f2` |
| T7   | Middleware requireAuth + requireRole (TDD)            | [x]    | `0bf987c` |
| T8   | shared: tipos auth + schemas Zod                      | [x]    | `6a889c0` |
| T9   | Flujo OTP end-to-end (db smoke TDD)                   | [x]    | `cfca5bd` |
| T10  | Ampliar tests de env (TDD)                            | [x]    | `9a80c10` |
| T11  | ADR-003 documentación                                 | [x]    | `093a408` |
| T12  | Docs finales (README + testing strategy)              | [x]    | `a23aaea` |

**Total:** 12/12 completadas, 0 pendientes. Objective task completion: ✅ DONE.

## 3. Build / type-check / lint / format evidence

| Comando                                     | Resultado | Notas                                      |
| ------------------------------------------- | --------- | ------------------------------------------ |
| `npm run build -w @destrabe/shared`         | ✅ exit 0 | shared compila limpio                      |
| `npx tsc --noEmit -p backend/tsconfig.json` | ✅ exit 0 | backend type-check limpio                  |
| `npm run lint` (`eslint .`)                 | ✅ exit 0 | sin warnings                               |
| `npx prettier --check .`                    | ❌ exit 1 | **29 archivos con issues de formato** (W1) |

### Prettier — archivos con issues de formato (W1)

```
backend/__tests__/auth.mount.test.ts
backend/__tests__/auth.otp.flow.test.ts
backend/__tests__/db/{cascade,enum-constraint,relations}.test.ts
backend/__tests__/db/helpers.ts
backend/__tests__/env.test.ts
backend/__tests__/middleware.auth.test.ts
backend/__tests__/plivo.test.ts
backend/src/lib/env.ts
backend/src/lib/plivo.ts
backend/src/middleware/auth.ts
docs/adr/ADR-003-better-auth.md
infra/docker-compose.dev.yml
package.json
shared/__tests__/{enums.schema,no-prisma-import}.test.ts
shared/src/schemas/{auth,index,payment,service,user}.schema.ts
shared/src/types/{auth,index,payment,service,user}.ts
vitest.config.ts
vitest.db.config.ts
```

`npm run format` (== `prettier --write .`) lo resolvería. No se aplicó en verify (no se fixea, solo se reporta).

## 4. Test / coverage evidence

### 4.1 `npm test` (default unit suite) — SIN `DATABASE_URL` en entorno

```
Test Files  1 failed | 12 passed (13)
Tests       3 failed | 37 passed (40)
❯ backend/__tests__/auth.otp.flow.test.ts (4 tests | 3 failed)
   × send-otp → 2xx y captura el OTP vía mock de Plivo (REQ-006/010)
        AssertionError: expected 500 to be less than 300
   × flujo completo send → verify → get-session (REQ-007)
        AssertionError: expected 500 to be less than 300
   × sign-out limpia la cookie y la sesión queda null (REQ-010)
        TypeError: Cannot read properties of undefined (reading 'code')
Error Better Auth: PrismaClientInitializationError:
  "Environment variable not found: DATABASE_URL" (schema.prisma:7)
```

→ **`npm test` exit non-zero (CRITICAL C2).** El error no es de conexión (Postgres está up); el `PrismaClient` singleton de `backend/src/lib/prisma.ts` (importado transitivamente vía `auth.ts`) captura `DATABASE_URL` al construirse, antes de que el test fije `process.env.DATABASE_URL` (hoisting de imports).

### 4.2 `npm test` — CON `DATABASE_URL` exportada + Postgres up

```
Test Files  13 passed (13)
Tests       40 passed (40)
✓ backend/__tests__/auth.otp.flow.test.ts (4 tests)
```

Con el entorno adecuado, los 40 tests pasan.

### 4.3 `npm run test:db` (suite db cambio-002) — CON `DATABASE_URL` + Postgres up

```
Test Files  3 failed (3)
Tests       6 failed (6)
→ backend/__tests__/db/{cascade,enum-constraint,relations}.test.ts

Foreign key constraint violated: `ClientProfile_userId_fkey (index)`
  at prisma.clientProfile.create({ data: { userId: 'u-c' } })  // relations.test.ts:93
  (análogo OperatorProfile / Message en cascade y enum-constraint)
```

→ **`npm run test:db` exit non-zero (CRITICAL C1).** La migración `add_auth_identity` (T4/REQ-001) convirtió `ClientProfile.userId`, `OperatorProfile.userId`, `Message.senderId` en **FKs reales** a `User.id` (`onDelete: Cascade`). Los tests db de cambio-002 (preexistentes) insertan perfiles/mensajes con `userId` sintético (ej. `'u-c'`) **sin** un `User` padre, violando la FK. **Regresión introducida por cambio-003**: la suite db de cambio-002 no fue actualizada para sembrar un `User` padre antes de insertar los perfiles.

### 4.4 Coverage (`npm test -- --coverage` con env)

```
All files        | % Stmts 97.98 | % Branch 92.3 | % Funcs 100 | % Lines 97.98 |
backend/src/app.ts              100 / 100 / 100 / 100
backend/src/lib/auth.ts         100 / 100 / 100 / 100
backend/src/lib/env.ts          100 / 100 / 100 / 100
backend/src/lib/plivo.ts        100 / 100 / 100 / 100
backend/src/middleware/auth.ts  87.09 / 71.42 / 100 / 87.09  (uncovered 63-66)
backend/src/middleware/errorHandler.ts  100
backend/src/middleware/notFound.ts      100
backend/src/routes/health.routes.ts     100
shared/src/schemas/*            100
shared/src/types/*              (auth.ts 0 — types-only, no runtime coverage)
```

Líneas 97.98% ≥ 80%, branch 92.3% ≥ 80%, functions 100% ≥ 80%, statements 97.98% ≥ 80%.
**Threshold global: PASS** (unit-only; la suite db no se incluyó por estar rota — coverage reportado solo para unit).

## 5. Spec compliance matrix (REQ → covering test → runtime result)

| REQ     | Escenario                                                                  | Covering test / evidence                                         | Result runtime                                                                                                              | Status                         |
| ------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| REQ-001 | `prisma validate` pasa                                                     | `npx prisma validate`                                            | exit 0 — "schema is valid 🚀"                                                                                               | ✅ PASS                        |
| REQ-001 | ClientProfile/OperatorProfile/Message FK → User Cascade                    | schema inspection                                                | `@relation(...) onDelete: Cascade` confirmado en las 3 FKs (schema.prisma)                                                  | ✅ PASS (inspection)           |
| REQ-001 | `phone @unique` + `role UserRole`                                          | schema inspection                                                | `phoneNumber String? @unique` + `role UserRole @default(CLIENT)` — **desviación** `phone`→`phoneNumber` (nullable) — ver W2 | ✅ PASS (deviation documented) |
| REQ-002 | existe migración `add_auth_identity` + migración aplicada                  | `prisma migrate status` + glob migrations                        | `20260703164734_add_auth_identity/migration.sql` existe; "Database schema is up to date!"                                   | ✅ PASS                        |
| REQ-003 | `auth` exportado, `auth.handler` función, `auth.api` phoneNumber           | `backend/__tests__/auth.config.test.ts`                          | 3/3 PASS (con env)                                                                                                          | ✅ PASS                        |
| REQ-004 | envs auth válidos + error claro si `BETTER_AUTH_SECRET` ausente            | `backend/__tests__/env.test.ts`                                  | 10/10 PASS                                                                                                                  | ✅ PASS                        |
| REQ-005 | Plivo dev (log) + Plivo real (mock messages.create)                        | `backend/__tests__/plivo.test.ts`                                | 2/2 PASS                                                                                                                    | ✅ PASS                        |
| REQ-006 | `POST /phone-number/send-otp` 2xx + 4xx sin phoneNumber + get-session null | `backend/__tests__/auth.otp.flow.test.ts` + `auth.mount.test.ts` | 4/4 + 2/2 PASS (con `DATABASE_URL` exportada) — nota C2 sobre dependencia de env                                            | ✅ PASS (env-dependent)        |
| REQ-007 | flujo end-to-end send → verify → cookie → get-session                      | `backend/__tests__/auth.otp.flow.test.ts`                        | 1/1 "flujo completo send → verify → get-session" PASS (con env)                                                             | ✅ PASS (env-dependent)        |
| REQ-008 | requireAuth sin cookie → 401 `UNAUTHORIZED`; con cookie → 200 + `req.user` | `backend/__tests__/middleware.auth.test.ts`                      | 4/4 PASS                                                                                                                    | ✅ PASS                        |
| REQ-009 | requireRole(OPERATOR) CLIENT→403 `FORBIDDEN`; OPERATOR→200                 | `backend/__tests__/middleware.auth.test.ts`                      | 4/4 PASS                                                                                                                    | ✅ PASS                        |
| REQ-010 | tests OTP no llaman Plivo real (vi.mock captura OTP)                       | `backend/__tests__/auth.otp.flow.test.ts`                        | 4/4 PASS (mock `sendOtp` captura `code`, no llamada Plivo)                                                                  | ✅ PASS                        |

**Compliance por REQ: 10/10 COMPLIANT** (todos con evidence runtime cuando el entorno está listo).
**Advertencia estructural:** los gate commands `npm test` (default) y `npm run test:db` no producen verde en su forma documentada — ver CRITICAL C1/C2.

## 6. Design coherence table

| Design § | Decisión de diseño                                                                                        | Implementación observada                                                                                                                             | Coherencia                           |
| -------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| §2       | File tree `lib/auth.ts`, `lib/plivo.ts`, `middleware/auth.ts`, `routes/index.ts` ampliado, barrels shared | presente y consistente                                                                                                                               | ✅ coherent                          |
| §3       | `verifyOTP: () => false` placeholder                                                                      | **omitido** — ADR-003 §callback verifyOTP documenta que `false` bloquearía toda verificación; se delega al verificador interno del plugin            | ⚠️ deviation (documented in ADR-003) |
| §3       | `phone String @unique` en User                                                                            | `phoneNumber String? @unique` (PascalCase, nullable; plugin `phoneNumber` exige el nombre; ADR-003 lo documenta)                                     | ⚠️ deviation (documented)            |
| §3       | `signUpOnVerification` no estaba en design                                                                | añadido en apply (T5) — necesario o `verify` lanza `FAILED_TO_UPDATE_USER` 500. ADR-003 lo documenta                                                 | ⚠️ added in apply (documented)       |
| §4       | `lib/plivo.ts` lazy require + `sendOtp` + dev mode                                                        | coincide                                                                                                                                             | ✅ coherent                          |
| §5       | env ampliado `BETTER_AUTH_*`, `PLIVO_*`                                                                   | coincide (T1 + T10)                                                                                                                                  | ✅ coherent                          |
| §6       | FKs reales ClientProfile/OperatorProfile/Message → User                                                   | coincide (onDelete Cascade, @unique en profiles, no unique en Message)                                                                               | ✅ coherent                          |
| §7       | middleware requireAuth + requireRole                                                                      | coincide — `middleware/auth.ts`                                                                                                                      | ✅ coherent                          |
| §8       | `app.all('/api/auth/*', ...)`                                                                             | implementado como `router.use('/api/auth', authHandler)` con `toNodeHandler(auth.handler)` — mejor-call reconstruye URL. ADR-003 documenta el ajuste | ⚠️ deviation (documented)            |
| §10      | "ningún comando nuevo"                                                                                    | se añadió `format:check` script (menor)                                                                                                              | ✅ coherent                          |
| §11      | tradeoffs `require('plivo')` lazy                                                                         | coincide                                                                                                                                             | ✅ coherent                          |

**Design coherence:** COHERENT con desviaciones documentadas en ADR-003 (phoneNumber column, verifyOTP omitido, signUpOnVerification añadido, mount vía `router.use`). Ninguna desviación rompe un REQ.

## 7. Issues por severidad

### CRITICAL

**C1 — `npm run test:db` RED: la suite db de cambio-002 quedó rota por las FK de `add_auth_identity`**

- **Síntoma:** `npm run test:db` (con `DATABASE_URL` exportada + Postgres up) → 3 archivos / 6 tests FAIL con `Foreign key constraint violated: ClientProfile_userId_fkey`.
- **Root cause:** la migración `add_auth_identity` (T4, REQ-001) convirtió `ClientProfile.userId`, `OperatorProfile.userId`, `Message.senderId` en **FKs reales** a `User.id` (`onDelete: Cascade`). Los tests db preexistentes de cambio-002 (`backend/__tests__/db/cascade.test.ts`, `relations.test.ts`, `enum-constraint.test.ts`) insertan perfiles/mensajes con `userId` sintético (p.ej. `'u-c'`) y **sin** un `User` padre → el INSERT viola la FK.
- **Regresión introducida por cambio-003:** la suite db de cambio-002 no fue actualizada para crear un `User` padre antes de crear perfiles/mensajes (ni para incluir `User` en el `TRUNCATE ... CASCADE` de `helpers.ts:resetDb`).
- **Comando de evidencia:** `DATABASE_URL='postgresql://destrabe:destrabe@localhost:5432/destrabe_db' npm run test:db` → exit 1, 6 failed.
- **Gate:** `npm run test:db` exits non-zero → **CRITICAL**.

**C2 — `npm test` (default unit) RED sin `DATABASE_URL` en el entorno**

- **Síntoma:** `npm test` (sin `DATABASE_URL` exportada, Postgres up) → 1 archivo / 3 tests FAIL con `PrismaClientInitializationError: Environment variable not found: DATABASE_URL` y respuestas `500` en `/phone-number/send-otp`.
- **Root cause:** `backend/__tests__/auth.otp.flow.test.ts` (test db smoke que cubre REQ-006/007/010) está bajo `backend/__tests__/` (NO bajo `backend/__tests__/db/`). `vitest.config.ts` incluye `backend/__tests__/**/*.test.ts` y solo excluye `**/__tests__/db/**`, así que el default `npm test` levanta este test. El test fija `process.env.DATABASE_URL` en su cuerpo (líneas 35-37), pero el `PrismaClient` singleton en `backend/src/lib/prisma.ts` (importado transitivamente vía `auth.ts` → `createApp`) se construye durante el hoisting de imports, antes de que la asignación de `process.env` del test se ejecute → captura `DATABASE_URL=undefined`. Mejor-Auth entonces falla al persistir el `Verification` con el error de env. El test solo pasa cuando `DATABASE_URL` se inyecta en el proceso que lanza vitest.
- **Evidencia:]
  - Sin env: `npm test` → 3 failed / 37 passed, exit 1.
  - Con env (`DATABASE_URL=... npm test`): 40 passed, exit 0.
- **ADR-003 §Cojecuencias negativas** ya documenta este gotcha del singleton de prisma, pero la configuración de tests no lo mitiga (el test sigue bajo `backend/__tests__/` en lugar de `backend/__tests__/db/`, y no hay setupFile que cargue `.env` para el default run).
- **Spec contract:** la spec encabeza "Unit tests no requieren DB; db y flujo OTP requieren Postgres up (`npm run db:up`)". El default `npm test` viola ese contrato al incluir `auth.otp.flow.test.ts` (que sí requiere DB).
- **Gate:** el comando unit canónico exits non-zero en su forma documentada → **CRITICAL**.

### WARNING

**W1 — `prettier --check .` falla (29 archivos con issues de formato)**

- `npx prettier --check .` → exit 1, 29 archivos. `npm run format` los arreglaría. No se aplicó en verify.

**W2 — Desviaciones de spec aceptadas (documentadas en ADR-003)**

- **`phone` → `phoneNumber`:** spec REQ-001/§6 exigía `phone String @unique` (non-nullable). El plugin `phoneNumber` de Better Auth impone el nombre `phoneNumber` (PascalCase, no configurable) y se dejó nullable (`String?`) para soportar registro solo-por-email futuro. Documentado en ADR-003 §phoneNumber + comentario en `schema.prisma:158-168` + normalización a `phone` en `req.user` (T7/T8).
- **Rutas de endpoints:** spec §7.1 usaba `/phone/send-otp` y `/phone/verify-otp`; el plugin expone `/phone-number/send-otp` y `/phone-number/verify`. Documentado en ADR-003 §Endpoints + header de `auth.otp.flow.test.ts`.
- **`verifyOTP` omitido** (design §3 proponía `() => false`); **`signUpOnVerification` añadido**; **montaje** vía `router.use('/api/auth', authHandler)` en lugar de `app.all('/api/auth/*', ...)`. Todos documentados en ADR-003.
- El orchestrator indicó explícitamente que estas desviaciones están documentadas y aceptadas → no se marcan CRITICAL; WARNING/Nota.

### SUGGESTION

**S1 — Mover el db smoke a `backend/__tests__/db/` o cargar `.env` en setupFiles**

- Resolvería C2: o bien reubica `auth.otp.flow.test.ts` bajo `backend/__tests__/db/` (para que `npm test` default lo excluya y `npm run test:db` lo ejecute — requiere también ampliar el `include` de `vitest.db.config.ts`), o bien añade un `setupFiles` en `vitest.config.ts` que cargue `backend/.env` para todos los runs. ADR-003 ya describe la trampa; solo falta materializar la mitigación.

**S2 — Actualizar los db tests de cambio-002 para sembrar `User` padre**

- Resolvería C1: `cascade/relations/enum-constraint` deben crear un `User` antes de crear `ClientProfile`/`OperatorProfile`/`Message`, y `helpers.ts:resetDb()` debe incluir `User` (y respetar el orden de FKs) en el `TRUNCATE`. Aunque los tests son cambio-002, la regresión fue introducida por el cambio de FK de cambio-003 → el cambio debe ownership.

## 8. Veredicto final

**FAIL**

Dos gate commands fallan en su forma documentada:

1. `npm test` (default) → exit non-zero (3 failed) sin `DATABASE_URL` en el entorno (C2). La inclusión de un test db-dependiente en el suite unit canónico rompe el contrato "unit tests no requieren DB" y el singleton de Prisma captura la env var antes de que el test la fije.
2. `npm run test:db` → exit non-zero (6 failed) por la regresión de FK introducida por `add_auth_identity` sobre los tests db de cambio-002 (C1).

**Lado positivo:** cuando el entorno está correctamente preparado (`DATABASE_URL` exportado + Postgres up) **los 10 REQs están COMPLIANT** con evidence runtime (40/40 unit tests verdes, incluido el flujo OTP end-to-end REQ-006/007/010), el schema es válido, la migración está aplicada, el type-check/lint del backend pasa limpio, y la cobertura global supera el umbral 80% (97.98% lines). Solo el formato Prettier (W1) y las desviaciones de spec ya aceptadas (W2) quedan como warnings menores.

C1 y C2 deben resolverse antes de archive (cambio-003 no está listo para `archive`). Las sugerencias S1 y S2 indican el camino; no se fixearon en verify (solo reportan).
