# Exploration — Cambio-003: Better Auth (OTP + Identity)

**Change ID:** `cambio-003-auth`
**Etapa SDD:** Explore
**Branch:** `feature/cambio-003-auth`
**Basado en:** spec §6 (modelo User/Session), §7.1 (flujo OTP), ADR-003

## Current State

`cambio-001` y `cambio-002` mergeados en `develop` (f1fa6c1). Schema Prisma tiene 7 modelos de dominio (sin User/Session). Perfiles referencian `userId` como String sin FK + comentario `// FK a User (cambio-003)`. Este cambio añade la capa de identidad y los endpoints de auth.

## Affected Areas

- `backend/prisma/schema.prisma` — añadir modelos User, Session, Account, Verification (generados por Better Auth CLI); FKs reales de ClientProfile/OperatorProfile/Message.userId a User.
- `backend/prisma/migrations/` — nueva migración.
- `backend/src/lib/auth.ts` — config Better Auth (betterAuth + prismaAdapter + phoneNumber plugin).
- `backend/src/lib/plivo.ts` — cliente Plivo para SMS OTP (o mock si no está configurado).
- `backend/src/routes/auth.routes.ts` — handler `POST /auth/phone/send`, `POST /auth/phone/verify`, `GET /auth/session` (Better Auth handlers montados en `/api/auth/*` o expuestos manualmente).
- `backend/src/lib/env.ts` — añadir `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `PLIVO_AUTH_ID/TOKEN/NUMBER`.
- `backend/src/middleware/` — auth middleware (validar sesión Better Auth), role guard (CLIENT/OPERATOR/ADMIN).
- `shared/src/` — tipos/schemas auth (login request, session response).
- `backend/.env.example` — vars de Better Auth + Plivo.
- `docs/adr/` — migrar ADR-003 a archivo propio (o referenciar el spec).

## Approaches

| Decisión                            | Opción A                                                                  | Opción B                                  | Recomitorio                                                                                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Better Auth handlers                | Montar handler base `app.all('/api/auth/*', toNodeHandler(auth.handler))` | Exponer solo endpoints custom adaptados   | **Opción A** — usando el handler base de Better Auth para auth/phone/send, auth/phone/verify, auth/session, auth/sign-out. Menor fricción.                                                                                         |
| Plivo en tests                      | Mock Plivo (interceptar sendOTP) — OTP generado por library               | Real Plivo (requiere crdenciales + costo) | **Mock** — `sendOTP` callback se reemplaza en tests por una fn que guarda el OTP en memoria. Permite full TDD.                                                                                                                     |
| Modelos User/Session                | Generar con `npx auth generate` (Better Auth CLI) + ajustar campos (role) | Definir manualmente en schema.prisma      | **Generate + ajustar** — Better Auth define estructura exacta (id, email, name, emailVerified, token, expiresAt, etc.). Ajustar para añadir `role` (UserRole enum) via `user.additionalFields` y mapear phone como campo del user. |
| phone como identificador de usuario | Campo `phone` en User (additional field) + usar phoneNumber plugin        | email con phone fake                      | **phone en User** — la auth es exclusivamente por phone (spec §6 User.phone @unique). Better Auth phoneNumber plugin soporta login por phone.                                                                                      |
| Rotación/refresh de tokens          | Delegar a Better Auth (gestiona sessions JWT)                             | Implementar refresh manual                | **Delegar** — ADR-003 dice "Sin SDK RN oficial; implementar refresh manualmente" pero para el backend, Better Auth gestiona sessions. El refresh en mobile es futuro (cambio mobile).                                              |
| OTP verification storage            | Better Auth genera y persiste OTP en tabla Verification                   | Implementar OTP propio                    | **Better Auth** — la librería maneja generación (6 dígitos), persistencia, expiración. Solo proveemos sendOTP y verifyOTP callbacks.                                                                                               |

## Recommendation

**Scope del cambio-003:** Integrar Better Auth al backend con el plugin `phoneNumber` (flow send/verify OTP), crear modelos User/Session/Account/Verification en Prisma + migración, añadir FKs reales de los perfiles/Message a User, endpoints de auth montados en `/api/auth/*`, y middleware de auth (validar sesión + role guard). Plivo como proveedor SMS (mockeable en tests).

### Decisiones concretas

1. **Better Auth config** (`backend/src/lib/auth.ts`):
   - `betterAuth({ database: prismaAdapter(prisma, { provider: 'postgresql' }), secret: env.BETTER_AUTH_SECRET, baseURL: env.BETTER_AUTH_URL, plugins: [phoneNumber({ sendOTP, verifyOTP, otpLength: 6, expiresIn: 5min })], user: { additionalFields: { role: { type: 'string', required: true, defaultValue: 'CLIENT' } } } })`.
   - `sendOTP`: llama Plivo si configurado; si no (dev/test), loggea OTP.
   - `verifyOTP`: delega a Better Auth (que chequea la tabla Verification).

2. **Plivo client** (`backend/src/lib/plivo.ts`):
   - Wrapper sobre `plivo` npm client.
   - `sendOtp(phone, code)`: envía SMS vía Plivo.
   - Si `PLIVO_AUTH_ID` no configurado → modo dev: loggea OTP en consola (para tests/desarrollo sin costo).

3. **Schema Prisma**:
   - Ejecutar `npx auth generate` para generar modelos `User`, `Session`, `Account`, `Verification`.
   - `User`: añadir `phone String @unique`, `role UserRole`, `createdAt`, `updatedAt` (campos del spec §6).
   - Convertir `ClientProfile.userId`, `OperatorProfile.userId`, `Message.senderId` de String a FK real (`@relation` a User).
   - Quitar comentarios `// FK a User (cambio-003)`.
   - Nueva migración.

4. **Auth handlers** (Express):
   - `app.all('/api/auth/*', toNodeHandler(auth.handler))` que monta todos los endpoints de Better Auth.
   - Endpoints resultantes: `POST /api/auth/phone/send-otp`, `POST /api/auth/phone/verify-otp`, `GET /api/auth/session`, `POST /api/auth/sign-out` (nombres del plugin phoneNumber).

5. **Auth middleware** (`backend/src/middleware/auth.ts`):
   - `requireAuth`: valida sesión Better Auth (leer cookie/header, buscar session, setear req.user).
   - `requireRole(role)`: guard que checa `req.user.role`.

6. **Env**: añadir `BETTER_AUTH_SECRET` (>32 chars), `BETTER_AUTH_URL` (base URL), `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN`, `PLIVO_PHONE_NUMBER` al `.env.example`.

7. **TDD**: tests unit para env (nuevas vars), plivo mock, auth middleware (sin/ con sesión válida/ inválida), role guard. Tests db para modelos User/Session. El flujo completo OTP (send + verify) vía supertest con Plivo mocked (capturar OTP y reintegrarlo).

## Risks

- **Better Auth + Prisma schema mismatch**: `npx auth generate` puede sobrescribir el schema. Mitigación: correr generate, revisar diff, ajustar manualmente (añadir phone, role, FKs), commitear el ajuste.
- **Versión de Better Auth**: librería joven (1.x); API puede cambiar. Mitigación: fijar versión en package.json; documentar en ADR-003.
- **phoneNumber plugin API**: nombres de endpoints exactos (`/phone/send-otp` vs `/send-otp`). Mitigación: verificar en design con la versión instalada.
- **Sin SDK RN**: el cliente mobile deberá consumir la API REST de Better Auth directamente (con cookies/sessions). Este cambio cubre solo backend; el refresh manual mobile es cambio futuro.
- **Better Auth uses cookies for sessions**: supertest debe manejar cookies (cookie jar) para tests de flujo. Revisar.

## Ready for Proposal

**Yes.** Stack y enfoque claros. Próximo: etapa `propose`.
