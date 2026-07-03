# Tasks — Cambio-003: Better Auth (OTP + Identity)

**Change ID:** `cambio-003-auth`
**Etapa SDD:** Tasks
**Basado en:** `docs/designs/cambio-003-auth/design.md`
**Branch:** `feature/cambio-003-auth`

> Tareas ordenadas. TDD donde aplique. T3/T5/T6/T9 requieren Postgres up.

---

## T1 — Instalar deps + ampliar env globals _(no TDD — setup)_

**Acción:**

- `npm install better-auth plivo -w @destrabe/backend` (fijar versión tras install con `npm pkg get`).
- `backend/src/lib/env.ts` añadir `BETTER_AUTH_SECRET` (min 32), `BETTER_AUTH_URL` (url), `PLIVO_*` opt.
- `backend/.env.example` añadir las nuevas vars.
- Backend `.env` dev: `BETTER_AUTH_SECRET` dummy 32+ chars, `BETTER_AUTH_URL=http://localhost:3000`.

**Acepta:** env valida (tests viejos aún pasan); `better-auth` y `plivo` en `node_modules`.

---

## T2 — Plivo client (TDD) _(unit, no Docker)_

**Test primero:** `backend/__tests__/plivo.test.ts`

- sin `PLIVO_AUTH_ID`: `sendOtp` loggea OTP sin llamada externa (mock console.log) → REQ-005.
- con `PLIVO_AUTH_ID/TOKEN/PHONE`: `sendOtp` invoca `client.messages.create` (mock módulo plivo) → REQ-005.

**Luego impl:** `backend/src/lib/plivo.ts` (lazy require, sendOtp, dev mode).

**Acepta (REQ-005):** tests unit green.

---

## T3 — Schema Better Auth: User/Session/Account/Verification _(requiere PG up)_

**Acción:**

1. Levantar Postgres (`npm run db:up`).
2. `cd backend && DATABASE_URL=... npx auth generate` → genera diff en `schema.prisma`.
3. **Revisar diff** y ajustar a mano:
   - `User`: añadir `phone String @unique`, `role UserRole @default(CLIENT)`, `createdAt`, `updatedAt`; mapear campos de spec §6 + Better Auth.
   - FKs reales: `ClientProfile.userId → User` (@unique, onDelete Cascade), `OperatorProfile.userId → User`, `Message.senderId → User`.
   - Quitar comentarios `// FK a User (cambio-003)`.
4. `npx prisma format --schema=backend/prisma/schema.prisma`.
5. `npx prisma validate`.

**Acepta (REQ-001):** prisma validate exit 0; diff de schema limpio (nada inesperado).

---

## T4 — Migración add_auth_identity _(requiere PG up, incluye T3)_

**Acción:**

- `DATABASE_URL=... npx prisma migrate dev --name add_auth_identity --schema=backend/prisma/schema.prisma`.
- `npx prisma generate`.

**Acepta (REQ-002):** migración versionada creada; prisma client con modelos auth.

---

## T5 — auth.ts config (TDD) _(unit, no Docker)_

**Test primero:** `backend/__tests__/auth.config.test.ts`

- `auth` es exportado. `auth.handler` es función. `auth.api` expone métodos phoneNumber → REQ-003.

**Luego impl:** `backend/src/lib/auth.ts` (betterAuth + prismaAdapter + phoneNumber plugin + additionalFields.role + authHandler como toNodeHandler).

**Acepta (REQ-003):** test green (importar auth no debe fallar).

---

## T6 — Montar handlers en app.ts/router _(requiere PG up para runtime check)_

**Acción:**

- `routes/index.ts` añadir `router.use('/api/auth', authHandler)`.

**Test db:** `auth.otp.flow.test.ts` en T9 cubre reqs 006-007. Aquí solo smoke:montaje correcto.

**Acepta (REQ-006 parcial):** boot del server exitoso; `/api/auth/*` responde (aunque sea 404 de better-auth).

---

## T7 — Middleware requireAuth + requireRole (TDD) _(unit, mock de session)_

**Test primero:** `backend/__tests__/middleware.auth.test.ts`

