# Verify Report — Cambio-003: Better Auth (OTP + Identity)

**Change ID:** `cambio-003-auth`
**Etapa SDD:** Verify
**Branch:** `feature/cambio-003-auth`
**Verificador:** sdd-verify executor (Standard TDD mode, repo-local)
**Fecha:** 2026-07-03
**TDD mode:** Standard (NO strict TDD)
**Veredicto final:** **PASS WITH WARNINGS** (C1/C2/W1 RESOLVED post-fix; W2 desviaciones aceptadas documentadas)

> **Re-verify post-fix:** la primera pasada arrojó FAIL por 2 CRITICAL (C1, C2) + W1 (prettier).
> El orchestrator aplicó S1 (mover `auth.otp.flow.test.ts` a `backend/__tests__/db/`) y S2
> (ampliar `resetDb()` + helper `seedUser()` para sembrar `User` padre en db tests de cambio-002),
> y `npm run format` (W1). Esta segunda pasada re-ejecutó los gate commands canónicos y los
> encontró verdes. Commit de los fixes: `462d974`.

---

## 1. Completeness table

| Artefacto     | Estado    | Notas                                                             |
| ------------- | --------- | ----------------------------------------------------------------- |
| proposal      | done      | `docs/proposals/cambio-003-auth/proposal.md` leído                |
| specs         | done      | `docs/specs/cambio-003-auth/spec.md` — 10 REQs (REQ-001..REQ-010) |
| design        | done      | `docs/designs/cambio-003-auth/design.md` leído                    |
| tasks         | done      | 12/12 tareas completadas (`docs/tasks/cambio-003-auth/tasks.md`)  |
| applyProgress | done      | Commits hasta `a23aaea` (T1..T12) + fix `462d974`                 |
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

## 3. Build / type-check / lint / format evidence (post-fix)

| Comando                                       | Resultado | Notas                                           |
| --------------------------------------------- | --------- | ----------------------------------------------- |
| `npm run build -w @destrabe/shared`           | ✅ exit 0 | shared compila limpio                           |
| `npx tsc --noEmit -p backend/tsconfig.json`   | ✅ exit 0 | backend type-check limpio                       |
| `npm run lint` (`eslint .`)                   | ✅ exit 0 | sin warnings                                    |
| `npm run format:check` (`prettier --check .`) | ✅ exit 0 | All files use Prettier code style (W1 RESOLVED) |

## 4. Test / coverage evidence (post-fix)

### 4.1 `npm test` (default unit suite) — SIN `DATABASE_URL` en entorno

```
Test Files  12 passed (12)
Tests       36 passed (36)
✓ backend/__tests__/plivo.test.ts (2)
✓ backend/__tests__/env.test.ts (10)
✓ shared/__tests__/no-prisma-import.test.ts (1)
✓ backend/__tests__/middleware.auth.test.ts (4)
✓ backend/__tests__/shared.integration.test.ts (2)
✓ shared/__tests__/serviceStatus.schema.test.ts (3)
✓ shared/__tests__/enums.schema.test.ts (6)
✓ backend/__tests__/errorHandler.test.ts (1)
✓ backend/__tests__/auth.config.test.ts (3)
✓ backend/__tests__/notFound.test.ts (1)
✓ backend/__tests__/health.route.test.ts (1)
✓ backend/__tests__/auth.mount.test.ts (2)
```

→ **`npm test` exit 0 (C2 RESOLVED).** Tras mover `auth.otp.flow.test.ts` a
`backend/__tests__/db/`, el exclude `**/__tests__/db/**` de `vitest.config.ts` lo omite del
suite unit canónico. El test db-dependiente ya no rompe el contrato "unit tests no requieren DB".

### 4.2 `npm run test:db` — CON `DATABASE_URL` + Postgres up

```
Test Files  4 passed (4)
Tests       10 passed (10)
✓ backend/__tests__/db/auth.otp.flow.test.ts (4)
✓ backend/__tests__/db/relations.test.ts (2)
✓ backend/__tests__/db/cascade.test.ts (2)
✓ backend/__tests__/db/enum-constraint.test.ts (2)
```

