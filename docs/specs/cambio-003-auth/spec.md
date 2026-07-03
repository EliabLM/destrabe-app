# Spec — Cambio-003: Better Auth (OTP + Identity)

**Change ID:** `cambio-003-auth`
**Etapa SDD:** Spec
**Basado en:** `docs/proposals/cambio-003-auth/proposal.md`
**Branch:** `feature/cambio-003-auth`

> Requisitos testeables. Unit tests no requieren DB; db y flujo OTP requieren Postgres up (`npm run db:up`).

---

## REQ-001: Modelos de identidad en Prisma

`schema.prisma` define `User`, `Session`, `Account`, `Verification`. `User` incluye `phone String @unique`, `role UserRole`, `createdAt`, `updatedAt`. FKs reales de `ClientProfile.userId`, `OperatorProfile.userId`, `Message.senderId` a `User.id`.

```gherkin
Scenario: prisma validate pasa
  When se ejecuta `DATABASE_URL=... npx prisma validate --schema=backend/prisma/schema.prisma`
  Then exit code 0

Scenario: ClientProfile.userId referencia User con onDelete Cascade
  Given el modelo ClientProfile
  Then userId tiene @relation a User.id
  And onDelete: Cascade
  # análogo para OperatorProfile y Message.senderId

Scenario: User tiene phone unique y role UserRole
  Given el modelo User
  Then phone String @unique
  And role UserRole (con default CLIENT)
```

## REQ-002: Migración add_auth_identity versionada

```gherkin
Scenario: existe la migración add_auth_identity
  Given `backend/prisma/migrations/<ts>_add_auth_identity/`
  When se aplica `prisma migrate deploy`
  Then se crean tablas User, Session, Account, Verification
  And se alteran FKs de ClientProfile/OperatorProfile/Message a User
```

## REQ-003: Configuración Better Auth válida

`backend/src/lib/auth.ts` exporta `auth` (instancia betterAuth) con prismaAdapter, phoneNumber plugin, additionalFields.role.

```gherkin
Scenario: auth es exportado y tiene handler
  Given el módulo auth.ts
  When se importa auth
  Then auth.handler es una funcion (request handler)
  And auth.api contiene los métodos de phoneNumber plugin
```

## REQ-004: Env vars de auth

`env.ts` valida `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `PLIVO_AUTH_ID?`, `PLIVO_AUTH_TOKEN?`, `PLIVO_PHONE_NUMBER?` (los Plivo opcionales para modo dev).

```gherkin
Scenario: envs requeridos de auth presentes
  Given BETTER_AUTH_SECRET y BETTER_AUTH_URL definidos
  When se parsea env
  Then env.BETTER_AUTH_SECRET tiene valor
  And env.BETTER_AUTH_URL tiene valor
  And env.PLIVO_* son string | undefined

Scenario: BETTER_AUTH_SECRET ausente lanza error claro
  Given BETTER_AUTH_SECRET no definido
  When se parsea env
  Then se lanza error que menciona BETTER_AUTH_SECRET
```

## REQ-005: Cliente Plivo con modo dev

`lib/plivo.ts` expone `sendOtp(phone, code)`. Si `PLIVO_AUTH_ID` no configurado → modo dev (loggea OTP, no llama Plivo).

```gherkin
Scenario: sin PLIVO_AUTH_ID, sendOtp loggea el OTP
  Given PLIVO_AUTH_ID no definido
  When se llama sendOtp("+573001234567", "123456")
  Then no se invoca la API de Plivo
  And se loggea el OTP en consola

Scenario: con PLIVO_AUTH_ID, sendOtp llama a Plivo
  Given PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN, PLIVO_PHONE_NUMBER configurados
  When se llama sendOtp("+573001234567", "123456")
  Then se invoca el cliente de Plivo con el mensaje de OTP
```

## REQ-006: Endpoints de auth montados

`app.ts` monta `app.all('/api/auth/*', toNodeHandler(auth.handler))`.

```gherkin
Scenario: POST /api/auth/phone/send-otp con phone válido responde éxito
  Given la app con auth montado y Plivo mocked
  When POST /api/auth/phone/send-otp con body { phoneNumber: "+573001234567" }
  Then la respuesta es exitosa (2xx)
  And el OTP se "envió" (via mock capturado)

Scenario: POST sin phoneNumber responde 4xx
  When POST /api/auth/phone/send-otp con body {}
  Then la respuesta es 4xx

Scenario: GET /api/auth/session sin sesión responde null/401
  When GET /api/auth/session sin cookie
  Then la respuesta indica no autenticado (null o 401)
```

## REQ-007: Flujo OTP completo (send → verify → sesión)

```gherkin
Scenario: flujo end-to-end con supertest + cookie jar + Plivo mocked
  Given la app con auth montado y Plivo mock captura el OTP
  When POST /api/auth/phone/send-otp { phoneNumber }
  Then se captions el OTP generado
  When POST /api/auth/phone/verify-otp { phoneNumber, code: <OTP capturado> } con cookie jar
  Then la respuesta es exitosa
  And se setea la cookie de sesión
  When GET /api/auth/session con la cookie
  Then responde con el usuario autenticado (phone coincide)
```

## REQ-008: Middleware requireAuth

`middleware/auth.ts` exporta `requireAuth` que valida la sesión cookie y setea `req.user`. Sin sesión → 401.

```gherkin
Scenario: ruta protegida sin cookie responde 401
  Given una ruta con requireAuth
  When se hace GET sin cookie
  Then status 401
  And body { error, code: "UNAUTHORIZED" }

Scenario: ruta protegida con cookie válida responde 200
  Given una sesión Better Auth válida
  When se hace con la cookie
  Then status 200
  And req.user está seteado
```

## REQ-009: Middleware requireRole

`requireRole(role)` guard sobre `req.user.role`. Si no coincide → 403.

```gherkin
Scenario: requireRole(OPERATOR) con user CLIENT responde 403
  Given sesion con user.role=CLIENT
  When se hace una ruta con requireRole(OPERATOR)
  Then status 403 { error, code: "FORBIDDEN" }

Scenario: requireRole(OPERATOR) con user OPERATOR responde 200
  Given sesion con user.role=OPERATOR
  Then status 200
```

## REQ-010 (non-functional): Plivo mocked en tests

```gherkin
Scenario: tests del flujo OTP no llaman a Plivo real
  Given los tests de auth
  Then se mockea sendOtp para capturar el código sin llamada de red a Plivo
```

---

## Cobertura de tests (mapeo requisito → test)

| Requisito        | Test                                                                    |
| ---------------- | ----------------------------------------------------------------------- |
| REQ-001, REQ-002 | prisma validate (manual/CI), migración aplicada                         |
| REQ-003          | `backend/__tests__/auth.config.test.ts` (unit)                          |
| REQ-004          | `backend/__tests__/env.test.ts` ampliado                                |
| REQ-005          | `backend/__tests__/plivo.test.ts` (unit: dev mode + real)               |
| REQ-006, REQ-007 | `backend/__tests__/auth.otp.flow.test.ts` (db + supertest + cookie jar) |
| REQ-008, REQ-009 | `backend/__tests__/middleware.auth.test.ts` (unit: session mock)        |
| REQ-010          | impl via vi.mock en test flow                                           |

## Next

Etapa `design`: estructura de auth.ts/plivo.ts/middleware, ajustes al schema tras auth generate, helpers de test (cookie jar, mock Plivo), integración en app.ts.
