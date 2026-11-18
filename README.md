# destrabe

App móvil de intermediación de servicios de grúa. Modelo de oferta libre (tipo InDriver): el cliente publica una solicitud, los operadores cercanos cotizan, y el cliente acepta la mejor oferta. La plataforma retiene una comisión configurable y transfiere el resto al operador mediante split de pago.

> **Estado:** Fase Demo — foundation + data model + auth (OTP teléfono) + servicios (ciclo de vida) + cotizaciones (quotes/offers) + pagos (MercadoPago sandbox) + app móvil (Expo Dev Build) listos. Sin tracking en vivo ni push aún.

## Fases

| Fase     | Alcance                                                                                 | Estado      |
| -------- | --------------------------------------------------------------------------------------- | ----------- |
| **Demo** | Flujo completo solicitud → oferta → aceptación. Sin pagos reales, sin tracking en vivo. | En curso    |
| **MVP**  | Pagos reales, tracking GPS, historial, calificaciones, panel admin.                     | Por estimar |

## Stack

- **App móvil:** React Native (Expo SDK) · TypeScript · React Navigation v7 · Zustand · Axios · Mapbox (`@rnmapbox/maps`) · `socket.io-client`
- **Backend:** Node.js 20 LTS · Express + TypeScript · Prisma · PostgreSQL 16 (PostGIS) · Socket.io · Better Auth · Zod
- **Servicios externos:** FCM (push) · Plivo (OTP SMS) · Mercado Pago Marketplace (pagos) · Resend (email)
- **Infra:** Docker Compose + Caddy (HTTPS automático) en Hetzner CX22 · CI/CD vía GitHub Actions

## Estructura del repositorio

```
destrabe-app/
├── app/                # App móvil (React Native + Expo)
├── frontend/           # Admin web (MVP)
├── backend/            # API Express + TypeScript
├── shared/             # @destrabe/shared — tipos y schemas Zod
├── infra/              # Docker Compose, Caddyfile, deploy
├── .github/workflows/  # CI/CD
└── docs/               # Trazabilidad SDD + arquitectura
    ├── adr/            # Architecture Decision Records
    ├── architecture/   # Diagramas y diseño de arquitectura
    ├── backlog/        # Backlog de producto
    ├── roadmap/        # Roadmap y fases
    ├── specs/          # SDD — delta specs (requisitos + escenarios)
    ├── proposals/      # SDD — change proposals
    ├── designs/        # SDD — diseños técnicos
    ├── tasks/          # SDD — breakdown de tareas
    ├── testing/        # Estrategia TDD estricto
    ├── runbooks/       # Operación y despliegue
    ├── notes/          # Notas y decisiones
    ├── changelog/      # Changelog por release
    └── retros/         # Retrospectivas
```

## Documentación

- [Especificación técnica v1.0.0](./docs/architecture/spec-tecnica-destrabe-app.md) — contexto y arquitectura base
- [ADRs](./docs/adr/) — decisiones arquitectónicas
- [Roadmap](./docs/roadmap/) — fases Demo → MVP
- [Backlog](./docs/backlog/) — ítems de producto

## Metodología

El proyecto se desarrolla con **SDD (Spec-Driven Development)** y **TDD estricto**:

- Cada cambio sigue el ciclo `proposals → specs → designs → tasks → implementación → verificación`.
- Las decisiones arquitectónicas se registran como ADRs en `docs/adr/`.
- La estrategia y convenios de pruebas viven en `docs/testing/`.

## Feature flags

Toda feature nueva se despliega **detrás de un feature flag**, activa solo
para una allowlist (el dueño del producto) hasta liberarla a todos. Las
correcciones de errores y de seguridad no llevan flag. Cómo crear, proteger y
liberar un flag: [docs/runbooks/feature-flags.md](./docs/runbooks/feature-flags.md).

## Empezar

> Foundation (cambio-001) + Data model (cambio-002) implementados. `backend/` y `@destrabe/shared` están listos; `app/` (mobile) y `frontend/` (admin) se inicializan en cambios posteriores.

```bash
npm install                          # instala workspaces (backend, shared) y deps
npm run build -w @destrabe/shared    # compila shared -> dist/ (antes de dev backend)
npm run db:up                        # levanta Postgres+PostGIS (docker-compose.dev.yml) en :5432
npm run db:migrate                   # aplica migraciones (crea tablas/enums)
npm run dev -w @destrabe/backend     # backend en :3000 (sin DB, /health responde 503)
npm test                             # unit tests (vitest, sin DB)
npm run test:db                      # db smoke tests (requiere db:up + migración)
npm test -- --coverage               # unit + cobertura (umbral 80%)
npm run lint                         # eslint flat
npm run format                       # prettier --write
```

