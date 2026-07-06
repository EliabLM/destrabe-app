# destrabe

App móvil de intermediación de servicios de grúa. Modelo de oferta libre (tipo InDriver): el cliente publica una solicitud, los operadores cercanos cotizan, y el cliente acepta la mejor oferta. La plataforma retiene una comisión configurable y transfiere el resto al operador mediante split de pago.

> **Estado:** Fase Demo — foundation + data model + auth (OTP teléfono) + servicios (ciclo de vida) + cotizaciones (quotes/offers) listos. Sin pagos reales ni tracking en vivo aún.

## Fases

| Fase     | Alcance                                                                                 | Estado      |
| -------- | --------------------------------------------------------------------------------------- | ----------- |
| **Demo** | Flujo completo solicitud → oferta → aceptación. Sin pagos reales, sin tracking en vivo. | En curso    |
| **MVP**  | Pagos reales, tracking GPS, historial, calificaciones, panel admin.                     | Por estimar |

## Stack

- **App móvil:** React Native (Expo SDK) · TypeScript · React Navigation v7 · Zustand · Axios · Mapbox (`@rnmapbox/maps`) · `socket.io-client`
- **Backend:** Node.js 20 LTS · Express + TypeScript · Prisma · PostgreSQL 16 (PostGIS) · Socket.io · Better Auth · BullMQ + Redis · Zod
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

## Empezar

> Foundation (cambio-001) + Data model (cambio-002) implementados. `backend/` y `@destrabe/shared` están listos; `app/` (mobile) y `frontend/` (admin) se inicializan en cambios posteriores.

```bash
npm install                          # instala workspaces (backend, shared) y deps
npm run build -w @destrabe/shared    # compila shared -> dist/ (antes de dev backend)
npm run db:up                        # levanta Postgres+PostGIS y Redis (docker-compose.dev.yml) en :5432 y :6379
npm run db:migrate                   # aplica migraciones (crea tablas/enums)
npm run dev -w @destrabe/backend     # backend en :3000 (sin DB/Redis para /health)
npm test                             # unit tests (vitest, sin DB)
npm run test:db                      # db smoke tests (requiere db:up + migración)
npm test -- --coverage               # unit + cobertura (umbral 80%)
npm run lint                         # eslint flat
npm run format                       # prettier --write
```

Health check: `GET http://localhost:3000/health` → `{ "status": "ok" }`.

## Autenticación (OTP teléfono)

Auth centralizada en Better Auth (ADR-003), montada bajo `/api/auth` con `prismaAdapter` (Postgres) + plugin `phoneNumber` + Plivo (SMS en prod, log en dev). Sesión JWT en cookies firmadas.

### Endpoints

| Método | Ruta                              | Body / Efecto                                                      |
| ------ | --------------------------------- | ------------------------------------------------------------------ |
| POST   | `/api/auth/phone-number/send-otp` | `{ phoneNumber }` → envía código SMS (o log en dev)                |
| POST   | `/api/auth/phone-number/verify`   | `{ phoneNumber, code }` → crea sesión, `Set-Cookie: session_token` |
| GET    | `/api/auth/get-session`           | `{ session, user }` o `null`                                       |
| POST   | `/api/auth/sign-out`              | borra la cookie de sesión (`Max-Age=0`)                            |

> Roles (`UserRole`: `CLIENT` por defecto, `OPERATOR`) se enforcean con `requireAuth` / `requireRole` (`backend/src/middleware/auth.ts`). Detalles y desviaciones de la spec en `docs/adr/ADR-003-better-auth.md`.

## Servicios (ciclo de vida)

Flujo de solicitud de grúa con máquina de estados finita (FSM) y timer de expiración BullMQ+Redis (cambio-004). El cliente publica una solicitud `PENDING`; los operadores cercanos la ven vía búsqueda geoespacial PostGIS; el timer auto-cancela a los 15 min sin actividad.

### Endpoints

