# Change Proposal — Cambio-004: Servicios (ciclo de vida + timer)

**Change ID:** `cambio-004-servicios` · **Etapa:** Propose · **Branch:** `develop`
**Basado en:** `docs/proposals/cambio-004-servicios/exploration.md`

## Intent

Implementar el ciclo de vida de `Service` (§7.2): crear solicitudes `PENDING`, listar cercanos a operadores (5 km), consultar detalle, disparar transiciones con guards de rol/ownership y un timer BullMQ que expira `PENDING` a `CANCELLED` a los 15 min. Cierra el flujo demo alcanzable sin quotes.

## Scope

### In scope

- **`serviceMachine.ts`** _(nuevo, puro)_ — `canTransition`/`assertTransition` (estado + rol). Define todas las transiciones; en runtime ejercita `PENDING→CANCELLED` y `ACTIVE→COMPLETED`.
- **`services.routes.ts`** _(nuevo)_ — `POST /services` (`requireRole(CLIENT)`, ClientProfile lazy), `GET /services/nearby` (`requireRole(OPERATOR)`, raw SQL `ST_DWithin` 5 km), `GET /services/:id`, `PATCH /services/:id/status` (cliente→`ACTIVE` requiere `acceptedQuoteId`).
- **`validate.ts`** _(nuevo mw)_ — factory Zod → 400 `VALIDATION_ERROR`.
- **`queue.ts` + `serviceExpiry.job.ts`** _(nuevo)_ — BullMQ enqueue en `POST /services` (delay `SERVICE_TIMEOUT_MINUTES*60_000`); `expirePendingService` pura + `notifyClient` log.
- **`env.ts`** — `REDIS_URL`, `SERVICE_TIMEOUT_MINUTES` (15), `NEARBY_RADIUS_KM` (5). **Deps** — `bullmq`, `ioredis`. **Compose** — `redis:7-alpine` + volumen.
- **Migración `_init_postgis`** — `CREATE EXTENSION IF NOT EXISTS postgis;`.
- **`shared/`** — `createServiceSchema`, `nearbyServicesQuerySchema`, `updateServiceStatusSchema` + `z.infer`.
- **Tests** — unit (machine, validate, notifications, `expirePendingService`); db smoke (lifecycle supertest + cookie jar + nearby geo).

### Out of scope (cambio-005 quotes)

`POST /services/:id/quotes`, `POST /quotes/:id/accept`, generación de cotizaciones, transiciones runtime `PENDING→QUOTED` y `QUOTED→ACTIVE` (definidas y unit-testeadas en el machine; inalcanzables por db smoke; comentario explícito).

### Out of scope (MVP)

Pagos reales (MP split + webhook), `Payment` en `ACTIVE`, tracking GPS (Socket.io), FCM push real, panel admin, radio configurable, onboarding completo de `ClientProfile`.

## Capabilities (contrato lógico, store engram)

- **New:** `service-lifecycle` (FSM + endpoints + timer). **Modified:** ninguno a nivel spec.

## Approach

Máquina pura + `validate` mw + 4 endpoints + BullMQ/Redis + PostGIS raw SQL (sin `previewFeatures`) + ClientProfile on-demand + `notifyClient` stub. Interfaz con cambio-005: callbacks `markQuoted`/`markActive` (no expuestos aquí).

## Affected Areas

| Área                                                                                                                             | Impacto  |
| -------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `services/serviceMachine.ts`, `routes/services.routes.ts`, `middleware/validate.ts`, `lib/queue.ts`, `jobs/serviceExpiry.job.ts` | New      |
| `lib/env.ts`, `package.json`, `docker-compose.dev.yml`, `shared/src/{schemas,types}/service.*`                                   | Modified |
| `prisma/migrations/*_init_postgis/`                                                                                              | New      |

## Risks

- Redis en CI/local → `db:up` extendido; unit mocks enqueue.
- `CREATE EXTENSION` no idempotente → `IF NOT EXISTS`; smoke valida `pg_extension`.
- `QUOTED`/`ACTIVE` inalcanzables en runtime → comentario explícito; cubierto en unit.
- BullMQ durations en test → `expirePendingService` aislada y testeable directa.

## Rollback Plan

Revertir commits; `prisma migrate resolve --rolled-back` `_init_postgis`; bajar Redis del compose; desinstalar `bullmq`/`ioredis`. El schema `Service` (cambio-002) no se toca.

## Dependencies

`cambio-001/002/003` mergeados (✅ develop). Postgres+PostGIS y Redis up. Deps `bullmq`, `ioredis`.

## Success Criteria

- [ ] `POST /services` crea `PENDING` + `expiresAt` + ClientProfile lazy.
- [ ] `GET /services/nearby` devuelve PENDING en 5 km.
- [ ] `PATCH /status`: `PENDING→CANCELLED`, `ACTIVE→COMPLETED`; 409 en ilegales.
- [ ] Timer expira `PENDING` a 15 min; `notifyClient` loggea.
- [ ] Unit del machine cubren TODAS las transiciones (incl. cambio-005).
- [ ] db smoke lifecycle pasa con cookie jar Better Auth.

## Next

Etapa `spec`: requisitos + Gherkin por endpoint/timer/machine. Luego `design`.