Health check: `GET http://localhost:3000/health` → `{ "status": "ok" }`.

## Autenticación (OTP teléfono)

Auth centralizada en Better Auth (ADR-003), montada bajo `/api/auth` con `prismaAdapter` (Postgres) + plugins `phoneNumber` y `bearer`. La verificación crea una sesión persistida: el servidor devuelve cookie firmada y el header `set-auth-token` (token firmado). La app móvil guarda ese header en SecureStore y lo envía como `Authorization: Bearer …`; no utiliza el `token` sin firma del JSON. Plivo envía SMS en producción y el modo dev registra el OTP (no usar números reales en pruebas).

### Endpoints

| Método | Ruta                              | Body / Efecto                                                                                           |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| POST   | `/api/auth/phone-number/send-otp` | `{ phoneNumber }` → envía código SMS (o log en dev)                                                     |
| POST   | `/api/auth/phone-number/verify`   | `{ phoneNumber, code }` → `{ status, token, user }`, cookie de sesión + header `set-auth-token` firmado |
| GET    | `/api/auth/get-session`           | `{ session, user }` o `null`                                                                            |
| POST   | `/api/auth/sign-out`              | revoca la sesión enviada por cookie o Bearer y borra la cookie                                          |

`GET /api/me` y las rutas protegidas usan `requireAuth` → `auth.api.getSession` (cookie o Bearer con plugin); sin sesión o tras logout/expiración responden 401. Al reabrir la app se valida `/api/me` antes de reconstruir usuario/perfil; un 401 borra el token local. Cobertura de contrato sin infraestructura: `backend/__tests__/auth.mobile.contract.test.ts` ejecuta el handler Better Auth, router Express, middleware y Axios de la app con adaptador de memoria de Better Auth y bordes Prisma/Plivo simulados. No prueba Postgres, envío SMS ni ejecución en dispositivo; `npm run test:db` sigue requiriendo esos servicios. La spec histórica de cambio-003 describe rutas antiguas; la corrección vigente se documenta en `docs/specs/cambio-008-app-movil-demo/auth-lifecycle.md`.

> Roles (`UserRole`: `CLIENT` por defecto, `OPERATOR`) se enforcean con `requireAuth` / `requireRole` (`backend/src/middleware/auth.ts`). Detalles y desviaciones de la spec en `docs/adr/ADR-003-better-auth.md`.

## Servicios (ciclo de vida)

Flujo de solicitud de grúa con máquina de estados finita (FSM) y expiración por barrido periódico en Postgres (DCC-07). El cliente publica una solicitud `PENDING`; los operadores cercanos la ven vía búsqueda geoespacial PostGIS y pueden cotizarla mientras siga `PENDING` o `QUOTED`; si el cliente no acepta ninguna oferta en `SERVICE_TIMEOUT_MINUTES` (15 por defecto), se cancela.

### Endpoints

| Método | Ruta                   | Rol      | Efecto                                                                                                                   |
| ------ | ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/services`            | CLIENT   | Crea `Service` `PENDING` + `ClientProfile` (lazy upsert); `expiresAt = ahora + SERVICE_TIMEOUT_MINUTES`                  |
| GET    | `/services`            | CLIENT   | Solicitudes propias paginadas (`limit` 1–100, default 20; cursor opaco); `{items,nextCursor}`. Sin perfil: página vacía. |
| GET    | `/services/nearby`     | OPERATOR | PostGIS `ST_DWithin`: `PENDING`/`QUOTED` sin expirar, sin los ya cotizados por el operador, con `quoteCount`             |
| GET    | `/services/:id`        | auth     | Dueño: completo · Operador: público · Ajeno: 404                                                                         |
| PATCH  | `/services/:id/status` | auth     | Transición FSM (`assertTransition`); ilegal → 409 `INVALID_TRANSITION`                                                   |

### Máquina de estados (`serviceMachine`)

```
PENDING ──system──▶ QUOTED ──CLIENT──▶ ACTIVE ──OPERATOR──▶ COMPLETED
   │                   │
   └─CLIENT/system──▶ CANCELLED ◀──CLIENT/system──┘