| Método | Ruta                   | Rol      | Efecto                                                                      |
| ------ | ---------------------- | -------- | --------------------------------------------------------------------------- |
| POST   | `/services`            | CLIENT   | Crea `Service` `PENDING` + `ClientProfile` (lazy upsert) + enqueue expiry   |
| GET    | `/services/nearby`     | OPERATOR | Búsqueda geoespacial PostGIS `ST_DWithin` — `PENDING` no expirados en radio |
| GET    | `/services/:id`        | auth     | Dueño: completo · Operador: público · Ajeno: 404                            |
| PATCH  | `/services/:id/status` | auth     | Transición FSM (`assertTransition`); ilegal → 409 `INVALID_TRANSITION`      |

### Máquina de estados (`serviceMachine`)

```
PENDING ──system──▶ QUOTED ──CLIENT──▶ ACTIVE ──OPERATOR──▶ COMPLETED
   │                   │
   └─CLIENT/system──▶ CANCELLED ◀──CLIENT──┘
```

- `PENDING → CANCELLED`: CLIENT o system (timer BullMQ a los `SERVICE_TIMEOUT_MINUTES` min).
- `QUOTED → ACTIVE`: CLIENT (requiere `acceptedQuoteId`; inalcanzable hasta quotes — cambio-005).
- `ACTIVE → COMPLETED`: OPERATOR.
- Cualquier transición fuera de la tabla → `ConflictError` 409.

> El timer BullMQ (`serviceExpiry` queue) encola un job con `delay = SERVICE_TIMEOUT_MINUTES * 60s` al crear el servicio; al expirar, el worker transiciona `PENDING → CANCELLED` vía `system` y notifica (log stub en demo). Detalles en `docs/designs/cambio-004-servicios/design.md`.

## Cotizaciones (quotes/offers)

Flujo de cotizaciones que cierra el ciclo Demo core: el operador cotiza sobre un servicio `PENDING`/`QUOTED`, el cliente acepta la mejor oferta → `ACTIVE`. Pago como **stub** (`commission=0`) para cambio-006 (Mercado Pago real).

### Endpoints

| Método | Ruta                   | Rol      | Efecto                                                                      |
| ------ | ---------------------- | -------- | --------------------------------------------------------------------------- |
| POST   | `/services/:id/quotes` | OPERATOR | Crea `Quote`; si service `PENDING` → `QUOTED` (system); notifica cliente    |
| GET    | `/services/:id/quotes` | auth     | Dueño/admin: todas + datos operador · Operador: solo las suyas · Ajeno: 404 |
| POST   | `/quotes/:id/accept`   | CLIENT   | `QUOTED → ACTIVE` (CLIENT); setea `acceptedQuoteId`; crea `Payment` stub    |

### Reglas clave

- **OperatorProfile requerido** para cotizar (422 `OPERATOR_PROFILE_REQUIRED` si no tiene). No hay lazy upsert — `truckType`/`licensePlate` son campos required.
- **Múltiples operadores** pueden cotizar sobre un servicio `QUOTED` (la primera cotización transiciona `PENDING → QUOTED`; las subsequentes no transicionan).
- **Doble-accept protegido**: `acceptedQuoteId @unique` a DB-level + check `status === ACTIVE` → 409 `ALREADY_ACCEPTED`. Race condition en `prisma.$transaction` captura `P2002`.
- **Payment stub**: `amount = quote.amount`, `commission = 0`, `operatorAmount = quote.amount`, `status = PENDING`. Placeholder para cambio-006.
- **Notificación**: `notifyClient(service, 'quote_received')` en **cada** quote (no solo la primera).

> La FSM (`serviceMachine.ts`) no se modifica — las transiciones `PENDING→QUOTED` (system) y `QUOTED→ACTIVE` (CLIENT) ya estaban definidas en cambio-004; cambio-005 solo las invoca. Detalles en `docs/designs/cambio-005-quotes/design.md`.

## Licencia

Por definir.
