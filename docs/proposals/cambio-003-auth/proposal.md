# Change Proposal — Cambio-003: Better Auth (OTP + Identity)

**Change ID:** `cambio-003-auth`
**Etapa SDD:** Propose
**Estado:** Aprobado para spec
**Branch:** `feature/cambio-003-auth`
**Basado en:** `docs/proposals/cambio-003-auth/exploration.md`

## Intent

Integrar Better Auth al backend para habilitar autenticación por teléfono (OTP SMS vía Plivo), crear los modelos de identidad (`User`, `Session`, `Account`, `Verification`) en Prisma y cerrar las FKs que el cambio-002 dejó como String sin relación. Al terminar: flujo completo `POST /api/auth/phone/send-otp` → `POST /api/auth/phone/verify-otp` → sesión cookie válida → `GET /api/auth/session` protegido por middleware.

## Context

La spec §6 define `User` (con `phone @unique`, `role UserRole`) y `Session` gestionados por Better Auth (ADR-003: open source, self-hosted en mismo Postgres). El cambio-002 difirió `User`/`Session` a este cambio. Better Auth es una librería TypeScript framework-agnostic que provee `prismaAdapter` + plugin `phoneNumber` con callbacks `sendOTP`/`verifyOTP`, gestión de JWT sessions vía cookies, y CLI `npx auth generate` para generar la capa de identidad en Prisma.

## Scope

### In scope

- **Dependencias:** `better-auth`, `plivo` en `backend/package.json`.
- **`backend/prisma/schema.prisma`**:
  - Añadir modelos `User` (con `phone String @unique`, `role UserRole`, `name String?`, `email String? @unique`, `emailVerified Boolean`, `createdAt`, `updatedAt`), `Session` (`token String @unique`, `userId`, `expiresAt`, `createdAt`), `Account` (Better Auth OAuth-ready), `Verification` (`identifier`, `value`, `expiresAt`) — generados por `npx auth generate` y ajustados.
  - Convertir `ClientProfile.userId`, `OperatorProfile.userId`, `Message.senderId` a **FKs reales** (`@relation` a `User`, `onDelete: Cascade`). Quitar comentarios `// FK a User (cambio-003)`.
  - Nueva migración.
- **`backend/src/lib/auth.ts`**: configuración `betterAuth` (prismaAdapter, secret, baseURL, plugin `phoneNumber` con `sendOTP`→Plivo o log en dev, `verifyOTP` delegado, `otpLength: 6`, `expiresIn: 5m`), `user.additionalFields.role` (UserRole, default CLIENT).
- **`backend/src/lib/plivo.ts`**: cliente Plivo + `sendOtp(phone, code)`. Modo dev: loggea OTP si `PLIVO_AUTH_ID` no configurado (sin costo).
- **`backend/src/routes/auth.routes.ts`** (o montar handler base): `app.all('/api/auth/*', toNodeHandler(auth.handler))` para exponer todos los endpoints de Better Auth.
- **`backend/src/middleware/auth.ts`**: `requireAuth` (valida sesión cookie, setea `req.user`) y `requireRole(role)` (guard sobre `req.user.role`).
- **`backend/src/lib/env.ts`**: añadir `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN`, `PLIVO_PHONE_NUMBER`.
- **`backend/.env.example`**: añadir las nuevas vars.
- **`shared/`**: tipos/schemas auth (login request, session response) — contract compartido para mobile futuro.
- **`docs/adr/ADR-003-better-auth.md`**: migrar ADR-003 del spec a archivo propio en `docs/adr/`.

### Out of scope (cambios posteriores)

- Endpoints de profiles (`/api/operators`, `/api/clients`) — cambio de profiles.
- Sesiones con refresh manual para mobile — cambio mobile (client consume REST de Better Auth con cookies; el refresh se define en mobile).
- Recuperación de cuenta por email — MVP.
- OAuth/social login — MVP (Account se crea vacío-ready).
- Rates limit OTP — MVP.

## Approach

Sigue las recomendaciones de la exploration. Resumen:

1. Instalar `better-auth`, `plivo`; fijar versión de Better Auth.
2. Configurar `lib/auth.ts`, `lib/plivo.ts`.
3. `npx auth generate` → revisar diff → añadir `phone`, `role`, `createdAt`/`updatedAt` al User → añadir FKs reales a perfiles/Message → prisma format + validate.
4. `prisma migrate dev --name add_auth_identity`.
5. Montar handler base en `app.ts`.
6. Middleware `requireAuth` + `requireRole`.
7. Ampliar `env.ts` + `.env.example`.
8. Tests TDD: env (nuevas vars), plivo mock, middleware (sin/con sesión), flujo OTP completo con supertest + cookie jar + Plivo mocked.

## Risks & mitigations

- **`npx auth generate` sobrescribe schema**: revisar diff manualmente, commitear solo el ajuste. **backend市公安局安全.**
- **Better Auth versión 1.x inestable**: fijar versión en `package.json`; documentar en ADR-003.
- **Sessions por cookie**: supertest necesita cookie jar. Mitigación: `request.agent()` mantiene cookies.
- **Plivo requiere creds**: modo dev loggea OTP; tests mockean `sendOtp` para capturar y reintegrar el código.
- **`npx auth generate` no respeta `UserRole` enum**: ajustar manualmente el campo `role` para que use el enum `UserRole` existente.

## Dependencies / prerequisites

- `cambio-001` y `cambio-002` mergeados (✅ en develop).
- Better Auth instalado (npm).
- Postgres up para `prisma migrate`.
- Plivo creds **opcionales** para dev/test (modo log si faltan).

## Next

Etapa `spec`: requisitos funcionales + no funcionales + escenarios Gherkin por endpoint/middleware. Luego `design`.