```

- `PENDING → CANCELLED` y `QUOTED → CANCELLED`: CLIENT o system (expiración al vencer `expiresAt`).
- `QUOTED → ACTIVE`: CLIENT (requiere `acceptedQuoteId`; inalcanzable hasta quotes — cambio-005).
- `ACTIVE → COMPLETED`: OPERATOR.
- Cualquier transición fuera de la tabla → `ConflictError` 409.

> Expiración (DCC-07/DCC-19, sin Redis): `expireOverdueServices()` (`backend/src/jobs/serviceExpiry.job.ts`) cancela con un solo `UPDATE` los `PENDING`/`QUOTED` con `expiresAt` vencido y notifica al cliente (log stub en demo). Corre al arrancar el servidor y cada `SERVICE_EXPIRY_SWEEP_SECONDS` (60 por defecto), con `pg_try_advisory_xact_lock` para que varias réplicas no trabajen a la vez. Es idempotente: repetirlo no duplica notificaciones. Entre el vencimiento y el siguiente barrido el servicio ya no aparece en `/nearby` ni en la vista previa del operador, porque esas consultas filtran por `expiresAt`.

## Cotizaciones (quotes/offers)

Flujo de cotizaciones que cierra el ciclo Demo core: el operador cotiza sobre un servicio `PENDING`/`QUOTED`, el cliente acepta la mejor oferta → `ACTIVE` y se crea el `Payment` pendiente con la comisión ya calculada.

### Endpoints

| Método | Ruta                   | Rol      | Efecto                                                                       |
| ------ | ---------------------- | -------- | ---------------------------------------------------------------------------- |
| POST   | `/services/:id/quotes` | OPERATOR | Crea `Quote` (201) o reemplaza la suya (200); `PENDING` → `QUOTED`; notifica |
| GET    | `/services/:id/quotes` | auth     | Dueño/admin: todas + datos operador · Operador: solo las suyas · Ajeno: 404  |
| POST   | `/quotes/:id/accept`   | CLIENT   | `QUOTED → ACTIVE` (CLIENT); setea `acceptedQuoteId`; crea `Payment` stub     |

### Reglas clave

- **OperatorProfile requerido** para cotizar (422 `OPERATOR_PROFILE_REQUIRED` si no tiene). No hay lazy upsert — `truckType`/`licensePlate` son campos required.
- **Operador disponible**: solo cotiza un operador con `available = true` (409 `OPERATOR_NOT_AVAILABLE`).
- **Importe (DCC-08)**: pesos COP enteros entre `QUOTE_AMOUNT_MIN_COP` (10.000) y `QUOTE_AMOUNT_MAX_COP` (2.000.000), definidos en `shared/src/schemas/inputBounds.schema.ts`. Un decimal o un valor fuera de rango → 400.
- **Una cotización por operador y servicio**: `@@unique([serviceId, operatorProfileId])`. Si el operador vuelve a cotizar mientras el servicio está `PENDING`/`QUOTED`, la nueva reemplaza la anterior (mismo `id`, responde 200). La fila del servicio se bloquea (`FOR UPDATE`) para que una aceptación simultánea no cobre un importe distinto del guardado.
- **Múltiples operadores** pueden cotizar sobre un servicio `QUOTED` (la primera cotización transiciona `PENDING → QUOTED`; las siguientes no transicionan).
- **Doble-accept protegido**: `acceptedQuoteId @unique` a DB-level + check `status === ACTIVE` → 409 `ALREADY_ACCEPTED`. Race condition en `prisma.$transaction` captura `P2002`.
- **Payment y comisión (DCC-08)**: al aceptar se crea el `Payment` `PENDING` con `amount = quote.amount`, `commission = round(amount × PAYMENT_COMMISSION_RATE / 100)` y `operatorAmount = amount − commission` (`backend/src/services/commission.ts`, tasa 10 % por defecto). Es el único sitio donde se calcula: `init` y el webhook usan los importes guardados.
- **Borrados**: `Service.client`, `Quote.operator` y `Payment.service` son `onDelete: Restrict`. Borrar un usuario con servicios, cotizaciones o pagos falla; el borrado de cuenta se hará anonimizando (DCC-14).
- **Notificación**: `notifyClient(service, 'quote_received')` en **cada** quote (no solo la primera).

> La FSM (`serviceMachine.ts`) no se modifica — las transiciones `PENDING→QUOTED` (system) y `QUOTED→ACTIVE` (CLIENT) ya estaban definidas en cambio-004; cambio-005 solo las invoca. Detalles en `docs/designs/cambio-005-quotes/design.md`.

## Licencia

Por definir.