→ **`npm run test:db` exit 0 (C1 RESOLVED).** `resetDb()` ampliado con
`Verification/Account/Session/User` (TRUNCATE CASCADE) y helper `seedUser()` siembra un `User`
padre en los 3 db tests de cambio-002 antes de crear perfiles/mensajes, satisfaciendo las FKs
reales introducidas por `add_auth_identity`. El flujo OTP end-to-end (T9) sigue verde.

### 4.3 Coverage (`npm test -- --coverage` con env)

```
All files        | % Stmts 98 | % Branch 91.66 | % Funcs 80 | % Lines 98
 backend/src/app.ts              100 / 100 / 100 / 100
 backend/src/lib/auth.ts         100 / 100 / 0 / 100
 backend/src/lib/env.ts          100 / 100 / 100 / 100
 backend/src/lib/plivo.ts        100 / 100 / 100 / 100
 backend/src/middleware/auth.ts  87.09 / 71.42 / 100 / 87.09  (uncovered 63-66)
 backend/src/middleware/errorHandler.ts  100
 backend/src/middleware/notFound.ts      100
 backend/src/routes/health.routes.ts     100
 shared/src/schemas/*            100
 shared/src/types/auth.ts        0 (types-only, no runtime coverage)
```

Líneas 98% ≥ 80%, branch 91.66% ≥ 80%, functions 80% ≥ 80%, statements 98% ≥ 80%.
**Threshold global: PASS.**

## 5. Spec compliance matrix (REQ → covering test → runtime result)

| REQ     | Escenario                                                                  | Covering test / evidence                                            | Result runtime                                                                                                              | Status                              |
| ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| REQ-001 | `prisma validate` pasa                                                     | `npx prisma validate`                                               | exit 0 — "schema is valid 🚀"                                                                                               | ✅ COMPLIANT                        |
| REQ-001 | ClientProfile/OperatorProfile/Message FK → User Cascade                    | schema inspection                                                   | `@relation(...) onDelete: Cascade` confirmado en las 3 FKs (schema.prisma)                                                  | ✅ COMPLIANT (inspection)           |
| REQ-001 | `phone @unique` + `role UserRole`                                          | schema inspection                                                   | `phoneNumber String? @unique` + `role UserRole @default(CLIENT)` — **desviación** `phone`→`phoneNumber` (nullable) — ver W2 | ✅ COMPLIANT (deviation documented) |
| REQ-002 | existe migración `add_auth_identity` + migración aplicada                  | `prisma migrate status` + glob migrations                           | `20260703164734_add_auth_identity/migration.sql` existe; "Database schema is up to date!"                                   | ✅ COMPLIANT                        |
| REQ-003 | `auth` exportado, `auth.handler` función, `auth.api` phoneNumber           | `backend/__tests__/auth.config.test.ts`                             | 3/3 PASS                                                                                                                    | ✅ COMPLIANT                        |
| REQ-004 | envs auth válidos + error claro si `BETTER_AUTH_SECRET` ausente            | `backend/__tests__/env.test.ts`                                     | 10/10 PASS                                                                                                                  | ✅ COMPLIANT                        |
| REQ-005 | Plivo dev (log) + Plivo real (mock messages.create)                        | `backend/__tests__/plivo.test.ts`                                   | 2/2 PASS                                                                                                                    | ✅ COMPLIANT                        |
| REQ-006 | `POST /phone-number/send-otp` 2xx + 4xx sin phoneNumber + get-session null | `backend/__tests__/db/auth.otp.flow.test.ts` + `auth.mount.test.ts` | 4/4 + 2/2 PASS (en `test:db`)                                                                                               | ✅ COMPLIANT                        |
| REQ-007 | flujo end-to-end send → verify → cookie → get-session                      | `backend/__tests__/db/auth.otp.flow.test.ts`                        | 1/1 "flujo completo send → verify → get-session" PASS                                                                       | ✅ COMPLIANT                        |
| REQ-008 | requireAuth sin cookie → 401 `UNAUTHORIZED`; con cookie → 200 + `req.user` | `backend/__tests__/middleware.auth.test.ts`                         | 4/4 PASS                                                                                                                    | ✅ COMPLIANT                        |
| REQ-009 | requireRole(OPERATOR) CLIENT→403 `FORBIDDEN`; OPERATOR→200                 | `backend/__tests__/middleware.auth.test.ts`                         | 4/4 PASS                                                                                                                    | ✅ COMPLIANT                        |
| REQ-010 | tests OTP no llaman Plivo real (vi.mock captura OTP)                       | `backend/__tests__/db/auth.otp.flow.test.ts`                        | 4/4 PASS (mock `sendOtp` captura `code`, no llamada Plivo)                                                                  | ✅ COMPLIANT                        |