- `requireAuth` sin cookie → 401 {error, code:UNAUTHORIZED} (mock auth.api.getSession retorna null) → REQ-008.
- `requireAuth` con cookie válida → req.user seteado, next() → REQ-008.
- `requireRole(OPERATOR)` con user.role=CLIENT → 403 {error, code:FORBIDDEN} → REQ-009.
- `requireRole(OPERATOR)` con user.role=OPERATOR → next() → REQ-009.

**Luego impl:** `backend/src/middleware/auth.ts`.

**Acepta (REQ-008, REQ-009):** tests unit green.

---

## T8 — shared: tipos auth + schemas Zod _(no Docker)_

**Crea:** `shared/src/types/auth.ts`, `shared/src/schemas/auth.schema.ts`, ampliar barrels.

Actualiza barrels. Build shared.

**Acepta:** por ahora lo dejo sin nuevo test (se puede añadir test de tipo/schema si aplica).

---

## T9 — Flujo OTP end-to-end (db smoke TDD) _(requiere PG up + T4 + T6)_

**Test primero:** `backend/__tests__/auth.otp.flow.test.ts`

- helper Plivo mock captura OTP (`vi.mock('./plivo',...)`).
- POST `/api/auth/phone/send-otp` `{phoneNumber}` → 2xx, captura OTP → REQ-006/007.
- POST `/api/auth/phone/verify-otp` `{phoneNumber, code: <capturado>}` con `request.agent(app)` (cookie jar) → 2xx + cookie seteada → REQ-007.
- GET `/api/auth/session` con cookie → responde con user (phone coincide) → REQ-007.
- (Opcional) POST `/api/auth/sign-out` → cookie limpiada; GET /api/auth/session → null.

**Acepta (REQ-006, REQ-007, REQ-010):** tests db green.

**Nota:** `verifyOTP` callback en `auth.ts` puede ajustarse aquí según API real del plugin. Documentar el ajuste si aplica.

---

## T10 — Ampliar tests de env (TDD) _(unit, no Docker)_

**Test primero:** `backend/__tests__/env.test.ts` ampliar:

- envs auth válidos → `env.BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` seteados → REQ-004.
- `BETTER_AUTH_SECRET` ausente → lanza error que menciona `BETTER_AUTH_SECRET` → REQ-004.

**Acepta (REQ-004):** tests unit green.

---

## T11 — ADR-003 documentación _(sin test)_

**Crea:** `docs/adr/ADR-003-better-auth.md` (migrar contenido de spec §10 ADR-003 al formato propio).

**Acepta:** documentación coherente.

---

## T12 — Docs finales (README + testing strategy) _(sin test)_

Actualiza `README.md` (mención auth endpoints) y `docs/testing/estrategia.md` (suite db para auth flow).

**Acepta:** docs coherentes.

---

## Orden de ejecución (apply)

`T1 → T2 → T5 → T7 → T10 → T8 → T3 → T4 → T6 → T9 → T11 → T12`

(T1/T2/T5/T7/T8/T10 no requieren Docker; T3/T4/T6/T9 sí. Agrupados al final.)

## Commit strategy

Conventional por tarea o grupo lógico: `chore(backend): install better-auth plivo`, `feat(backend): add env auth vars`, `feat(backend): add plivo client with dev mode`, `feat(backend): add Better Auth config`, `feat(backend): add User/Session/Account/Verification models`, `feat(backend): add auth identity migration`, `feat(backend): mount auth handlers`, `feat(backend): add requireAuth and requireRole middleware`, `feat(shared): add auth types`, `test(backend): add otp flow e2e`, `docs: add ADR-003`.

## Next

Etapa `apply`: ejecutar T1→T12 con TDD.

---

## Progreso apply

- [x] T1 — Instalar deps + ampliar env globals (better-auth ^1.6.23, plivo ^4.78.0)
- [x] T2 — Plivo client (TDD)
- [x] T3 — Schema Better Auth: User/Session/Account/Verification (requiere PG up)
- [x] T4 — Migración add_auth_identity (requiere PG up)
- [x] T5 — auth.ts config (TDD)
- [x] T6 — Montar handlers en app.ts/router (requiere PG up)
- [x] T7 — Middleware requireAuth + requireRole (TDD)
- [x] T8 — shared: tipos auth + schemas Zod
- [x] T9 — Flujo OTP end-to-end (requiere PG up)
- [x] T10 — Ampliar tests de env (TDD)
- [ ] T11 — ADR-003 documentación
- [ ] T12 — Docs finales (README + testing strategy)
