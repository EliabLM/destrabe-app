# destrabe

App móvil de intermediación de servicios de grúa. Modelo de oferta libre (tipo InDriver): el cliente publica una solicitud, los operadores cercanos cotizan, y el cliente acepta la mejor oferta. La plataforma retiene una comisión configurable y transfiere el resto al operador mediante split de pago.

> **Estado:** Fase Demo — foundation + data model + auth (OTP teléfono) listos. Sin pagos reales ni tracking en vivo aún.

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
npm run db:up                        # levanta Postgres+PostGIS (docker-compose.dev.yml) en :5432
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

## Licencia

Por definir.