**Compliance por REQ: 10/10 COMPLIANT** con evidence runtime de los gate canónicos.

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

## 7. Issues por severidad (post-fix)

### CRITICAL

**None.** C1 y C2 RESOLVED en commit `462d974`.

- **C1 (RESOLVED)** — `npm run test:db` RED por FK regression. Fix: `resetDb()` ampliado con tablas auth + helper `seedUser()` siembra `User` padre en los db tests de cambio-002.
- **C2 (RESOLVED)** — `npm test` (unit) RED sin `DATABASE_URL`. Fix: `auth.otp.flow.test.ts` movido a `backend/__tests__/db/` (excluido del suite unit, incluido en `test:db`).

### WARNING

**W2 — Desviaciones de spec aceptadas (documentadas en ADR-003)**

- **`phone` → `phoneNumber`:** spec REQ-001/§6 exigía `phone String @unique` (non-nullable). El plugin `phoneNumber` de Better Auth impone el nombre `phoneNumber` (PascalCase, no configurable) y se dejó nullable (`String?`) para soportar registro solo-por-email futuro. Documentado en ADR-003 §phoneNumber + comentario en `schema.prisma:158-168` + normalización a `phone` en `req.user` (T7/T8).
- **Rutas de endpoints:** spec §7.1 usaba `/phone/send-otp` y `/phone/verify-otp`; el plugin expone `/phone-number/send-otp` y `/phone-number/verify`. Documentado en ADR-003 §Endpoints + header de `db/auth.otp.flow.test.ts`.
- **`verifyOTP` omitido** (design §3 proponía `() => false`); **`signUpOnVerification` añadido**; **montaje** vía `router.use('/api/auth', authHandler)` en lugar de `app.all('/api/auth/*', ...)`. Todos documentados en ADR-003.
- El orchestrator indicó explícitamente que estas desviaciones están documentadas y aceptadas → WARNING/Nota (no CRITICAL).

### SUGGESTION

**None adicionales.** S1 y S2 (de la primera pasada) fueron implementados y resolvieron C1/C2.

## 8. Veredicto final

**PASS WITH WARNINGS**

Todos los gate commands canónicos pasan en su forma documentada:

1. `npm test` (default unit, sin `DATABASE_URL`) → exit 0, 36/36 PASS (C2 resuelto).
2. `npm run test:db` (con `DATABASE_URL` + Postgres up) → exit 0, 10/10 PASS (C1 resuelto).
3. `npm run build -w @destrabe/shared` + `tsc --noEmit -p backend` → exit 0.
4. `npm run lint` → exit 0.
5. `npm run format:check` → exit 0 (W1 resuelto).
6. Coverage global 98% lines / 91.66% branch / 80% funcs / 98% stmts (≥ 80% threshold).

**Los 10 REQs están COMPLIANT** con evidence runtime de los gate canónicos (incluido el flujo
OTP end-to-end REQ-006/007/010, los middleware REQ-008/009, y la validación de schema/migración
REQ-001/002). El schema es válido, la migración `add_auth_identity` está aplicada, el
type-check/lint/format del backend pasa limpio.

Las únicas warnings restantes son las **desviaciones de spec aceptadas y documentadas en ADR-003**
(W2: `phoneNumber` column, rutas `/phone-number/*`, `verifyOTP` omitido, `signUpOnVerification`
añadido, montaje vía `router.use`) — ninguna rompe un REQ y todas están registradas en el ADR y
en comentarios del schema/test.

**Cambio-003-auth está listo para `archive`** (merge `feature/cambio-003-auth` → `develop`).
